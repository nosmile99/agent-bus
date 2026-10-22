#!/usr/bin/env bash
# agent-bus-inbox-do: poll the DO bus (unified typed-events poll, since_ts mode)
# for new events for nosmile99.
# Composite cursor (ts:id) stored in $STATE_DIR/cursor. Event-id dedup in seen_event_ids.
# At-least-once: this script NEVER advances the cursor — it only wakes.
# The woken worker relays the messages, then advances the cursor itself
# (cursor/seen writes happen AFTER processing — ack-last, never before).
#
# Base: Nyx's do-client (bus #219/#220, 2026-10-21), adapted for nosmile99.
# UPDATE 2026-10-22 (Ryuki's order): the circuit breaker below was redesigned
# after a day of false trips culminating in a frozen relay — poll-count
# tripping (5 polls = 2.5 min) plus wake-suppression deadlocked the client
# (only a wake can move the cursor, but the trip suppressed all wakes).
# Breaker v2 is time-based: 600s grace window per event set, one re-wake per
# expired window, trip only after 3 windows (~30 min) unmoved, auto-recovery
# on cursor movement. This file is the reference copy in nosmile99/agent-bus
# (clients/do-inbox-poll.sh); Nyx adapts her client to this breaker design.
# nosmile99 adaptations (vs Nyx's verbatim file — see bus #221):
#   1. SECRET_FILE -> $HOME/.config/agent-bus/do-token (this host's DO token).
#   2. Own-loopback filter: events authored by nosmile99 are excluded, else my
#      own sent messages would wake a worker on myself (self-wake storm).
#   3. Typed-event filter extended to kanban.* (Nyx's was bus.message-only):
#      per the #202/#203 contract kanban events reach nosmile99 like regular
#      messages, and task #3's end-to-end check needs kanban.task.assigned.
#      kanban events wake with their full event object in the `kanban` array.
#   4. Missing-secret guard: silent exit instead of a set -e crash loop.
set -euo pipefail
source "$HATCH_HOOK_RUNTIME"

BUS_DO="https://agent-bus-do.lukiznr.workers.dev"
SECRET_FILE="$HOME/.config/agent-bus/do-token"
STATE_DIR="$HOME/hooks/state/agent-bus-inbox-do"
mkdir -p "$STATE_DIR"
CURSOR="$STATE_DIR/cursor"

if [ ! -f "$SECRET_FILE" ]; then
  log "agent-bus-inbox-do: no DO token file" '{}'
  silent "agent-bus-inbox-do: no token" '{}'
  exit 0
fi

# Cursor format "ts:id". First run (or legacy integer cursor): bootstrap 5-min replay (poll rev 3).
cursor="$(cat "$CURSOR" 2>/dev/null || echo "")"
if [[ "$cursor" =~ ^[0-9]+:[0-9]+$ ]]; then
  since_ts="${cursor%%:*}"; since_id="${cursor##*:}"
else
  since_ts=$(( $(date -u +%s) - 300 )); since_id=0
fi
secret="$(cat "$SECRET_FILE")"

poll_out="$(curl --fail --silent --max-time 10 \
  -H "Authorization: Bearer $secret" \
  "$BUS_DO/poll?since_ts=$since_ts&since_id=$since_id" || true)"

if [ -z "$poll_out" ]; then
  log "agent-bus-inbox-do: poll inconclusive (DO unreachable)" '{}'
  silent "agent-bus-inbox-do: DO unreachable, watchdog owns alerting" '{}'
  exit 0
fi

# resync_required: cursor predates the 30-day retention cutoff. Bootstrap to a
# 5-min replay instead of waking with a 30-day flood; the worker does NOT get
# a partial stream it can't trust.
if [ "$(echo "$poll_out" | jq -r '.resync_required // false' 2>/dev/null)" = "true" ]; then
  now="$(date -u +%s)"
  echo "$(( now - 300 )):0" > "$CURSOR"
  log "agent-bus-inbox-do: resync_required, cursor bootstrapped" '{}'
  silent "agent-bus-inbox-do: cursor bootstrapped after resync_required" '{}'
  exit 0
fi

# bus.message (+bus.message.deleted) and kanban.* events, excluding my own
# loopback; dedup by EVENT id (unique across types).
touch "$STATE_DIR/seen_event_ids"
seen_json="$(jq -R -s '[split("\n")[] | select(length > 0) | tonumber? // empty]' "$STATE_DIR/seen_event_ids" 2>/dev/null)"
if ! echo "$seen_json" | jq -e . >/dev/null 2>&1; then seen_json='[]'; fi
fresh_events="$(echo "$poll_out" | jq -c --argjson seen "$seen_json" '
  [.events // [] | .[]
   | select(.type == "bus.message" or .type == "bus.message.deleted" or (.type | startswith("kanban.")))
   | select(((.payload.sender // .actor // "") != "nosmile99"))
   | select(.id as $i | $seen | index($i) | not)]
' 2>/dev/null || echo '[]')"
count="$(echo "$fresh_events" | jq -r 'length' 2>/dev/null || echo 0)"
case "$count" in ''|*[!0-9]*) count=0 ;; esac

if [ "$count" -eq 0 ]; then
  silent "agent-bus-inbox-do: no new events" '{}'
  exit 0
fi

# Messages for the worker (bus.message payloads) + kanban events (full event
# objects) + the composite cursor the worker should advance to
# (max (ts,id) of the fresh events — never wall-clock) + event ids for dedup.
msgs="$(echo "$fresh_events" | jq -c '[.[] | select(.type == "bus.message" or .type == "bus.message.deleted") | .payload]')"
kevts="$(echo "$fresh_events" | jq -c '[.[] | select(.type | startswith("kanban.")) | {id, type, ts, actor, project_id, payload}]')"
event_ids="$(echo "$fresh_events" | jq -c '[.[].id]')"
new_cursor="$(echo "$fresh_events" | jq -r 'max_by(.ts * 1000000000 + .id) | "\(.ts):\(.id)"')"

# CIRCUIT BREAKER (revised 2026-10-22, after a day of false trips): this script
# never advances the cursor — the woken worker does (see hook prompt step 4).
# The old design counted POLLS with an unchanged cursor and tripped after 5
# (= 2.5 min at a 30s poll). A healthy worker needs longer than that to verify
# and reply, so it false-tripped constantly — and once tripped it suppressed
# ALL wakes while only a cursor move could clear it, but only a wake can move
# the cursor: a structural deadlock that froze the relay until manual repair.
# New design, time-based instead of poll-count-based:
#   - Same un-acked set inside GRACE_SECS of the last wake: stay silent. A
#     worker is (or may be) still processing; no re-wake storm, no stuck count.
#   - Same set still un-acked after a full grace window: re-wake ONCE per
#     window so a fresh worker can take over and ack.
#   - MAX_GRACE_WINDOWS consecutive expired windows with zero cursor movement:
#     trip — one alert wake, then silent until the cursor moves or new events
#     arrive (recovery below).
GRACE_SECS=600
MAX_GRACE_WINDOWS=3
BREAKER_STATE="$STATE_DIR/breaker_tripped"
last_ids="$(cat "$STATE_DIR/last_wake_event_ids" 2>/dev/null || echo "")"
last_cur="$(cat "$STATE_DIR/last_wake_cursor" 2>/dev/null || echo "")"
last_at="$(cat "$STATE_DIR/last_wake_at" 2>/dev/null || echo 0)"
case "$last_at" in ''|*[!0-9]*) last_at=0 ;; esac
stuck="$(cat "$STATE_DIR/stuck_count" 2>/dev/null || echo 0)"
case "$stuck" in ''|*[!0-9]*) stuck=0 ;; esac
cur_cursor="$(cat "$CURSOR" 2>/dev/null || echo "")"
tripped="$(cat "$BREAKER_STATE" 2>/dev/null || echo "")"
now="$(date -u +%s)"
redelivery=false

if [ "$event_ids" != "$last_ids" ] || [ "$cur_cursor" != "$last_cur" ]; then
  # New events arrived, or the worker acked (cursor moved): fresh set.
  stuck=0
  [ -n "$tripped" ] && rm -f "$BREAKER_STATE"
  tripped=""
  echo "$event_ids" > "$STATE_DIR/last_wake_event_ids"
  echo "$cur_cursor" > "$STATE_DIR/last_wake_cursor"
  echo "$now" > "$STATE_DIR/last_wake_at"
  echo "0" > "$STATE_DIR/stuck_count"
elif [ $((now - last_at)) -lt "$GRACE_SECS" ]; then
  silent "agent-bus-inbox-do: worker in flight for current events (grace window)" '{}'
  exit 0
else
  stuck=$((stuck + 1))
  echo "$stuck" > "$STATE_DIR/stuck_count"
  echo "$now" > "$STATE_DIR/last_wake_at"
  if [ "$stuck" -ge "$MAX_GRACE_WINDOWS" ]; then
    if [ -z "$tripped" ]; then
      echo "tripped" > "$BREAKER_STATE"
      log "agent-bus-inbox-do: CIRCUIT BREAKER TRIPPED - cursor unmoved across grace windows" \
        "{\"stuck_polls\": $stuck, \"event_ids\": $event_ids, \"cursor\": \"$cur_cursor\"}"
      wake "agent-bus-inbox-do: circuit breaker tripped (worker not advancing cursor)" \
        "$(jq -n --argjson event_ids "$event_ids" --argjson stuck "$stuck" --arg cursor "$cur_cursor" \
          '{breaker_tripped: true, event_ids: $event_ids, stuck_polls: $stuck, cursor: $cursor}')"
    else
      log "agent-bus-inbox-do: breaker still tripped, wake suppressed" "{\"stuck_polls\": $stuck}"
      silent "agent-bus-inbox-do: breaker tripped, still stuck" '{}'
    fi
    exit 0
  fi
  redelivery=true
fi

payload="$(jq -n --argjson messages "$msgs" --argjson kanban "$kevts" --argjson event_ids "$event_ids" --arg cursor "$new_cursor" --argjson redelivery "$redelivery" '{messages: $messages, kanban: $kanban, event_ids: $event_ids, cursor: $cursor, redelivery: $redelivery}')"
wake "agent-bus-do: $count new event(s) for nosmile99" "$payload"
