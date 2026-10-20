// Real Backend API Client (hono/client hc, Basic auth, sessionStorage `busBasic`)
import { hc } from 'hono/client';
import type { AppType } from '../../src-backend/routes/index.js';

export const busAuth = {
  get(): string | null {
    return sessionStorage.getItem('busBasic');
  },
  set(v: string): void {
    sessionStorage.setItem('busBasic', v);
  },
  clear(): void {
    sessionStorage.removeItem('busBasic');
  },
};

// Type-safe RPC client via hono/client
export const client = hc<AppType>('/', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    const auth = busAuth.get();
    if (auth && !headers.has('Authorization')) {
      headers.set('Authorization', 'Basic ' + auth);
    }
    return fetch(input, { ...init, headers });
  },
});

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      Authorization: 'Basic ' + (busAuth.get() || ''),
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    busAuth.clear();
    showLogin('Session expired — sign in again.');
    throw new Error('unauthorized');
  }
  return res;
}

export async function apiReq<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await apiFetch(path, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown> & T;
  if (!r.ok) {
    const errMsg = typeof data.error === 'string' ? data.error : method + ' ' + path + ' → ' + r.status;
    throw new Error(errMsg);
  }
  return data;
}

export const api = {
  get: <T = unknown>(p: string): Promise<T> => apiReq<T>('GET', p),
  post: <T = unknown>(p: string, b?: unknown): Promise<T> => apiReq<T>('POST', p, b || {}),
  put: <T = unknown>(p: string, b?: unknown): Promise<T> => apiReq<T>('PUT', p, b || {}),
  del: <T = unknown>(p: string): Promise<T> => apiReq<T>('DELETE', p),
  hc: client,
};


export function showLogin(msg?: string): void {
  const ov = document.getElementById('loginOverlay');
  if (!ov) return;
  ov.classList.remove('hidden');
  ov.classList.add('flex');
  const err = document.getElementById('loginError');
  if (err) {
    if (msg) {
      err.textContent = msg;
      err.classList.remove('hidden');
    } else {
      err.classList.add('hidden');
    }
  }
  setTimeout(() => {
    const user = document.getElementById('loginUser') as HTMLInputElement | null;
    if (user) user.focus();
  }, 80);
}

export function hideLogin(): void {
  const ov = document.getElementById('loginOverlay');
  if (!ov) return;
  ov.classList.add('hidden');
  ov.classList.remove('flex');
  const pass = document.getElementById('loginPass') as HTMLInputElement | null;
  if (pass) pass.value = '';
}

let loginSuccessHandler: ((user: string) => Promise<void>) | null = null;
export function setLoginSuccessHandler(fn: (user: string) => Promise<void>): void {
  loginSuccessHandler = fn;
}

export async function handleLogin(e?: Event): Promise<void> {
  if (e && e.preventDefault) e.preventDefault();
  const userInput = document.getElementById('loginUser') as HTMLInputElement | null;
  const passInput = document.getElementById('loginPass') as HTMLInputElement | null;
  const user = (userInput?.value || '').trim();
  const pass = passInput?.value || '';
  if (!user || !pass) return;
  busAuth.set(btoa(user + ':' + pass));
  const btn = document.getElementById('loginBtn');
  if (btn) btn.textContent = 'Verifying…';
  try {
    if (loginSuccessHandler) {
      await loginSuccessHandler(user);
    }
    hideLogin();
  } catch (_err) {
    busAuth.clear();
    showLogin('Invalid credentials — try again.');
  } finally {
    if (btn) btn.textContent = 'Sign in';
  }
}

let signOutHandler: (() => void) | null = null;
export function setSignOutHandler(fn: () => void): void {
  signOutHandler = fn;
}

export function doSignOut(): void {
  busAuth.clear();
  if (signOutHandler) {
    signOutHandler();
  }
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.classList.remove('flex');
  }
  showLogin('Signed out.');
}
