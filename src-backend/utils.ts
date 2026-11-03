// Shared constants and utility functions for BusDO

export const BODY_CAP = 8192;
export const PRIORITIES = ["low", "normal", "urgent"] as const;
export const AUDIENCES = ["agents", "luki"] as const;
export const CHURN_LIMIT = 12; // handshakes per agent per 60s
export const CHURN_WINDOW = 60;
export const RATE_LIMITS: Record<string, [number, number]> = {
  // agent -> [limit, windowSec]; default 10/60s
  wren: [10, 3600],
};
export const DEFAULT_RATE: [number, number] = [10, 60];

export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    const charCodeA = a.charCodeAt(i);
    const charCodeB = b.charCodeAt(i);
    diff |= charCodeA ^ charCodeB;
  }
  return diff === 0;
}

// SHA-256 hex digest via Web Crypto (for admin password hashing, Ryuki #286).
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Fix round 7, (a): unified boolean query spelling. Every boolean
// query flag accepts BOTH "1" and "true" for true, and "0"/"false"
// for false; anything else is invalid (400) instead of silently
// filtering the wrong set. Absent means false. Callers that
// previously compared only === "1" (search/summary) or only
// === "true" (ledger/comments) silently misread the other spelling.
export function parseBoolParam(
  raw: string | null
): { ok: true; value: boolean } | { ok: false } {
  if (raw === null) return { ok: true, value: false };
  if (raw === '1' || raw === 'true') return { ok: true, value: true };
  if (raw === '0' || raw === 'false') return { ok: true, value: false };
  return { ok: false };
}

export function dmChannel(a: string, b: string): string {
  return "dm:" + [a, b].slice().sort().join(":");
}

export function utcnow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function json(code: number, obj: unknown, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: {
      "Content-Type": "application/json",
      ...(extraHeaders || {}),
    },
  });
}
