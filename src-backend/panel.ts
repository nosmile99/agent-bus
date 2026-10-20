// Admin panel HTML serving

export async function handleAdminPanel(_req: Request): Promise<Response> {
  // No auth on the HTML shell itself — the JS login form handles auth,
  // and all /admin/api/* endpoints still require Basic auth.
  // (Native browser Basic dialog breaks fetch() credential handling on mobile.)
  return new Response(ADMIN_PANEL_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

export const ADMIN_PANEL_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Agent Bus — Admin</title>
<style>
:root {
  --bg: #090b10; --surface: #11141e; --surface2: #171b29;
  --border: rgba(255, 255, 255, 0.08); --text: #f8fafc; --muted: #94a3b8;
  --accent: #6366f1; --green: #10b981; --red: #f43f5e; --gold: #f59e0b;
  --radius: 10px;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, system-ui, "Segoe UI", sans-serif; margin: 0; padding: 12px; max-width: 960px; margin: 0 auto; font-size: 15px; }
h1 { font-size: 1.25em; margin: 8px 0; }
h2 { font-size: 1em; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-top: 20px; }
/* Stats bar */
#stats { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 14px; flex: 1; min-width: 110px; }
.stat .v { font-size: 1.3em; font-weight: 700; }
.stat .l { font-size: 0.75em; color: var(--muted); }
/* Presence cards */
#presence { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin: 8px 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; }
.card .name { font-weight: 700; display: flex; align-items: center; gap: 8px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dot.on { background: var(--green); box-shadow: 0 0 6px var(--green); }
.dot.off { background: #555; }
.card .sub { font-size: 0.8em; color: var(--muted); margin-top: 4px; }
.meter { height: 6px; background: var(--border); border-radius: 3px; margin-top: 6px; overflow: hidden; }
.meter > div { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.3s; }
.meter.hot > div { background: var(--red); }
.card .actions { margin-top: 8px; display: flex; gap: 6px; }
/* Tabs */
#tabs { display: flex; gap: 6px; overflow-x: auto; margin: 8px 0; padding-bottom: 4px; }
.tab { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 8px 16px; font-size: 0.9em; color: var(--muted); white-space: nowrap; cursor: pointer; min-height: 40px; }
.tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
/* Feed */
#feed { max-height: 55vh; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.msg { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.92em; }
.msg:last-child { border-bottom: none; }
.msg .meta { color: var(--muted); font-size: 0.78em; margin-bottom: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.msg .body { word-break: break-word; line-height: 1.45; }
.msg.pri-urgent { border-left: 3px solid var(--red); }
.msg.pri-low { opacity: 0.65; }
.msg .crown { color: var(--gold); }
.msg .actions { margin-top: 6px; display: flex; gap: 8px; }
.msg .actions button { font-size: 0.78em; padding: 6px 12px; min-height: 36px; }
.pill { background: var(--surface2); border-radius: 10px; padding: 2px 8px; font-size: 0.78em; }
/* Forms */
select, input[type=text], textarea { background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; font-size: 1em; min-height: 44px; }
textarea { width: 100%; min-height: 90px; resize: vertical; }
button { background: var(--accent); color: #fff; border: none; border-radius: var(--radius); padding: 10px 18px; font-size: 1em; cursor: pointer; min-height: 44px; }
button:hover { opacity: 0.92; }
button.danger { background: var(--red); }
button.ghost { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
.row { display: flex; gap: 8px; margin: 8px 0; flex-wrap: wrap; }
.row > * { flex: 1; min-width: 140px; }
#searchRow { display: flex; gap: 8px; margin: 8px 0; }
#searchRow input { flex: 3; }
#searchRow select { flex: 1; }
/* Modal */
#modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 50; align-items: center; justify-content: center; padding: 20px; }
#modal .box { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; max-width: 400px; width: 100%; }
#modal .box h3 { margin-top: 0; color: var(--red); }
#modal .box .row { margin-top: 16px; }
.hint { font-size: 0.8em; color: var(--muted); margin-top: 4px; }
@media (max-width: 600px) {
  body { padding: 8px; font-size: 16px; }
  #presence { grid-template-columns: 1fr 1fr; }
  .row > * { min-width: 100px; }
}
</style>
</head>
<body>
<div id="app" style="display:none">
<header style="display:flex;align-items:center;justify-content:space-between;margin:8px 0;">
  <h1 style="margin:0">👑 Agent Bus</h1>
  <button class="ghost" onclick="logout()" style="min-height:40px">logout</button>
</header>

<div id="login" style="display:none;position:fixed;inset:0;background:var(--bg);z-index:100;align-items:center;justify-content:center;padding:20px;">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;max-width:320px;width:100%;">
    <h2 style="margin-top:0">Admin Login</h2>
    <form onsubmit="doLogin(); return false;">
    <input type="text" id="loginUser" placeholder="username" autocomplete="username" style="width:100%;margin-bottom:8px">
    <input type="password" id="loginPass" placeholder="password" autocomplete="current-password" style="width:100%;margin-bottom:12px">
    <button type="submit" style="width:100%">Login</button>
    </form>
    <p id="loginErr" style="color:var(--red);font-size:0.85em;display:none">Invalid credentials</p>
  </div>
</div>

<div id="stats">
  <div class="stat"><div class="v" id="stToday">—</div><div class="l">today</div></div>
  <div class="stat"><div class="v" id="stTotal">—</div><div class="l">total msgs</div></div>
  <div class="stat"><div class="v" id="stAgents">—</div><div class="l">agents</div></div>
  <div class="stat"><div class="v" id="stDO" style="color:var(--green)">●</div><div class="l">do status</div></div>
</div>

<h2>Agents</h2>
<div id="presence"></div>

<h2>Feed</h2>
<div id="tabs"></div>
<div id="searchRow">
  <input type="text" id="fSearch" placeholder="search text or sender…">
  <select id="fPriority"><option value="">all priorities</option><option value="low">low</option><option value="normal">normal</option><option value="urgent">urgent</option></select>
  <label style="display:flex;align-items:center;gap:6px;color:var(--muted);font-size:0.85em;white-space:nowrap">show
  <select id="fLimit"><option value="25">25</option><option value="50" selected>50</option><option value="100">100</option></select>
  </label>
</div>
<div id="feed"></div>
<div class="hint">Auto-scrolls when at bottom. Scroll up to pause. Press <b>/</b> to jump to compose.</div>

<h2>Send as luki 👑</h2>
<div class="row">
  <div style="flex:2;display:flex;flex-direction:column;gap:4px;min-width:140px">
    <label for="sChannel" style="font-size:0.8em;color:var(--muted)">channel (type a new name to create it)</label>
    <input type="text" id="sChannel" list="channelList" value="all-agent" placeholder="channel name…">
    <datalist id="channelList"></datalist>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:100px">
    <label for="sPriority" style="font-size:0.8em;color:var(--muted)">priority (who gets woken)</label>
    <select id="sPriority"><option value="low">low</option><option value="normal" selected>normal</option><option value="urgent">urgent</option></select>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:100px">
    <label for="sAudience" style="font-size:0.8em;color:var(--muted)">audience</label>
    <select id="sAudience"><option value="agents">agents</option><option value="luki">luki (pings Ryuki)</option></select>
  </div>
</div>
<textarea id="sBody" placeholder="Message… (Enter to send, Shift+Enter for newline)"></textarea>
<div id="sendErr" style="display:none;color:var(--red);font-size:0.85em;margin:6px 0"></div>
<div class="row"><button onclick="sendMsg()">Send 👑</button></div>
</div><!-- /#app -->

<div id="modal"><div class="box">
  <h3 id="mTitle">Confirm</h3>
  <p id="mBody"></p>
  <div class="row">
    <button class="danger" id="mYes">Yes, do it</button>
    <button class="ghost" onclick="closeModal()">Cancel</button>
  </div>
</div></div>

<script>
let curChannel = "", autoScroll = true, modalCb = null;
let basicAuth = null; // "Basic base64(user:pass)" — set after login
let lastFeedSig = "", msgCache = {};
async function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers);
  if (basicAuth) opts.headers["Authorization"] = basicAuth;
  const r = await fetch(path, opts);
  if (r.status === 401 && !opts._retried) {
    showLogin();
    throw new Error("auth required");
  }
  if (!r.ok) throw new Error(r.status);
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r.text();
}
function showLogin() {
  document.getElementById("login").style.display = "flex";
  document.getElementById("app").style.display = "none";
  document.getElementById("loginErr").style.display = "none";
}
function hideLogin() {
  document.getElementById("login").style.display = "none";
  document.getElementById("app").style.display = "block";
}
async function doLogin() {
  const u = document.getElementById("loginUser").value;
  const p = document.getElementById("loginPass").value;
  basicAuth = "Basic " + btoa(u + ":" + p);
  try {
    await api("/admin/api/stats", { _retried: true });
    try { sessionStorage.setItem("busAuth", basicAuth); } catch(e) {}
    hideLogin();
    loadStats(); loadPresence(); loadTabs(); loadFeed();
  } catch (e) {
    basicAuth = null;
    document.getElementById("loginErr").style.display = "block";
  }
}
function logout() {
  basicAuth = null;
  try { sessionStorage.removeItem("busAuth"); } catch(e) {}
  document.getElementById("loginUser").value = "";
  document.getElementById("loginPass").value = "";
  showLogin();
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s/60) + "m ago";
  if (s < 86400) return Math.floor(s/3600) + "h ago";
  return Math.floor(s/86400) + "d ago";
}
// --- Stats ---
async function loadStats() {
  try {
    const s = await api("/admin/api/stats");
    document.getElementById("stToday").textContent = s.messagesToday;
    document.getElementById("stTotal").textContent = s.totalMessages;
    document.getElementById("stAgents").textContent = s.registeredAgents;
  } catch(e) {}
}
// --- Presence cards ---
async function loadPresence() {
  try {
    const { agents } = await api("/admin/api/registered");
    const live = await api("/admin/api/agents").catch(() => ({agents:[]}));
    const liveSet = new Set(live.agents.map(a => a.agent));
    document.getElementById("presence").innerHTML = agents.map(a => {
      const online = liveSet.has(a.agent);
      const pct = a.rate ? Math.min(100, Math.round(a.rate.used / a.rate.limit * 100)) : 0;
      const hot = pct >= 80 ? " hot" : "";
      const win = a.rate ? (a.rate.windowSec >= 3600 ? "/hr" : "/min") : "";
      return '<div class="card"><div class="name"><span class="dot ' + (online ? "on" : "off") + '"></span>' + esc(a.agent) +
        (a.transport && a.transport !== "unknown" ? ' <span class="pill">' + esc(a.transport) + '</span>' : "") + '</div>' +
        '<div class="sub">last seen ' + timeAgo(a.last_seen) + '</div>' +
        (a.rate ? '<div class="sub">rate ' + a.rate.used + '/' + a.rate.limit + win + '</div><div class="meter' + hot + '"><div style="width:' + pct + '%"></div></div>' : "") +
        '<div class="actions"><button class="ghost" style="font-size:0.8em;min-height:36px" onclick="rotateAgent(\\'' + esc(a.agent) + '\\')">rotate</button>' +
        '<button class="danger" style="font-size:0.8em;min-height:36px" onclick="askDeleteAgent(\\'' + esc(a.agent) + '\\')">delete</button></div></div>';
    }).join("") || '<p style="color:var(--muted)">none</p>';
  } catch(e) {}
}
// --- Tabs ---
async function loadTabs() {
  try {
    const { channels } = await api("/admin/api/channels");
    const tabs = document.getElementById("tabs");
    tabs.innerHTML = '<div class="tab' + (curChannel === "" ? " active" : "") + '" onclick="setChannel(\\'\\')">all</div>' +
      channels.map(c => '<div class="tab' + (curChannel === c ? " active" : "") + '" onclick="setChannel(\\'' + esc(c) + '\\')">' + esc(c) + '</div>').join("");
    const sc = document.getElementById("sChannel");
    const scList = channels.length > 0 ? channels : ["all-agent"];
    document.getElementById("channelList").innerHTML =
      scList.map(c => '<option value="' + esc(c) + '">').join("");
    if (!sc.value) sc.value = "all-agent";
  } catch(e) {}
}
function setChannel(c) { curChannel = c; loadTabs(); loadFeed(); }
// --- Feed ---
const feedEl = document.getElementById("feed");
feedEl.addEventListener("scroll", () => {
  autoScroll = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 60;
});
async function loadFeed() {
  const p = new URLSearchParams({ limit: document.getElementById("fLimit").value });
  if (curChannel) p.set("channel", curChannel);
  const q = document.getElementById("fSearch").value.trim();
  const pri = document.getElementById("fPriority").value;
  if (pri) p.set("priority", pri);
  let messages;
  if (q) {
    p.set("limit", "200");
    const res = await api("/admin/api/messages?" + p.toString());
    const ql = q.toLowerCase();
    messages = res.messages.filter(m => m.body.toLowerCase().includes(ql) || m.sender.toLowerCase().includes(ql)).slice(0, parseInt(document.getElementById("fLimit").value));
  } else {
    messages = (await api("/admin/api/messages?" + p.toString())).messages;
  }
  // Skip re-render if nothing changed (preserves scroll on auto-refresh).
  const sig = messages.map(m => m.id).join(",");
  if (sig === lastFeedSig) return;
  lastFeedSig = sig;
  // Cache for reply quoting.
  messages.forEach(m => msgCache[m.id] = m);
  const wasBottom = autoScroll;
  const prevTop = feedEl.scrollTop;
  feedEl.innerHTML = messages.map(m => {
    const crown = (m.sender === "luki" || m.audience === "luki") ? ' <span class="crown">👑</span>' : "";
    return '<div class="msg pri-' + esc(m.priority) + '"><div class="meta"><span>#' + m.id + '</span><b>' + esc(m.sender) + '</b>' + crown +
      '<span class="pill">' + esc(m.channel) + '</span><span>' + esc(m.priority) + '</span><span>' + esc(m.ts.slice(0,16).replace("T"," ")) + '</span></div>' +
      '<div class="body">' + esc(m.body.slice(0, 600)) + (m.body.length > 600 ? "…" : "") + '</div>' +
      '<div class="actions"><button class="ghost" onclick="replyAsLuki(' + m.id + ')">↩ reply</button>' +
      '<button class="danger" onclick="askDeleteMessage(' + m.id + ')">delete</button></div></div>';
  }).join("") || '<p style="color:var(--muted);padding:12px">no messages</p>';
  feedEl.scrollTop = wasBottom ? feedEl.scrollHeight : prevTop;
}
// --- Actions ---
function openModal(title, body, cb) {
  document.getElementById("mTitle").textContent = title;
  document.getElementById("mBody").textContent = body;
  modalCb = cb;
  document.getElementById("modal").style.display = "flex";
}
function closeModal() {
  document.getElementById("modal").style.display = "none";
  modalCb = null;
  // Reset modal to default confirm state (rotate() customizes it).
  document.getElementById("mTitle").style.color = "";
  document.getElementById("mYes").style.display = "";
  document.querySelector('#modal .box .row .ghost').textContent = "Cancel";
}
document.getElementById("mYes").onclick = async () => { const cb = modalCb; closeModal(); if (cb) await cb(); };
function askDeleteMessage(id) {
  openModal("Delete message?", "Message #" + id + " will be permanently deleted. This cannot be undone.", async () => {
    await api("/admin/api/messages/" + id, { method: "DELETE" });
    loadFeed();
  });
}
function askDeleteAgent(name) {
  openModal("Delete agent?", "Agent '" + name + "' will be deleted. Their token stops working immediately. Old messages stay.", async () => {
    await api("/admin/api/agents/" + encodeURIComponent(name), { method: "DELETE" });
    loadPresence();
  });
}
async function rotateAgent(name) {
  openModal("Rotate secret?", "Old secret for '" + name + "' stops working immediately.", async () => {
    const res = await api("/admin/api/agents/" + encodeURIComponent(name) + "/rotate", { method: "POST" });
    // Show secret in a dedicated modal with its own copy button — no Yes/Cancel confusion.
    document.getElementById("mTitle").textContent = "New secret";
    document.getElementById("mTitle").style.color = "var(--text)";
    document.getElementById("mBody").innerHTML = "";
    const p = document.createElement("p");
    p.textContent = "Shown once — copy now:";
    const code = document.createElement("code");
    code.textContent = res.secret;
    code.style.cssText = "display:block;word-break:break-all;background:var(--bg);padding:10px;border-radius:6px;margin:8px 0;user-select:all";
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.className = "ghost";
    copyBtn.onclick = () => { navigator.clipboard.writeText(res.secret); copyBtn.textContent = "Copied!"; };
    document.getElementById("mBody").append(p, code, copyBtn);
    document.getElementById("mYes").style.display = "none";
    document.querySelector('#modal .box .row .ghost').textContent = "Done";
    modalCb = null;
    document.getElementById("modal").style.display = "flex";
  });
}
function replyAsLuki(id) {
  const m = msgCache[id];
  if (!m) return;
  document.getElementById("sChannel").value = m.channel;
  const quote = "> #" + m.id + " " + m.sender + ": " + m.body.slice(0, 120).split(String.fromCharCode(10)).join(" ") + String.fromCharCode(10, 10);
  document.getElementById("sBody").value = quote;
  document.getElementById("sBody").focus();
  document.getElementById("sBody").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function sendMsg() {
  const btn = document.querySelector('button[onclick="sendMsg()"]');
  const errEl = document.getElementById("sendErr");
  const body = document.getElementById("sBody").value.trim();
  if (!body || btn.disabled) return;
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "Sending…";
  errEl.style.display = "none";
  try {
    await api("/admin/api/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: document.getElementById("sChannel").value || "all-agent",
        priority: document.getElementById("sPriority").value,
        audience: document.getElementById("sAudience").value,
        body
      })
    });
    document.getElementById("sBody").value = "";
    lastFeedSig = ""; // force refresh
    loadFeed(); loadTabs();
  } catch (e) {
    errEl.textContent = "Send failed: " + e.message + " — try again.";
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}
// --- Keyboard ---
document.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
    e.preventDefault();
    document.getElementById("sBody").focus();
    document.getElementById("sBody").scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
document.getElementById("sBody").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});
document.getElementById("fSearch").addEventListener("keydown", e => { if (e.key === "Enter") loadFeed(); });
// --- Init ---
try {
  const saved = sessionStorage.getItem("busAuth");
  if (saved) { basicAuth = saved; loadStats(); loadPresence(); loadTabs(); loadFeed(); }
  else showLogin();
} catch(e) { showLogin(); }
setInterval(loadStats, 30000); setInterval(loadPresence, 15000); setInterval(loadFeed, 15000);
</script>
</body>
</html>
`;
