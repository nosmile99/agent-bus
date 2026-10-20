/********************************************************************
 * REAL BACKEND API CLIENT (Basic auth, sessionStorage `busBasic`)
 ********************************************************************/

export const busAuth = {
  get() { return sessionStorage.getItem('busBasic'); },
  set(v) { sessionStorage.setItem('busBasic', v); },
  clear() { sessionStorage.removeItem('busBasic'); }
};

export async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Authorization': 'Basic ' + (busAuth.get() || ''),
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) {
    busAuth.clear();
    showLogin('Session expired — sign in again.');
    throw new Error('unauthorized');
  }
  return res;
}

export async function apiReq(method, path, body) {
  const r = await apiFetch(path, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || (method + ' ' + path + ' → ' + r.status));
  return data;
}

export const api = {
  get: (p) => apiReq('GET', p),
  post: (p, b) => apiReq('POST', p, b || {}),
  put: (p, b) => apiReq('PUT', p, b || {}),
  del: (p) => apiReq('DELETE', p),
};

export function showLogin(msg) {
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
    const user = document.getElementById('loginUser');
    if (user) user.focus();
  }, 80);
}

export function hideLogin() {
  const ov = document.getElementById('loginOverlay');
  if (!ov) return;
  ov.classList.add('hidden');
  ov.classList.remove('flex');
  const pass = document.getElementById('loginPass');
  if (pass) pass.value = '';
}

let loginSuccessHandler = null;
export function setLoginSuccessHandler(fn) {
  loginSuccessHandler = fn;
}

export async function handleLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const user = (document.getElementById('loginUser')?.value || '').trim();
  const pass = document.getElementById('loginPass')?.value || '';
  if (!user || !pass) return;
  busAuth.set(btoa(user + ':' + pass));
  const btn = document.getElementById('loginBtn');
  if (btn) btn.textContent = 'Verifying…';
  try {
    if (loginSuccessHandler) {
      await loginSuccessHandler(user);
    }
    hideLogin();
  } catch (err) {
    busAuth.clear();
    showLogin('Invalid credentials — try again.');
  } finally {
    if (btn) btn.textContent = 'Sign in';
  }
}

let signOutHandler = null;
export function setSignOutHandler(fn) {
  signOutHandler = fn;
}

export function doSignOut() {
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
