// node_modules/hono/dist/client/utils.js
var mergePath = (base, path) => {
  base = base.replace(/\/+$/, "");
  base = base + "/";
  path = path.replace(/^\/+/, "");
  return base + path;
};
var replaceUrlParam = (urlString, params) => {
  for (const [k, v] of Object.entries(params)) {
    const reg = new RegExp("/:" + k + "(?:{[^/]+})?\\??(?=/|$)");
    urlString = urlString.replace(reg, () => v ? `/${v}` : "");
  }
  return urlString;
};
var buildSearchParams = (query) => {
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === void 0) continue;
    if (Array.isArray(v)) for (const v2 of v) {
      if (v2 === void 0) continue;
      searchParams.append(k, v2);
    }
    else searchParams.set(k, v);
  }
  return searchParams;
};
var replaceUrlProtocol = (urlString, protocol) => {
  switch (protocol) {
    case "ws":
      return urlString.replace(/^http/, "ws");
    case "http":
      return urlString.replace(/^ws/, "http");
  }
};
var removeIndexString = (urlString) => {
  if (/^https?:\/\/[^\/]+?\/index(?=\?|$)/.test(urlString)) return urlString.replace(/\/index(?=\?|$)/, "/");
  return urlString.replace(/\/index(?=\?|$)/, "");
};
function isObject(item) {
  return typeof item === "object" && item !== null && !Array.isArray(item);
}
function deepMerge(target, source) {
  if (!isObject(target) && !isObject(source)) return source;
  const merged = { ...target };
  for (const key in source) {
    const value = source[key];
    if (isObject(merged[key]) && isObject(value)) merged[key] = deepMerge(merged[key], value);
    else merged[key] = value;
  }
  return merged;
}

// node_modules/hono/dist/utils/cookie.js
var validCookieNameRegEx = /^[\w!#$%&'*.^`|~+-]+$/;
var _serialize = (name, value, opt = {}) => {
  if (!validCookieNameRegEx.test(name)) throw new Error("Invalid cookie name");
  let cookie = `${name}=${value}`;
  if (name.startsWith("__Secure-") && !opt.secure) throw new Error("__Secure- Cookie must have Secure attributes");
  if (name.startsWith("__Host-")) {
    if (!opt.secure) throw new Error("__Host- Cookie must have Secure attributes");
    if (opt.path !== "/") throw new Error('__Host- Cookie must have Path attributes with "/"');
    if (opt.domain) throw new Error("__Host- Cookie must not have Domain attributes");
  }
  for (const key of [
    "domain",
    "path",
    "sameSite",
    "priority"
  ]) if (opt[key] && /[;\r\n]/.test(opt[key])) throw new Error(`${key} must not contain ";", "\\r", or "\\n"`);
  if (opt && typeof opt.maxAge === "number" && opt.maxAge >= 0) {
    if (opt.maxAge > 3456e4) throw new Error("Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration.");
    cookie += `; Max-Age=${opt.maxAge | 0}`;
  }
  if (opt.domain && opt.prefix !== "host") cookie += `; Domain=${opt.domain}`;
  if (opt.path) cookie += `; Path=${opt.path}`;
  if (opt.expires) {
    if (opt.expires.getTime() - Date.now() > 3456e7) throw new Error("Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future.");
    cookie += `; Expires=${opt.expires.toUTCString()}`;
  }
  if (opt.httpOnly) cookie += "; HttpOnly";
  if (opt.secure) cookie += "; Secure";
  if (opt.sameSite) cookie += `; SameSite=${opt.sameSite.charAt(0).toUpperCase() + opt.sameSite.slice(1)}`;
  if (opt.priority) cookie += `; Priority=${opt.priority.charAt(0).toUpperCase() + opt.priority.slice(1)}`;
  if (opt.partitioned) {
    if (!opt.secure) throw new Error("Partitioned Cookie must have Secure attributes");
    cookie += "; Partitioned";
  }
  return cookie;
};
var serialize = (name, value, opt) => {
  value = encodeURIComponent(value);
  return _serialize(name, value, opt);
};

// node_modules/hono/dist/client/client.js
var createProxy = (callback, path) => {
  return new Proxy(() => {
  }, {
    get(_obj, key) {
      if (typeof key !== "string" || key === "then") return;
      return createProxy(callback, [...path, key]);
    },
    apply(_1, _2, args) {
      return callback({
        path,
        args
      });
    }
  });
};
var appendQueryParams = (url, searchParams) => {
  const queryString = searchParams.toString();
  return queryString ? `${url}?${queryString}` : url;
};
var ClientRequestImpl = class {
  url;
  method;
  buildSearchParams;
  queryParams = void 0;
  pathParams = {};
  rBody;
  cType = void 0;
  constructor(url, method, options) {
    this.url = url;
    this.method = method;
    this.buildSearchParams = options.buildSearchParams;
  }
  fetch = async (args, opt) => {
    if (args) {
      if (args.query) this.queryParams = this.buildSearchParams(args.query);
      if (args.form) {
        const form2 = new FormData();
        for (const [k, v] of Object.entries(args.form)) {
          if (v === void 0) continue;
          if (Array.isArray(v)) for (const v2 of v) {
            if (v2 === void 0) continue;
            form2.append(k, v2);
          }
          else form2.append(k, v);
        }
        this.rBody = form2;
      }
      if (args.json !== void 0) {
        this.rBody = JSON.stringify(args.json);
        this.cType = "application/json";
      }
      if (args.param) this.pathParams = args.param;
    }
    let methodUpperCase = this.method.toUpperCase();
    const headerValues = {
      ...args?.header,
      ...typeof opt?.headers === "function" ? await opt.headers() : opt?.headers
    };
    if (args?.cookie) {
      const cookies = [];
      for (const [key, value] of Object.entries(args.cookie)) {
        if (value === void 0) continue;
        cookies.push(serialize(key, value));
      }
      if (cookies.length > 0) headerValues["Cookie"] = cookies.join("; ");
    }
    if (this.cType) headerValues["Content-Type"] = this.cType;
    const headers = new Headers();
    for (const [key, value] of Object.entries(headerValues)) if (value !== void 0) headers.set(key, value);
    let url = this.url;
    url = removeIndexString(url);
    url = replaceUrlParam(url, this.pathParams);
    if (this.queryParams) url = appendQueryParams(url, this.queryParams);
    methodUpperCase = this.method.toUpperCase();
    const setBody = !(methodUpperCase === "GET" || methodUpperCase === "HEAD");
    return (opt?.fetch || fetch)(url, {
      body: setBody ? this.rBody : void 0,
      method: methodUpperCase,
      headers,
      ...opt?.init
    });
  };
};
var hc = (baseUrl, options) => createProxy(function proxyCallback(opts) {
  const buildSearchParamsOption = options?.buildSearchParams ?? buildSearchParams;
  const parts = [...opts.path];
  const lastParts = parts.slice(-3).reverse();
  if (lastParts[0] === "toString") {
    if (lastParts[1] === "name") return lastParts[2] || "";
    return proxyCallback.toString();
  }
  if (lastParts[0] === "valueOf") {
    if (lastParts[1] === "name") return lastParts[2] || "";
    return proxyCallback;
  }
  let method = "";
  if (/^\$/.test(lastParts[0])) {
    const last = parts.pop();
    if (last) method = last.replace(/^\$/, "");
  }
  const path = parts.join("/");
  const url = mergePath(baseUrl, path);
  if (method === "url" || method === "path") {
    let result = removeIndexString(url);
    if (opts.args[0]) {
      if (opts.args[0].param) result = replaceUrlParam(result, opts.args[0].param);
      if (opts.args[0].query) result = appendQueryParams(result, buildSearchParamsOption(opts.args[0].query));
    }
    if (method === "url") return new URL(result);
    return result.slice(baseUrl.replace(/\/+$/, "").length).replace(/^\/?/, "/");
  }
  if (method === "ws") {
    const normalizedUrl = removeIndexString(url);
    const webSocketUrl = replaceUrlProtocol(opts.args[0]?.param ? replaceUrlParam(normalizedUrl, opts.args[0].param) : normalizedUrl, "ws");
    const targetUrl = new URL(webSocketUrl);
    const queryParams = opts.args[0]?.query;
    if (queryParams) buildSearchParamsOption(queryParams).forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });
    const establishWebSocket = (...args) => {
      if (options?.webSocket !== void 0 && typeof options.webSocket === "function") return options.webSocket(...args);
      return new WebSocket(...args);
    };
    return establishWebSocket(targetUrl.toString());
  }
  const req = new ClientRequestImpl(url, method, { buildSearchParams: buildSearchParamsOption });
  if (method) {
    options ??= {};
    const reqOptions = { ...opts.args[1] };
    const baseHeaders = options.headers;
    const reqHeaders = reqOptions.headers;
    if (baseHeaders && reqHeaders) reqOptions.headers = async () => ({
      ...typeof baseHeaders === "function" ? await baseHeaders() : baseHeaders,
      ...typeof reqHeaders === "function" ? await reqHeaders() : reqHeaders
    });
    const args = deepMerge(options, reqOptions);
    return req.fetch(opts.args[0], args);
  }
  return req;
}, []);

// src-frontend/js/api.ts
var busAuth = {
  get() {
    return sessionStorage.getItem("busBasic");
  },
  set(v) {
    sessionStorage.setItem("busBasic", v);
  },
  clear() {
    sessionStorage.removeItem("busBasic");
  }
};
var client = hc("/", {
  fetch: (input2, init) => {
    const headers = new Headers(init?.headers || {});
    const auth = busAuth.get();
    if (auth && !headers.has("Authorization")) {
      headers.set("Authorization", "Basic " + auth);
    }
    return fetch(input2, { ...init, headers });
  }
});
async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      Authorization: "Basic " + (busAuth.get() || ""),
      "Content-Type": "application/json",
      ...opts.headers || {}
    }
  });
  if (res.status === 401) {
    busAuth.clear();
    showLogin("Session expired \u2014 sign in again.");
    throw new Error("unauthorized");
  }
  return res;
}
async function apiReq(method, path, body) {
  const r = await apiFetch(path, {
    method,
    body: body !== void 0 ? JSON.stringify(body) : void 0
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const errMsg = typeof data.error === "string" ? data.error : method + " " + path + " \u2192 " + r.status;
    throw new Error(errMsg);
  }
  return data;
}
var api = {
  get: (p) => apiReq("GET", p),
  post: (p, b) => apiReq("POST", p, b || {}),
  put: (p, b) => apiReq("PUT", p, b || {}),
  del: (p) => apiReq("DELETE", p),
  hc: client
};
function showLogin(msg) {
  const ov = document.getElementById("loginOverlay");
  if (!ov) return;
  ov.classList.remove("hidden");
  ov.classList.add("flex");
  const err = document.getElementById("loginError");
  if (err) {
    if (msg) {
      err.textContent = msg;
      err.classList.remove("hidden");
    } else {
      err.classList.add("hidden");
    }
  }
  setTimeout(() => {
    const user = document.getElementById("loginUser");
    if (user) user.focus();
  }, 80);
}
function hideLogin() {
  const ov = document.getElementById("loginOverlay");
  if (!ov) return;
  ov.classList.add("hidden");
  ov.classList.remove("flex");
  const pass = document.getElementById("loginPass");
  if (pass) pass.value = "";
}
var loginSuccessHandler = null;
function setLoginSuccessHandler(fn) {
  loginSuccessHandler = fn;
}
async function handleLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const userInput = document.getElementById("loginUser");
  const passInput = document.getElementById("loginPass");
  const user = (userInput?.value || "").trim();
  const pass = passInput?.value || "";
  if (!user || !pass) return;
  busAuth.set(btoa(user + ":" + pass));
  const btn = document.getElementById("loginBtn");
  if (btn) btn.textContent = "Verifying\u2026";
  try {
    if (loginSuccessHandler) {
      await loginSuccessHandler(user);
    }
    hideLogin();
  } catch (_err) {
    busAuth.clear();
    showLogin("Invalid credentials \u2014 try again.");
  } finally {
    if (btn) btn.textContent = "Sign in";
  }
}
var signOutHandler = null;
function doSignOut() {
  busAuth.clear();
  if (signOutHandler) {
    signOutHandler();
  }
  const backdrop = document.getElementById("modal-backdrop");
  if (backdrop) {
    backdrop.classList.add("hidden");
    backdrop.classList.remove("flex");
  }
  showLogin("Signed out.");
}

// src-frontend/js/utils.ts
function currentEpoch() {
  return Math.floor(Date.now() / 1e3);
}
var NOW_EPOCH = currentEpoch();
setInterval(() => {
  NOW_EPOCH = currentEpoch();
}, 3e4);
function setNowEpoch(val) {
  NOW_EPOCH = val;
}
function nowIso() {
  return new Date(NOW_EPOCH * 1e3).toISOString();
}
var AGENT_COLORS = {
  nyx: { bg: "bg-indigo-100", text: "text-indigo-950", border: "border-indigo-800", dot: "bg-indigo-600", badge: "#3730A3" },
  nosmile99: { bg: "bg-emerald-100", text: "text-emerald-950", border: "border-emerald-800", dot: "bg-emerald-600", badge: "#065F46" },
  wren: { bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-800", dot: "bg-amber-600", badge: "#92400E" },
  luki: { bg: "bg-stone-200", text: "text-stone-900", border: "border-stone-700", dot: "bg-forest", badge: "#1E6F50" }
};
function getAgentStyle(name) {
  return AGENT_COLORS[name] || { bg: "bg-stone-200", text: "text-stone-900", border: "border-stone-700", dot: "bg-stone-600", badge: "#44403C" };
}
var PRIORITY_LABELS = {
  low: "Low",
  normal: "Normal",
  urgent: "Urgent"
};
var AUDIENCE_LABELS = {
  agents: "Agents",
  luki: "Just me"
};
var STATUS_LABELS = {
  todo: "To Do",
  doing: "In Progress",
  blocked: "Blocked",
  done: "Done"
};
var BLOCKED_REASON_LABELS = {
  "waiting-human": "Waiting on me",
  "waiting-task": "Waiting on another task",
  "waiting-external": "Waiting on external service"
};
function formatBlockedReason(kind) {
  return kind && BLOCKED_REASON_LABELS[kind] || "Waiting on me";
}
function tsToEpoch(ts) {
  if (ts == null) return 0;
  if (typeof ts === "number") return ts;
  const p = Date.parse(ts);
  return isNaN(p) ? 0 : Math.floor(p / 1e3);
}
function isTaskStale(task) {
  return task.status === "doing" && NOW_EPOCH - tsToEpoch(task.last_activity_at) > 86400;
}
function isTaskOverdue(task) {
  return Boolean(task.due_at && task.status !== "done" && NOW_EPOCH > task.due_at);
}
function formatRelEpoch(epochSec) {
  const ep = tsToEpoch(epochSec);
  if (!ep) return "\u2014";
  const diff = NOW_EPOCH - ep;
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60);
  const hours = Math.floor(abs / 3600);
  const days = Math.floor(abs / 86400);
  if (diff >= 0) {
    if (abs < 60) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 48) return `${hours}h ago`;
    return `${days}d ago`;
  } else {
    if (mins < 60) return `in ${mins}m`;
    if (hours < 48) return `in ${hours}h`;
    return `in ${days}d`;
  }
}
function formatFriendlyIsoTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}
function formatRelIso(isoStr) {
  if (!isoStr) return "never";
  const epoch = Math.floor(new Date(isoStr).getTime() / 1e3);
  return formatRelEpoch(epoch);
}
function escapeHtml(str) {
  if (str === null || str === void 0) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function getUserCommentCount(task) {
  return (task.comments || []).filter((c) => c.author !== "system").length;
}
function copyTokenText(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
  showToast("Copied to clipboard", text.slice(0, 36) + (text.length > 36 ? "\u2026" : ""), "green");
}
var horizScrolls = {};
function keepFieldAboveKeyboard(el) {
  if (!el) return;
  setTimeout(() => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 180);
}
function applySwipeResistance(dx, maxFree = 70) {
  if (Math.abs(dx) <= maxFree) return dx;
  const sign = Math.sign(dx);
  const extra = Math.abs(dx) - maxFree;
  return sign * (maxFree + extra * 0.35);
}

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var escapeRe = /[&<>'"]/;
var stringBufferToString = async (buffer, callbacks) => {
  let str = "";
  callbacks ||= [];
  const resolvedBuffer = await Promise.all(buffer);
  for (let i = resolvedBuffer.length - 1; ; i--) {
    str += resolvedBuffer[i];
    i--;
    if (i < 0) break;
    let r = resolvedBuffer[i];
    if (typeof r === "object") callbacks.push(...r.callbacks || []);
    const isEscaped = r.isEscaped;
    r = await (typeof r === "object" ? r.toString() : r);
    if (typeof r === "object") callbacks.push(...r.callbacks || []);
    if (r.isEscaped ?? isEscaped) str += r;
    else {
      const buf = [str];
      escapeToBuffer(r, buf);
      str = buf[0];
    }
  }
  return raw(str, callbacks);
};
var escapeToBuffer = (str, buffer) => {
  const match = str.search(escapeRe);
  if (match === -1) {
    buffer[0] += str;
    return;
  }
  let escape;
  let index;
  let lastIndex = 0;
  for (index = match; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34:
        escape = "&quot;";
        break;
      case 39:
        escape = "&#39;";
        break;
      case 38:
        escape = "&amp;";
        break;
      case 60:
        escape = "&lt;";
        break;
      case 62:
        escape = "&gt;";
        break;
      default:
        continue;
    }
    buffer[0] += str.substring(lastIndex, index) + escape;
    lastIndex = index + 1;
  }
  buffer[0] += str.substring(lastIndex, index);
};
var resolveCallbackSync = (str) => {
  const callbacks = str.callbacks;
  if (!callbacks?.length) return str;
  const buffer = [str];
  const context = {};
  callbacks.forEach((c) => c({
    phase: HtmlEscapedCallbackPhase.Stringify,
    buffer,
    context
  }));
  return buffer[0];
};

// node_modules/hono/dist/jsx/utils.js
var normalizeElementKeyMap = /* @__PURE__ */ new Map([
  ["className", "class"],
  ["htmlFor", "for"],
  ["crossOrigin", "crossorigin"],
  ["httpEquiv", "http-equiv"],
  ["itemProp", "itemprop"],
  ["fetchPriority", "fetchpriority"],
  ["noModule", "nomodule"],
  ["formAction", "formaction"]
]);
var normalizeIntrinsicElementKey = (key) => normalizeElementKeyMap.get(key) || key;
var invalidAttributeNameCharRe = /[\s"'<>/=`\\\x00-\x1f\x7f-\x9f]/;
var validAttributeNameCache = /* @__PURE__ */ new Set();
var validAttributeNameCacheMax = 1024;
var invalidTagNameCharRe = /^[!?]|[\s"'<>/=`\\\x00-\x1f\x7f-\x9f]/;
var validTagNameCache = /* @__PURE__ */ new Set();
var validTagNameCacheMax = 256;
var cacheValidName = (cache, max, name) => {
  if (cache.size >= max) cache.clear();
  cache.add(name);
};
var isValidTagName = (name) => {
  if (validTagNameCache.has(name)) return true;
  if (typeof name !== "string") return false;
  if (name.length === 0) return true;
  if (invalidTagNameCharRe.test(name)) return false;
  cacheValidName(validTagNameCache, validTagNameCacheMax, name);
  return true;
};
var isValidAttributeName = (name) => {
  if (validAttributeNameCache.has(name)) return true;
  const len = name.length;
  if (len === 0) return false;
  for (let i = 0; i < len; i++) {
    const c = name.charCodeAt(i);
    if (!(c >= 97 && c <= 122 || c >= 65 && c <= 90 || c >= 48 && c <= 57 || c === 45 || c === 95 || c === 46 || c === 58)) {
      if (!invalidAttributeNameCharRe.test(name)) {
        cacheValidName(validAttributeNameCache, validAttributeNameCacheMax, name);
        return true;
      } else return false;
    }
  }
  cacheValidName(validAttributeNameCache, validAttributeNameCacheMax, name);
  return true;
};
var invalidStylePropertyNameCharRe = /[\s"'():;\\/\[\]{}\x00-\x1f\x7f-\x9f]/;
var validStylePropertyNameCache = /* @__PURE__ */ new Set();
var validStylePropertyNameCacheMax = 1024;
var isValidStylePropertyName = (name) => {
  if (validStylePropertyNameCache.has(name)) return true;
  const len = name.length;
  if (len === 0) return false;
  for (let i = 0; i < len; i++) {
    const c = name.charCodeAt(i);
    if (!(c >= 97 && c <= 122 || c >= 65 && c <= 90 || c >= 48 && c <= 57 || c === 45 || c === 95)) {
      if (!invalidStylePropertyNameCharRe.test(name)) {
        cacheValidName(validStylePropertyNameCache, validStylePropertyNameCacheMax, name);
        return true;
      } else return false;
    }
  }
  cacheValidName(validStylePropertyNameCache, validStylePropertyNameCacheMax, name);
  return true;
};
var unsafeStyleValueCharRe = /[;"'\\/\[\](){}]/;
var hasUnsafeStyleValue = (value) => {
  if (!unsafeStyleValueCharRe.test(value)) return false;
  let quote = 0;
  const blockStack = [];
  for (let i = 0, len = value.length; i < len; i++) {
    const c = value.charCodeAt(i);
    if (c === 92) {
      if (i === len - 1) return true;
      i++;
    } else if (quote !== 0) {
      if (c === 10 || c === 12 || c === 13) return true;
      if (c === quote) quote = 0;
    } else if (c === 47 && value.charCodeAt(i + 1) === 42) {
      const end = value.indexOf("*/", i + 2);
      if (end === -1) return true;
      i = end + 1;
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 40) blockStack.push(41);
    else if (c === 91) blockStack.push(93);
    else if (c === 123 || c === 125) return true;
    else if (c === 41 || c === 93) {
      if (blockStack[blockStack.length - 1] !== c) return true;
      blockStack.pop();
    } else if (c === 59 && blockStack.length === 0) return true;
  }
  return quote !== 0 || blockStack.length !== 0;
};
var styleObjectForEach = (style2, fn) => {
  for (const [k, v] of Object.entries(style2)) {
    const key = k[0] === "-" || !/[A-Z]/.test(k) ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    if (!isValidStylePropertyName(key)) continue;
    if (v == null) {
      fn(key, null);
      continue;
    }
    let value;
    if (typeof v === "number") value = !key.match(/^(?:a|border-im|column(?:-c|s)|flex(?:$|-[^b])|grid-(?!.*gap)(?:ar|[^a])|font-w|li|or|sca|st|ta|wido|z)|ty$/) ? `${v}px` : `${v}`;
    else if (typeof v === "string") {
      if (hasUnsafeStyleValue(v)) continue;
      value = v;
    } else continue;
    fn(key, value);
  }
};

// node_modules/hono/dist/jsx/constants.js
var DOM_RENDERER = /* @__PURE__ */ Symbol("RENDERER");
var DOM_ERROR_HANDLER = /* @__PURE__ */ Symbol("ERROR_HANDLER");
var DOM_INTERNAL_TAG = /* @__PURE__ */ Symbol("INTERNAL");
var PERMALINK = /* @__PURE__ */ Symbol("PERMALINK");

// node_modules/hono/dist/jsx/dom/utils.js
var setInternalTagFlag = (fn) => {
  fn[DOM_INTERNAL_TAG] = true;
  return fn;
};

// node_modules/hono/dist/jsx/dom/context.js
var createContextProviderFunction = (values) => ({ value, children }) => {
  if (!children) return;
  const props = { children: [{
    tag: setInternalTagFlag(() => {
      values.push(value);
    }),
    props: {}
  }] };
  if (Array.isArray(children)) props.children.push(...children.flat());
  else props.children.push(children);
  props.children.push({
    tag: setInternalTagFlag(() => {
      values.pop();
    }),
    props: {}
  });
  const res = {
    tag: "",
    props,
    type: ""
  };
  res[DOM_ERROR_HANDLER] = (err) => {
    values.pop();
    throw err;
  };
  return res;
};

// node_modules/hono/dist/jsx/context.js
var globalContexts = [];
var alsProbed = false;
var asyncLocalStorage;
var fallbackStore;
var fallbackRendersInFlight = 0;
var warnedFallbackDefault = false;
var loadAsyncLocalStorage = () => {
  if (alsProbed) return asyncLocalStorage;
  alsProbed = true;
  const global = globalThis;
  let AsyncLocalStorage;
  for (const probe of [() => global.process?.getBuiltinModule?.("node:async_hooks")?.AsyncLocalStorage, () => global.process?.mainModule?.require?.("node:async_hooks")?.AsyncLocalStorage]) {
    try {
      AsyncLocalStorage = probe();
    } catch {
    }
    if (AsyncLocalStorage) break;
  }
  if (AsyncLocalStorage) asyncLocalStorage = new AsyncLocalStorage();
  return asyncLocalStorage;
};
var getCurrentStore = () => {
  return loadAsyncLocalStorage()?.getStore() || fallbackStore;
};
var warnIfStorelessAccess = () => {
  if (fallbackRendersInFlight > 0 && !warnedFallbackDefault) {
    warnedFallbackDefault = true;
    console.warn("hono/jsx: AsyncLocalStorage is unavailable in this runtime, so useContext() after an await in an async component falls back to the context default value during server-side rendering. To get provided values across await boundaries, use a runtime with AsyncLocalStorage (Node.js >= 20.16, Deno, Bun, or Cloudflare Workers with the nodejs_compat flag).");
  }
};
var getContextValuesIn = (store, context) => {
  if (!store) {
    warnIfStorelessAccess();
    return context.values;
  }
  let values = store.get(context);
  if (!values) {
    values = [context.values[0]];
    store.set(context, values);
  }
  return values;
};
var readContextValueIn = (store, context) => {
  if (!store) {
    warnIfStorelessAccess();
    return context.values.at(-1);
  }
  const values = store.get(context);
  return values?.length ? values.at(-1) : context.values[0];
};
var captureContextValues = (store) => (store ? globalContexts.filter((c) => store.has(c)) : globalContexts).map((c) => [c, readContextValueIn(store, c)]);
var resumeWithContextValues = (callback, store, contexts) => runWithRenderContext(() => {
  const currentStore = getCurrentStore();
  const valuesPerContext = contexts.map(([context, value]) => {
    const values = getContextValuesIn(currentStore, context);
    values.push(value);
    return values;
  });
  const popContextValues = () => {
    valuesPerContext.forEach((values) => {
      values.pop();
    });
  };
  try {
    const result = callback();
    if (result instanceof Promise) return result.finally(popContextValues);
    popContextValues();
    return result;
  } catch (e) {
    popContextValues();
    throw e;
  }
}, store);
var runWithRenderContext = (callback, resumeStore) => {
  if (getCurrentStore()) return callback();
  const store = resumeStore ?? /* @__PURE__ */ new WeakMap();
  const storage = loadAsyncLocalStorage();
  if (storage) return storage.run(store, callback);
  fallbackStore = store;
  let result;
  try {
    result = callback();
  } finally {
    fallbackStore = void 0;
  }
  if (!warnedFallbackDefault && result instanceof Promise) {
    fallbackRendersInFlight++;
    result = result.finally(() => {
      fallbackRendersInFlight--;
    });
  }
  return result;
};
var captureRenderContext = () => {
  const store = getCurrentStore();
  const contexts = captureContextValues(store);
  return (callback) => resumeWithContextValues(callback, store, contexts);
};
var createContext = (defaultValue) => {
  const values = [defaultValue];
  const context = ((props) => {
    const contextValues = getContextValuesIn(getCurrentStore(), context);
    contextValues.push(props.value);
    let rendered;
    try {
      rendered = typeof props.children === "string" ? renderChildren([props.children]) : isUntrustedObject(props.children) ? renderUntrustedObject(props.children) : props.children ? (Array.isArray(props.children) ? new JSXFragmentNode("", {}, props.children) : props.children).toString() : raw("");
    } catch (e) {
      contextValues.pop();
      throw e;
    }
    if (rendered instanceof Promise) return rendered.finally(() => contextValues.pop()).then((resString) => raw(resString, resString.callbacks));
    else {
      contextValues.pop();
      return raw(rendered);
    }
  });
  context.values = values;
  context.Provider = context;
  context[DOM_RENDERER] = createContextProviderFunction(values);
  globalContexts.push(context);
  return context;
};
var useContext = (context) => {
  return readContextValueIn(getCurrentStore(), context);
};

// node_modules/hono/dist/jsx/intrinsic-element/common.js
var deDupeKeyMap = {
  title: [],
  script: ["src"],
  style: ["data-href"],
  link: ["href"],
  meta: [
    "name",
    "httpEquiv",
    "charset",
    "itemProp"
  ]
};
var domRenderers = {};
var dataPrecedenceAttr = "data-precedence";
var isStylesheetLinkWithPrecedence = (props) => props.rel === "stylesheet" && "precedence" in props;
var shouldDeDupeByKey = (tagName, supportSort) => {
  if (tagName === "link") return supportSort;
  return deDupeKeyMap[tagName].length > 0;
};

// node_modules/hono/dist/_virtual/_rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
  let target = {};
  for (var name in all) __defProp(target, name, {
    get: all[name],
    enumerable: true
  });
  if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
  return target;
};

// node_modules/hono/dist/jsx/children.js
var toArray = (children) => Array.isArray(children) ? children : [children];

// node_modules/hono/dist/jsx/intrinsic-element/components.js
var components_exports = /* @__PURE__ */ __exportAll({
  button: () => button,
  form: () => form,
  input: () => input,
  link: () => link,
  meta: () => meta,
  script: () => script,
  style: () => style,
  title: () => title
});
var metaTagMap = /* @__PURE__ */ new WeakMap();
var insertIntoHead = (tagName, tag, props, precedence) => ({ buffer, context }) => {
  if (!buffer) return;
  const map = metaTagMap.get(context) || {};
  metaTagMap.set(context, map);
  const tags = map[tagName] ||= [];
  let duped = false;
  const deDupeKeys = deDupeKeyMap[tagName];
  const deDupeByKey = shouldDeDupeByKey(tagName, precedence !== void 0);
  if (deDupeByKey) LOOP: for (const [, tagProps] of tags) {
    if (tagName === "link" && !(tagProps.rel === "stylesheet" && tagProps["data-precedence"] !== void 0)) continue;
    for (const key of deDupeKeys) if ((tagProps?.[key] ?? null) === props?.[key]) {
      duped = true;
      break LOOP;
    }
  }
  if (duped) buffer[0] = buffer[0].replaceAll(tag, "");
  else if (deDupeByKey || tagName === "link") tags.push([
    tag,
    props,
    precedence
  ]);
  else tags.unshift([
    tag,
    props,
    precedence
  ]);
  if (buffer[0].indexOf("</head>") !== -1) {
    let insertTags;
    if (tagName === "link" || precedence !== void 0) {
      const precedences = [];
      insertTags = tags.map(([tag2, , tagPrecedence], index) => {
        if (tagPrecedence === void 0) return [
          tag2,
          Number.MAX_SAFE_INTEGER,
          index
        ];
        let order = precedences.indexOf(tagPrecedence);
        if (order === -1) {
          precedences.push(tagPrecedence);
          order = precedences.length - 1;
        }
        return [
          tag2,
          order,
          index
        ];
      }).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([tag2]) => tag2);
    } else insertTags = tags.map(([tag2]) => tag2);
    insertTags.forEach((tag2) => {
      buffer[0] = buffer[0].replaceAll(tag2, "");
    });
    buffer[0] = buffer[0].replace(/(?=<\/head>)/, () => insertTags.join(""));
  }
};
var returnWithoutSpecialBehavior = (tag, children, props) => renderChildren([new JSXNode(tag, props, toArray(children ?? []))]);
var documentMetadataTag = (tag, children, props, sort) => {
  if ("itemProp" in props) return returnWithoutSpecialBehavior(tag, children, props);
  let { precedence, blocking, ...restProps } = props;
  precedence = sort ? precedence ?? "" : void 0;
  if (sort) restProps[dataPrecedenceAttr] = precedence;
  const string = new JSXNode(tag, restProps, toArray(children || [])).toString();
  if (string instanceof Promise) return string.then((resString) => raw(resString, [...resString.callbacks || [], insertIntoHead(tag, resString, restProps, precedence)]));
  else return raw(string, [insertIntoHead(tag, string, restProps, precedence)]);
};
var title = ({ children, ...props }) => {
  const nameSpaceContext2 = getNameSpaceContext();
  if (nameSpaceContext2) {
    const context = useContext(nameSpaceContext2);
    if (context === "svg" || context === "head") return new JSXNode("title", props, toArray(children ?? []));
  }
  return documentMetadataTag("title", children, props, false);
};
var script = ({ children, ...props }) => {
  const nameSpaceContext2 = getNameSpaceContext();
  if (["src", "async"].some((k) => !props[k]) || nameSpaceContext2 && useContext(nameSpaceContext2) === "head") return returnWithoutSpecialBehavior("script", children, props);
  return documentMetadataTag("script", children, props, false);
};
var style = ({ children, ...props }) => {
  if (!["href", "precedence"].every((k) => k in props)) return returnWithoutSpecialBehavior("style", children, props);
  props["data-href"] = props.href;
  delete props.href;
  return documentMetadataTag("style", children, props, true);
};
var link = ({ children, ...props }) => {
  if (["onLoad", "onError"].some((k) => k in props) || props.rel === "stylesheet" && (!("precedence" in props) || "disabled" in props)) return returnWithoutSpecialBehavior("link", children, props);
  return documentMetadataTag("link", children, props, isStylesheetLinkWithPrecedence(props));
};
var meta = ({ children, ...props }) => {
  const nameSpaceContext2 = getNameSpaceContext();
  if (nameSpaceContext2 && useContext(nameSpaceContext2) === "head") return returnWithoutSpecialBehavior("meta", children, props);
  return documentMetadataTag("meta", children, props, false);
};
var newJSXNode = (tag, { children, ...props }) => new JSXNode(tag, props, toArray(children ?? []));
var form = (props) => {
  if (typeof props.action === "function") props.action = PERMALINK in props.action ? props.action[PERMALINK] : void 0;
  return newJSXNode("form", props);
};
var formActionableElement = (tag, props) => {
  if (typeof props.formAction === "function") props.formAction = PERMALINK in props.formAction ? props.formAction[PERMALINK] : void 0;
  return newJSXNode(tag, props);
};
var input = (props) => formActionableElement("input", props);
var button = (props) => formActionableElement("button", props);

// node_modules/hono/dist/jsx/base.js
var nameSpaceContext = void 0;
var getNameSpaceContext = () => nameSpaceContext;
var toSVGAttributeName = (key) => /[A-Z]/.test(key) && key.match(/^(?:al|basel|clip(?:Path|Rule)$|co|do|fill|fl|fo|gl|let|lig|i|marker[EMS]|o|pai|pointe|sh|st[or]|text[^L]|tr|u|ve|w)/) ? key.replace(/([A-Z])/g, "-$1").toLowerCase() : key;
var emptyTags = [
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
];
var booleanAttributes = [
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "download",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected"
];
var resolveFunctionComponentResult = (result, suspendedContext) => result.then((resolved) => {
  if (typeof resolved !== "string" && !Array.isArray(resolved) && !(resolved instanceof JSXNode)) return resolved;
  const children = Array.isArray(resolved) ? resolved : [resolved];
  const render = () => {
    const buffer = [""];
    childrenToStringToBuffer(children, buffer);
    return buffer.length === 1 ? raw(buffer[0], buffer.callbacks) : stringBufferToString(buffer, buffer.callbacks);
  };
  return suspendedContext ? suspendedContext(render) : runWithRenderContext(render);
});
var childrenToStringToBuffer = (children, buffer) => {
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i];
    if (typeof child === "string") escapeToBuffer(child, buffer);
    else if (typeof child === "boolean" || child === null || child === void 0) continue;
    else if (child instanceof JSXNode) child.toStringToBuffer(buffer);
    else if (typeof child === "number") buffer[0] += child;
    else if (child.isEscaped) {
      buffer[0] += child;
      const callbacks = child.callbacks;
      if (callbacks) {
        buffer.callbacks ||= [];
        buffer.callbacks.push(...callbacks);
      }
    } else if (child instanceof Promise) buffer.unshift("", child);
    else childrenToStringToBuffer(child, buffer);
  }
};
var renderChildren = (children) => runWithRenderContext(() => {
  const buffer = [""];
  childrenToStringToBuffer(children, buffer);
  return buffer.length === 1 ? raw(buffer[0], buffer.callbacks) : stringBufferToString(buffer, buffer.callbacks);
});
var isUntrustedObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof JSXNode) && !(value instanceof Promise) && !value.isEscaped && typeof value.toString === "function";
var renderUntrustedObject = (value) => {
  const stringified = value.toString();
  const escape = (result) => renderChildren([String(result)]);
  return stringified instanceof Promise ? stringified.then(escape) : escape(stringified);
};
var JSXNode = class {
  tag;
  props;
  key;
  children;
  isEscaped = true;
  constructor(tag, props, children) {
    if (typeof tag !== "function" && !isValidTagName(tag)) throw new Error(`Invalid JSX tag name: ${tag}`);
    this.tag = tag;
    this.props = props;
    this.children = children;
  }
  get type() {
    return this.tag;
  }
  get ref() {
    return this.props.ref || null;
  }
  toString() {
    const render = () => {
      const buffer = [""];
      this.toStringToBuffer(buffer);
      return buffer.length === 1 ? "callbacks" in buffer ? resolveCallbackSync(raw(buffer[0], buffer.callbacks)).toString() : buffer[0] : stringBufferToString(buffer, buffer.callbacks);
    };
    return runWithRenderContext(render);
  }
  toStringToBuffer(buffer) {
    const tag = this.tag;
    const props = this.props;
    let { children } = this;
    buffer[0] += `<${tag}`;
    const normalizeKey = tag === "svg" || nameSpaceContext && useContext(nameSpaceContext) === "svg" ? (key) => toSVGAttributeName(normalizeIntrinsicElementKey(key)) : (key) => normalizeIntrinsicElementKey(key);
    for (let [key, v] of Object.entries(props)) {
      key = normalizeKey(key);
      if (!isValidAttributeName(key)) continue;
      if (key === "children") {
      } else if (key === "style" && typeof v === "object") {
        let styleStr = "";
        styleObjectForEach(v, (property, value) => {
          if (value != null) styleStr += `${styleStr ? ";" : ""}${property}:${value}`;
        });
        buffer[0] += ' style="';
        escapeToBuffer(styleStr, buffer);
        buffer[0] += '"';
      } else if (typeof v === "string") {
        buffer[0] += ` ${key}="`;
        escapeToBuffer(v, buffer);
        buffer[0] += '"';
      } else if (v === null || v === void 0) {
      } else if (typeof v === "number" || v.isEscaped) buffer[0] += ` ${key}="${v}"`;
      else if (typeof v === "boolean" && booleanAttributes.includes(key)) {
        if (v) buffer[0] += ` ${key}=""`;
      } else if (key === "dangerouslySetInnerHTML") {
        if (children.length > 0) throw new Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
        children = [raw(v.__html)];
      } else if (v instanceof Promise) {
        buffer[0] += ` ${key}="`;
        buffer.unshift('"', v);
      } else if (typeof v === "function") {
        if (!key.startsWith("on") && key !== "ref") throw new Error(`Invalid prop '${key}' of type 'function' supplied to '${tag}'.`);
      } else {
        buffer[0] += ` ${key}="`;
        escapeToBuffer(v.toString(), buffer);
        buffer[0] += '"';
      }
    }
    if (emptyTags.includes(tag) && children.length === 0) {
      buffer[0] += "/>";
      return;
    }
    buffer[0] += ">";
    childrenToStringToBuffer(children, buffer);
    buffer[0] += `</${tag}>`;
  }
};
var JSXFunctionNode = class extends JSXNode {
  toStringToBuffer(buffer) {
    const { children } = this;
    const props = { ...this.props };
    if (children.length) props.children = children.length === 1 ? children[0] : children;
    const res = this.tag.call(null, props);
    if (typeof res === "boolean" || res == null) return;
    else if (res instanceof Promise) {
      if (globalContexts.length === 0) buffer.unshift("", resolveFunctionComponentResult(res));
      else buffer.unshift("", resolveFunctionComponentResult(res, captureRenderContext()));
    } else if (res instanceof JSXNode) res.toStringToBuffer(buffer);
    else if (Array.isArray(res)) childrenToStringToBuffer(res, buffer);
    else if (typeof res === "number" || res.isEscaped) {
      buffer[0] += res;
      if (res.callbacks) {
        buffer.callbacks ||= [];
        buffer.callbacks.push(...res.callbacks);
      }
    } else escapeToBuffer(res, buffer);
  }
};
var JSXFragmentNode = class extends JSXNode {
  toStringToBuffer(buffer) {
    childrenToStringToBuffer(this.children, buffer);
  }
};
var initDomRenderer = false;
var jsxFn = (tag, props, children) => {
  if (!initDomRenderer) {
    for (const k in domRenderers) components_exports[k][DOM_RENDERER] = domRenderers[k];
    initDomRenderer = true;
  }
  if (typeof tag === "function") return new JSXFunctionNode(tag, props, children);
  else if (components_exports[tag]) return new JSXFunctionNode(components_exports[tag], props, children);
  else if (tag === "svg" || tag === "head") {
    nameSpaceContext ||= createContext("");
    return new JSXNode(tag, props, [new JSXFunctionNode(nameSpaceContext, { value: tag }, children)]);
  } else return new JSXNode(tag, props, children);
};

// node_modules/hono/dist/jsx/jsx-dev-runtime.js
function jsxDEV(tag, props, key) {
  let node;
  if (!props || !("children" in props)) node = jsxFn(tag, props, []);
  else {
    const children = props.children;
    node = Array.isArray(children) ? jsxFn(tag, props, children) : jsxFn(tag, props, [children]);
  }
  node.key = key;
  return node;
}

// src-frontend/js/components/toast.tsx
function ToastItem({ title: title2, subtitle = "", tone = "ink" }) {
  const toneClasses = tone === "red" ? "bg-vermilion text-white border-ink" : tone === "green" ? "bg-forest text-white border-ink" : "bg-charcoal text-paper border-ink";
  return /* @__PURE__ */ jsxDEV(
    "div",
    {
      class: `${toneClasses} border-2 rounded-xl px-3.5 py-2.5 shadow-[0_4px_0_#161615] flex items-center justify-between gap-2 pointer-events-auto transition-all duration-200`,
      children: [
        /* @__PURE__ */ jsxDEV("div", { class: "min-w-0", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "font-sans text-sm font-bold truncate", children: escapeHtml(title2) }),
          subtitle && /* @__PURE__ */ jsxDEV("div", { class: "font-sans text-xs opacity-90 truncate", children: escapeHtml(subtitle) })
        ] }),
        /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-check-circle text-lg shrink-0 opacity-90" })
      ]
    }
  );
}
function showToast(title2, subtitle = "", tone = "ink") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.innerHTML = String(/* @__PURE__ */ jsxDEV(ToastItem, { title: title2, subtitle, tone }));
  const child = el.firstElementChild;
  if (!child) return;
  container.appendChild(child);
  setTimeout(() => {
    child.style.opacity = "0";
    child.style.transform = "translateY(-6px)";
    setTimeout(() => child.remove(), 200);
  }, 2500);
}

// src-frontend/js/state.ts
function evToPollRow(ev) {
  const p = ev.payload || {};
  const summary = p.summary || p.title || ev.type;
  return {
    id: ev.id,
    ts: ev.ts,
    type: ev.type,
    actor: ev.actor || null,
    project_id: ev.project_id || null,
    summary,
    adminOnly: ev.scope === "admin",
    payload: p
  };
}
var state = {
  activeTab: "messages",
  // 'messages' (default far-left) | 'needs-you' | 'kanban' | 'agents'
  adminUser: "luki",
  darkMode: false,
  // Bus Feed thread view state (null = main timeline, number = root message ID)
  openThreadMsgId: null,
  // Compact / Expanded Composer State for Bus Feed
  composerExpanded: false,
  composerDraft: {
    channel: "all-agent",
    priority: "normal",
    audience: "agents",
    body: "",
    reply_to: null
  },
  // Unsaved task drafts keyed by taskId
  taskDrafts: {},
  // Swiped task card ID for quick action reveal
  swipedTaskId: null,
  swipedTaskDir: null,
  // Real data (loaded via loadAll())
  agents: [],
  channels: [],
  channelMembers: {},
  messages: [],
  msgFilter: { channel: "ALL", sender: "ALL", priority: "ALL", q: "" },
  activeProjectId: null,
  projects: [],
  tasks: [],
  kanbanFilter: { q: "", status: "ALL", assignee: "ALL", label: "ALL", blocked_kind: "ALL", priority: "ALL", showFilters: false },
  // Unified poll cursor (composite ts + id)
  pollCursor: { ts: 0, id: 0 },
  retentionCutoffTs: 0,
  resyncRequired: false,
  pollInspectorAdminView: true,
  pollEvents: [],
  openTaskId: null
};
function getTaskDraft(task) {
  const existing = state.taskDrafts[task.id];
  if (!existing) {
    const draft = {
      title: task.title || "",
      description: task.description || "",
      notes: task.notes || "",
      commentDraft: "",
      dirty: false
    };
    state.taskDrafts[task.id] = draft;
    return draft;
  }
  return existing;
}
function getWaitingHumanTasks() {
  return state.tasks.filter((t) => t.status === "blocked" && t.blocked_kind === "waiting-human").sort((a, b) => (a.status_changed_at || a.updated_at) - (b.status_changed_at || b.updated_at));
}
function updateHeaderTelemetry() {
  const waitingCount = getWaitingHumanTasks().length;
  const needsBadge = document.getElementById("nav-needs-badge");
  if (needsBadge) {
    needsBadge.textContent = String(waitingCount);
    needsBadge.style.display = waitingCount > 0 ? "inline-block" : "none";
  }
  const msgBadge = document.getElementById("nav-msg-badge");
  if (msgBadge) msgBadge.textContent = String(state.messages.length);
  const wsAgents = state.agents.filter((a) => a.transport === "ws").length;
  const wsPill = document.getElementById("header-ws-pill");
  if (wsPill) wsPill.textContent = `${wsAgents}/${state.agents.length} live`;
}
async function refreshTasks() {
  if (!state.activeProjectId) {
    state.tasks = [];
    return;
  }
  const data = await api.get(`/admin/api/kanban/projects/${state.activeProjectId}/tasks`);
  state.tasks = (data.tasks || []).map((t) => ({
    id: t.id,
    project_id: t.project_id,
    title: t.title,
    description: t.description || "",
    notes: t.notes || "",
    status: t.status,
    priority: t.priority || "normal",
    blocked_kind: t.blocked_kind || null,
    assignee: t.assignee || null,
    claimed_at: t.claimed_at || null,
    labels: t.labels || [],
    comment_count: t.comment_count || 0,
    status_changed_at: t.status_changed_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
    last_activity_at: t.last_activity_at,
    created_by: t.created_by || null,
    todos: t.todos || [],
    comments: t.comments || []
  }));
}
async function refreshMessages() {
  const msgs = await api.get("/admin/api/messages");
  state.messages = (msgs.messages || []).map((m) => ({
    id: m.id,
    channel: m.channel,
    sender: m.sender,
    body: m.body,
    ts: m.ts,
    priority: m.priority || "normal",
    audience: m.audience || "agents",
    reply_to: m.reply_to || null,
    edited: !!m.edited
  }));
}
async function loadAll() {
  const [msgs, agents, channels, projects] = await Promise.all([
    api.get("/admin/api/messages"),
    api.get("/admin/api/registered"),
    api.get("/admin/api/channels"),
    api.get("/admin/api/kanban/projects")
  ]);
  state.messages = (msgs.messages || []).map((m) => ({
    id: m.id,
    channel: m.channel,
    sender: m.sender,
    body: m.body,
    ts: m.ts,
    priority: m.priority || "normal",
    audience: m.audience || "agents",
    reply_to: m.reply_to || null,
    edited: !!m.edited
  }));
  state.agents = (agents.agents || []).map((a) => ({
    agent: a.agent,
    role: a.role || "",
    created: a.created || a.created_at || "",
    last_seen: a.last_seen || null,
    rate: a.rate || { used: 0, limit: 10, windowSec: 60 },
    transport: a.transport || "poll",
    connectedSince: a.connectedSince || a.connected_since || null,
    connections: a.connections || 0,
    channels: a.channels || ["all-agent"]
  }));
  const channelList = [];
  state.channelMembers = {};
  for (const c of channels.channels || []) {
    const name = typeof c === "string" ? c : c.name || "";
    if (name) {
      channelList.push(name);
      const members = typeof c === "object" && Array.isArray(c.members) && c.members.length > 0 ? c.members : name.startsWith("dm:") ? name.split(":").slice(1) : state.agents.map((a) => a.agent);
      state.channelMembers[name] = members;
    }
  }
  state.channels = channelList;
  state.projects = (projects.projects || []).map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description || "",
    archived: !!p.archived,
    subscribers: p.subscribers || []
  }));
  if (!state.activeProjectId && state.projects.length > 0 && state.projects[0]) {
    state.activeProjectId = state.projects[0].id;
  }
  await refreshTasks();
  try {
    const poll = await api.get("/poll?since_ts=0&since_id=0&admin=1");
    if (poll.events && poll.events.length) {
      const last = poll.events[poll.events.length - 1];
      if (last) {
        state.pollCursor = { ts: last.ts, id: last.id };
        state.pollEvents = poll.events.slice(-50).reverse().map(evToPollRow);
      }
    }
    state.resyncRequired = false;
    state.retentionCutoffTs = Math.floor(Date.now() / 1e3) - 30 * 86400;
  } catch (_e) {
  }
}
async function loadTaskDetail(taskId) {
  const d = await api.get(`/admin/api/kanban/tasks/${taskId}`);
  const t = d.task || d;
  const task = state.tasks.find((x) => x.id === taskId);
  if (task && t) {
    task.todos = (t.todos || []).map((td) => ({
      id: td.id,
      task_id: taskId,
      text: td.text,
      done: td.done ? 1 : 0,
      sort_order: td.sort_order || 0
    }));
    task.comments = (t.comments || []).map((c) => ({
      id: c.id,
      task_id: taskId,
      author: c.author,
      body: c.body,
      ts: c.created_at || c.ts || 0
    }));
    task.labels = t.labels || task.labels;
    task.notes = t.notes !== void 0 && t.notes !== null ? t.notes : task.notes;
    task.description = t.description !== void 0 && t.description !== null ? t.description : task.description;
    task.title = t.title || task.title;
    task.comment_count = t.comment_count || task.comments.length;
  }
  return task;
}
async function manualRefresh() {
  try {
    await loadAll();
    if (window.renderMainViewport) window.renderMainViewport(true);
    if (state.openTaskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
    showToast("Refreshed", "All data reloaded from bus", "green");
  } catch (e) {
    showToast("Refresh failed", e instanceof Error ? e.message : String(e), "red");
  }
}

// src-frontend/js/poller.ts
var pollerTimer = null;
function startPoller() {
  if (pollerTimer) return;
  pollerTimer = setInterval(pollOnce, 8e3);
  void pollOnce();
}
async function pollOnce() {
  if (!busAuth.get()) return;
  try {
    const c = state.pollCursor;
    const data = await api.get(`/poll?since_ts=${c.ts}&since_id=${c.id}&admin=1`);
    if (data.resync_required && (c.ts !== 0 || c.id !== 0)) {
      state.resyncRequired = true;
      if (window.renderMainViewport) window.renderMainViewport(true);
      return;
    }
    const events = data.events || [];
    if (!events.length) return;
    let needsRender = false;
    for (const ev of events) {
      if (ev.ts > c.ts || ev.ts === c.ts && ev.id > c.id) {
        state.pollCursor = { ts: ev.ts, id: ev.id };
      }
      state.pollEvents.unshift(evToPollRow(ev));
      if (state.pollEvents.length > 100) state.pollEvents.pop();
      if (handlePollEvent(ev)) needsRender = true;
    }
    if (needsRender) {
      if (window.renderMainViewport) window.renderMainViewport(true);
      if (state.openTaskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
    }
    updateHeaderTelemetry();
  } catch (_e) {
  }
}
function handlePollEvent(ev) {
  const t = ev.type;
  if (t === "bus.message" || t === "bus.message.edited" || t === "bus.message.deleted") {
    void refreshMessages().then(() => {
      if (window.renderMainViewport) window.renderMainViewport(true);
    });
    showToast(t, evToPollRow(ev).summary, "ink");
    return false;
  }
  if (t.startsWith("kanban.")) {
    void refreshTasks().then(() => {
      if (window.renderMainViewport) window.renderMainViewport(true);
      if (state.openTaskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
    });
    const p = ev.payload || {};
    const row = evToPollRow(ev);
    const title2 = p.title;
    const id = p.id;
    showToast(t, title2 && id ? `#${id} ${title2}` : row.summary, t.includes("blocked") ? "red" : "green");
    return false;
  }
  if (t.startsWith("channel.") || t.startsWith("agent.")) {
    void loadAll().then(() => {
      if (window.renderMainViewport) window.renderMainViewport(true);
    });
    showToast(t, evToPollRow(ev).summary, "ink");
    return false;
  }
  return false;
}
function renderResyncBanner() {
  if (!state.resyncRequired) return "";
  return `
    <div class="mx-3.5 mt-3 caution-stripe-red border-2 border-ink rounded-2xl p-3.5 shadow-[0_3px_0_#161615] flex flex-col gap-2.5">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="font-mono text-[11px] font-bold uppercase text-vermilion flex items-center gap-1">
            <i class="ph-bold ph-warning-octagon text-sm"></i> resync_required
          </div>
          <div class="font-serif text-base font-bold text-ink mt-0.5">
            Poll Cursor Predates Retention Cutoff
          </div>
          <p class="text-xs text-ink/90 mt-0.5 leading-relaxed">
            Composite cursor <span class="font-mono font-bold">(${state.pollCursor.ts}, #${state.pollCursor.id})</span> is older than the retention window (<span class="font-mono">${state.retentionCutoffTs}</span>). Incremental delta polling is paused until you resync state.
          </p>
        </div>
      </div>
      <button onclick="resyncFromServer()" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
        <i class="ph-bold ph-arrows-clockwise text-base"></i>
        <span>Resync from Server</span>
      </button>
    </div>
  `;
}
async function resyncFromServer() {
  showToast("Resyncing...", "Reloading all state from server", "ink");
  try {
    await loadAll();
    state.resyncRequired = false;
    showToast("Resynced from server", "All lists refreshed", "green");
  } catch (_e) {
    showToast("Resync failed", _e instanceof Error ? _e.message : String(_e), "red");
  }
  if (window.renderMainViewport) window.renderMainViewport(true);
  const backdrop = document.getElementById("modal-backdrop");
  if (backdrop && !backdrop.classList.contains("hidden")) {
    const fn = window.openUnifiedPollSheet;
    if (fn) fn();
  }
}
window.resyncFromServer = resyncFromServer;

// src-frontend/js/components/modal.tsx
function showCustomModal(content) {
  const backdrop = document.getElementById("modal-backdrop");
  const sheet = document.getElementById("modal-sheet");
  if (!backdrop || !sheet) return;
  sheet.innerHTML = content;
  backdrop.classList.remove("hidden");
  backdrop.classList.add("flex");
}
function openModal(content) {
  showCustomModal(content);
}
function closeTopModal(e) {
  if (e && e.target && e.target.id !== "modal-backdrop") return;
  const backdrop = document.getElementById("modal-backdrop");
  if (backdrop) {
    backdrop.classList.add("hidden");
    backdrop.classList.remove("flex");
  }
}
function togglePollInspectorScope(isAdmin) {
  state.pollInspectorAdminView = isAdmin;
  openUnifiedPollSheet();
}
function openUnifiedPollSheet() {
  const visibleEvents = state.pollEvents.filter((ev) => state.pollInspectorAdminView || !ev.adminOnly);
  const html2 = /* @__PURE__ */ jsxDEV("div", { class: "p-4 space-y-3 max-h-[88dvh] flex flex-col", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between border-b border-border pb-2.5 shrink-0", children: [
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-forest", children: "Unified Event Poll" }),
        /* @__PURE__ */ jsxDEV("h3", { class: "font-serif font-bold text-lg text-ink", children: [
          "Event Stream (",
          visibleEvents.length,
          ")"
        ] })
      ] }),
      /* @__PURE__ */ jsxDEV("button", { onclick: "closeTopModal()", class: "tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center", children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-x text-base" }) })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-xl p-3 space-y-2 shrink-0", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between gap-2 flex-wrap", children: [
        /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-bold uppercase text-muted", children: "Composite Poll Cursor" }),
        /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold px-2 py-0.5 rounded bg-card border border-ink text-ink", children: [
          "(ts: ",
          state.pollCursor.ts,
          ", id: ",
          state.pollCursor.id,
          ")"
        ] })
      ] }),
      /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between text-[11px] font-mono text-muted", children: /* @__PURE__ */ jsxDEV("span", { children: [
        "Retention cutoff: ",
        /* @__PURE__ */ jsxDEV("strong", { class: "text-ink", children: state.retentionCutoffTs })
      ] }) })
    ] }),
    state.resyncRequired && /* @__PURE__ */ jsxDEV("div", { class: "caution-stripe-red border-2 border-ink rounded-xl p-3 space-y-2 shrink-0", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-vermilion flex items-center gap-1", children: [
        /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-warning-octagon" }),
        " resync_required: true"
      ] }),
      /* @__PURE__ */ jsxDEV("p", { class: "text-xs text-ink leading-snug", children: [
        "Cursor ",
        /* @__PURE__ */ jsxDEV("span", { class: "font-mono font-bold", children: [
          "(",
          state.pollCursor.ts,
          ", #",
          state.pollCursor.id,
          ")"
        ] }),
        " predates retention cutoff (",
        /* @__PURE__ */ jsxDEV("span", { class: "font-mono", children: state.retentionCutoffTs }),
        "). Full state reload required."
      ] }),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          onclick: "resyncFromServer()",
          class: "hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5",
          children: [
            /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-arrows-clockwise" }),
            /* @__PURE__ */ jsxDEV("span", { children: "Resync from Server" })
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "grid grid-cols-2 gap-1.5 shrink-0", children: [
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          type: "button",
          onclick: "togglePollInspectorScope(true)",
          class: `tap-44 rounded-xl font-mono text-xs font-bold border transition ${state.pollInspectorAdminView ? "bg-ink text-paper border-ink" : "bg-recessed text-muted border-border"}`,
          children: "Admin View (All Events)"
        }
      ),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          type: "button",
          onclick: "togglePollInspectorScope(false)",
          class: `tap-44 rounded-xl font-mono text-xs font-bold border transition ${!state.pollInspectorAdminView ? "bg-ink text-paper border-ink" : "bg-recessed text-muted border-border"}`,
          children: "Agent View (Filtered)"
        }
      )
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "flex-1 overflow-y-auto space-y-2 pr-1", children: visibleEvents.map((ev) => {
      const proj = ev.project_id ? state.projects.find((p) => p.id === ev.project_id) : null;
      return /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-xl p-3 space-y-1", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between gap-2 flex-wrap", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 flex-wrap", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold text-ink bg-card px-2 py-0.5 rounded border border-border", children: escapeHtml(ev.type) }),
            ev.adminOnly && /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[10px] font-bold bg-amber-200 text-amber-950 border border-amber-700 px-1.5 py-0.5 rounded", children: "Admin only" }),
            proj && /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[10px] bg-card text-muted border border-border px-1.5 py-0.5 rounded", children: escapeHtml(proj.title) })
          ] }),
          /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] text-muted", children: formatRelEpoch(ev.ts) })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "font-sans text-xs text-ink/90 font-medium", children: escapeHtml(ev.summary) }),
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between text-[10px] font-mono text-muted pt-1 border-t border-border/50", children: [
          /* @__PURE__ */ jsxDEV("span", { children: [
            "actor: ",
            /* @__PURE__ */ jsxDEV("strong", { class: "text-ink", children: escapeHtml(ev.actor || "system") })
          ] }),
          /* @__PURE__ */ jsxDEV("span", { children: [
            "id: #",
            ev.id,
            " \xB7 ts: ",
            ev.ts
          ] })
        ] })
      ] });
    }) })
  ] });
  showCustomModal(String(html2));
}
function openAdminModal() {
  const wsAgents = state.agents.filter((a) => a.transport === "ws").length;
  const html2 = /* @__PURE__ */ jsxDEV("div", { class: "p-4 space-y-4", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between border-b border-border pb-2.5", children: [
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-muted", children: "Operator Console" }),
        /* @__PURE__ */ jsxDEV("h3", { class: "font-serif font-bold text-lg text-ink", children: [
          "Signed in as @",
          escapeHtml(state.adminUser)
        ] })
      ] }),
      /* @__PURE__ */ jsxDEV("button", { onclick: "closeTopModal()", class: "tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center", children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-x text-base" }) })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-xl p-3.5 space-y-2.5", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between text-xs font-mono", children: [
        /* @__PURE__ */ jsxDEV("span", { class: "text-muted", children: [
          "Bus Status: ",
          /* @__PURE__ */ jsxDEV("strong", { class: "text-forest", children: "Live" })
        ] }),
        /* @__PURE__ */ jsxDEV("span", { class: "text-muted", children: [
          "Live Sockets: ",
          /* @__PURE__ */ jsxDEV("strong", { class: "text-ink", children: [
            wsAgents,
            " of ",
            state.agents.length
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxDEV("div", { class: "flex gap-2", children: [
        /* @__PURE__ */ jsxDEV(
          "button",
          {
            onclick: "manualRefresh()",
            class: "hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5",
            children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-arrows-clockwise" }),
              /* @__PURE__ */ jsxDEV("span", { children: "Refresh Now" })
            ]
          }
        ),
        /* @__PURE__ */ jsxDEV(
          "button",
          {
            onclick: "openUnifiedPollSheet()",
            class: "hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5",
            children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-broadcast" }),
              /* @__PURE__ */ jsxDEV("span", { children: [
                "Event Log (",
                state.pollEvents.length,
                ")"
              ] })
            ]
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxDEV("form", { onsubmit: "changeAdminPassword(event)", class: "space-y-2.5", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold text-muted", children: "Update Operator Credentials" }),
      /* @__PURE__ */ jsxDEV(
        "input",
        {
          id: "admin-new-user",
          type: "text",
          value: escapeHtml(state.adminUser),
          placeholder: "Operator username",
          class: "tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink"
        }
      ),
      /* @__PURE__ */ jsxDEV(
        "input",
        {
          id: "admin-new-pass",
          type: "password",
          required: true,
          minlength: 1,
          placeholder: "Password",
          class: "tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink"
        }
      ),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          type: "submit",
          class: "hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-2.5 rounded-xl",
          children: "Save Credentials"
        }
      )
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "pt-2 border-t border-border flex gap-2", children: [
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          onclick: "exportBusDump()",
          class: "hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5",
          children: [
            /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-download-simple" }),
            /* @__PURE__ */ jsxDEV("span", { children: "Copy Backup" })
          ]
        }
      ),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          onclick: "doSignOut()",
          class: "hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold py-2.5 px-4 rounded-xl",
          children: "Sign Out"
        }
      )
    ] })
  ] });
  showCustomModal(String(html2));
}
async function changeAdminPassword(e) {
  e.preventDefault();
  const u = document.getElementById("admin-new-user")?.value.trim();
  const p = document.getElementById("admin-new-pass")?.value;
  if (!u || !p) return;
  busAuth.set(btoa(u + ":" + p));
  state.adminUser = u;
  closeTopModal();
  try {
    await loadAll();
    showToast("Credentials updated", `Signed in as @${state.adminUser}`, "green");
  } catch (_err) {
    showToast("Invalid credentials", "Check username/password", "red");
  }
}
function exportBusDump() {
  const dump = JSON.stringify({ messages: state.messages, projects: state.projects, tasks: state.tasks }, null, 2);
  copyTokenText(dump);
  showToast("Backup copied to clipboard", `${state.messages.length} messages & ${state.tasks.length} tasks`, "green");
}
var win = window;
win.showCustomModal = showCustomModal;
win.openModal = openModal;
win.closeTopModal = closeTopModal;
win.togglePollInspectorScope = togglePollInspectorScope;
win.openUnifiedPollSheet = openUnifiedPollSheet;
win.openAdminModal = openAdminModal;
win.changeAdminPassword = changeAdminPassword;
win.exportBusDump = exportBusDump;
win.manualRefresh = manualRefresh;
win.doSignOut = doSignOut;

// src-frontend/js/components/drawer-sections.tsx
function DrawerNotesSection({ task, draft }) {
  return /* @__PURE__ */ jsxDEV("section", { class: "hw-card rounded-2xl p-4 space-y-3 bg-card", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-forest", children: "Document Notes" }),
        /* @__PURE__ */ jsxDEV("h3", { class: "font-serif font-bold text-lg text-ink", children: "Specification & Working Notes" })
      ] }),
      task.notes && /* @__PURE__ */ jsxDEV(
        "button",
        {
          onclick: `clearTaskNotes(${task.id})`,
          class: "tap-44 px-2.5 font-mono text-xs text-muted hover:text-vermilion underline",
          children: "Clear notes"
        }
      )
    ] }),
    /* @__PURE__ */ jsxDEV("p", { class: "text-xs text-muted leading-relaxed", children: [
      "Shared working document for you and ",
      task.assignee ? "@" + task.assignee : "the assigned agent",
      ". Separate from the discussion thread below."
    ] }),
    /* @__PURE__ */ jsxDEV(
      "textarea",
      {
        id: "task-notes-editor",
        rows: 8,
        oninput: `updateTaskDraftField(${task.id}, 'notes', this.value)`,
        onfocus: "keepFieldAboveKeyboard(this)",
        placeholder: "Write specifications, checklists, runbooks, or findings...",
        class: "w-full hw-inset rounded-xl p-3 font-mono text-sm text-ink leading-relaxed focus:outline-none",
        children: draft.notes
      }
    ),
    /* @__PURE__ */ jsxDEV(
      "button",
      {
        onclick: `commitTaskDraftIfNeeded(${task.id}, false)`,
        class: "hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5",
        children: [
          /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-floppy-disk text-base" }),
          /* @__PURE__ */ jsxDEV("span", { children: "Save Title, Summary & Notes" })
        ]
      }
    )
  ] });
}
function DrawerChecklistSection({ task }) {
  const completedCount = (task.todos || []).filter((td) => td.done === 1).length;
  const totalCount = (task.todos || []).length;
  return /* @__PURE__ */ jsxDEV("section", { class: "hw-card rounded-2xl p-4 space-y-3 bg-card", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsxDEV("span", { class: "font-serif font-bold text-lg text-ink", children: "Checklist" }),
      /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold bg-recessed px-2.5 py-1 rounded-lg border border-border text-ink", children: [
        completedCount,
        " of ",
        totalCount,
        " complete"
      ] })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "space-y-2", children: totalCount === 0 ? /* @__PURE__ */ jsxDEV("div", { class: "text-sm text-muted py-2", children: "No checklist steps added yet." }) : task.todos.map((td) => /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between gap-2 p-2 rounded-xl bg-recessed border border-border", children: [
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          onclick: `toggleTodoItem(${task.id}, ${td.id})`,
          class: "tap-44 flex items-center gap-3 text-left flex-1 min-w-0 py-1 px-1",
          children: [
            /* @__PURE__ */ jsxDEV(
              "span",
              {
                class: `w-6 h-6 rounded-lg border-1.5 border-ink flex items-center justify-center shrink-0 ${td.done ? "bg-forest text-white" : "bg-card"}`,
                children: td.done ? /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-check text-sm" }) : null
              }
            ),
            /* @__PURE__ */ jsxDEV("span", { class: `text-sm font-medium ${td.done ? "line-through text-muted" : "text-ink"} break-words`, children: td.text })
          ]
        }
      ),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          onclick: `deleteTodoItem(${task.id}, ${td.id})`,
          class: "tap-44 w-11 rounded-xl text-muted hover:text-vermilion flex items-center justify-center shrink-0",
          title: "Delete checklist item",
          children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-trash text-base" })
        }
      )
    ] }, td.id)) }),
    /* @__PURE__ */ jsxDEV("form", { onsubmit: `addTodoItem(event, ${task.id})`, class: "flex gap-2 pt-1", children: [
      /* @__PURE__ */ jsxDEV(
        "input",
        {
          id: "new-todo-input",
          type: "text",
          onfocus: "keepFieldAboveKeyboard(this)",
          placeholder: "Add a checklist step...",
          class: "tap-44 flex-1 hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none"
        }
      ),
      /* @__PURE__ */ jsxDEV("button", { type: "submit", class: "hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-4 rounded-xl", children: "Add" })
    ] })
  ] });
}
function DrawerCommentsSection({
  task,
  draft,
  userComments
}) {
  return /* @__PURE__ */ jsxDEV("section", { class: "hw-card rounded-2xl p-4 space-y-3.5 bg-card", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-forest", children: "Discussion" }),
        /* @__PURE__ */ jsxDEV("h3", { class: "font-serif font-bold text-lg text-ink", children: [
          "Comments (",
          userComments.length,
          ")"
        ] })
      ] }),
      /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] text-muted", children: "Permanent audit history" })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "space-y-2.5", children: userComments.length === 0 ? /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-xl p-4 text-center text-sm text-muted", children: "No comments yet. Leave guidance for your agents below." }) : userComments.map((c) => {
      const displayAuthor = c.author === "admin" ? "luki" : c.author;
      const st = getAgentStyle(displayAuthor);
      return /* @__PURE__ */ jsxDEV("div", { class: "p-3 rounded-xl bg-recessed border border-border space-y-1.5", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between", children: [
          /* @__PURE__ */ jsxDEV("span", { class: `font-mono text-xs font-bold ${st.bg} ${st.text} border ${st.border} px-2 py-0.5 rounded-md`, children: [
            "@",
            displayAuthor
          ] }),
          /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs text-muted", children: formatRelEpoch(c.ts) })
        ] }),
        /* @__PURE__ */ jsxDEV("p", { class: "text-sm text-ink leading-relaxed whitespace-pre-wrap", children: c.body })
      ] }, c.id);
    }) }),
    /* @__PURE__ */ jsxDEV("form", { onsubmit: `postTaskComment(event, ${task.id})`, class: "space-y-2.5 pt-2 border-t border-border", children: [
      /* @__PURE__ */ jsxDEV(
        "textarea",
        {
          id: "new-comment-body",
          rows: 2,
          oninput: `updateTaskDraftField(${task.id}, 'commentDraft', this.value)`,
          onfocus: "keepFieldAboveKeyboard(this)",
          placeholder: "Write a comment as @luki...",
          class: "w-full hw-inset rounded-xl p-3 text-ink focus:outline-none",
          children: draft.commentDraft || ""
        }
      ),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          type: "submit",
          class: "hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5",
          children: [
            /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-paper-plane-right text-base" }),
            /* @__PURE__ */ jsxDEV("span", { children: "Post Comment" })
          ]
        }
      )
    ] })
  ] });
}
function DrawerTimelineSection({ systemLogs }) {
  return /* @__PURE__ */ jsxDEV("section", { class: "hw-inset rounded-2xl p-3.5 space-y-2", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5", children: [
      /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-clock-counter-clockwise" }),
      " Activity History"
    ] }),
    systemLogs.length === 0 ? /* @__PURE__ */ jsxDEV("div", { class: "text-xs text-muted", children: "No status transitions recorded yet." }) : systemLogs.map((s) => /* @__PURE__ */ jsxDEV("div", { class: "text-xs text-muted flex items-center justify-between gap-2 py-1 border-b border-border/60 last:border-none", children: [
      /* @__PURE__ */ jsxDEV("span", { children: [
        "\u2022 ",
        s.body
      ] }),
      /* @__PURE__ */ jsxDEV("span", { class: "font-mono shrink-0", children: formatRelEpoch(s.ts) })
    ] }, s.id))
  ] });
}

// src-frontend/js/components/drawer.tsx
async function openTaskDrawer(taskId) {
  state.openTaskId = taskId;
  const task = state.tasks.find((t) => t.id === taskId);
  if (task) getTaskDraft(task);
  const drawer = document.getElementById("task-drawer");
  if (drawer) {
    drawer.classList.remove("hidden");
    drawer.classList.add("flex");
  }
  renderTaskDrawer(false);
  try {
    await loadTaskDetail(taskId);
    if (state.openTaskId === taskId) renderTaskDrawer(true);
  } catch (_e) {
  }
}
function closeTaskDrawer() {
  if (state.openTaskId) {
    void commitTaskDraftIfNeeded(state.openTaskId, true);
  }
  state.openTaskId = null;
  const drawer = document.getElementById("task-drawer");
  if (drawer) {
    drawer.classList.add("hidden");
    drawer.classList.remove("flex");
  }
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function updateTaskDraftField(taskId, field, value) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const draft = getTaskDraft(task);
  const draftRecord = draft;
  draftRecord[field] = value;
  if (field === "title" || field === "description" || field === "notes") {
    draft.dirty = true;
    const badge = document.getElementById("drawer-draft-status");
    if (badge) {
      badge.textContent = "Unsaved edits (auto-saved on close)";
      badge.className = "font-mono text-[11px] text-amber-300";
    }
  }
}
async function commitTaskDraftIfNeeded(taskId, silent = false) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const draft = state.taskDrafts[taskId];
  if (!draft || !draft.dirty) return;
  const trimmedTitle = draft.title.trim();
  const payload = {};
  if (trimmedTitle) payload.title = trimmedTitle;
  payload.description = draft.description.trim() || "";
  payload.notes = draft.notes.trim() ? draft.notes : "";
  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}`, payload);
  } catch (err) {
    showToast("Save failed", err instanceof Error ? err.message : String(err), "red");
    return;
  }
  if (trimmedTitle) task.title = trimmedTitle;
  task.description = payload.description;
  task.notes = payload.notes;
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  draft.dirty = false;
  if (!silent) {
    showToast("Saved changes to task", task.title, "green");
    renderTaskDrawer(true);
    if (window.renderMainViewport) window.renderMainViewport(true);
  }
}
function renderTaskDrawer(preserveScroll = true) {
  const task = state.tasks.find((t) => t.id === state.openTaskId);
  if (!task) return closeTaskDrawer();
  const draft = getTaskDraft(task);
  const proj = state.projects.find((p) => p.id === task.project_id);
  const stale = isTaskStale(task);
  const overdue = isTaskOverdue(task);
  const userComments = (task.comments || []).filter((c) => c.author !== "system");
  const systemLogs = (task.comments || []).filter((c) => c.author === "system");
  const inner = document.getElementById("task-drawer-inner");
  const scroller = document.getElementById("task-drawer-scroller");
  const prevScroll = preserveScroll && scroller ? scroller.scrollTop : 0;
  if (!inner) return;
  const html2 = /* @__PURE__ */ jsxDEV("div", { children: [
    /* @__PURE__ */ jsxDEV("div", { class: "bg-charcoal text-paper px-3.5 py-2.5 border-b-2 border-ink flex items-center justify-between gap-2 shrink-0", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "min-w-0", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold bg-paper text-ink px-2 py-0.5 rounded", children: [
            "Task #",
            task.id
          ] }),
          /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs text-stone-300 truncate", children: proj ? proj.title : "" })
        ] }),
        /* @__PURE__ */ jsxDEV(
          "div",
          {
            id: "drawer-draft-status",
            class: `font-mono text-[11px] ${draft.dirty ? "text-amber-300" : "text-stone-400"} mt-0.5`,
            children: draft.dirty ? "Unsaved edits in draft" : `Updated ${formatRelEpoch(task.updated_at)}`
          }
        )
      ] }),
      /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 shrink-0", children: [
        task.status !== "done" && /* @__PURE__ */ jsxDEV(
          "button",
          {
            onclick: `quickCompleteTask(${task.id}, event); renderTaskDrawer(true);`,
            class: "tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center gap-1",
            children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-check" }),
              /* @__PURE__ */ jsxDEV("span", { children: "Mark done" })
            ]
          }
        ),
        /* @__PURE__ */ jsxDEV(
          "button",
          {
            onclick: `confirmDeleteTask(${task.id})`,
            class: "tap-44 w-11 rounded-xl bg-black/40 text-stone-300 hover:bg-vermilion hover:text-white border border-white/15 flex items-center justify-center",
            title: "Delete task",
            children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-trash text-base" })
          }
        ),
        /* @__PURE__ */ jsxDEV(
          "button",
          {
            onclick: "closeTaskDrawer()",
            class: "tap-44 px-3.5 rounded-xl bg-paper text-ink font-mono text-xs font-bold flex items-center gap-1",
            children: [
              /* @__PURE__ */ jsxDEV("span", { children: "Close" }),
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-x text-sm" })
            ]
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { id: "task-drawer-scroller", class: "flex-1 overflow-y-auto p-4 space-y-5", children: [
      task.status === "blocked" && /* @__PURE__ */ jsxDEV("div", { class: "caution-stripe-red border-2 border-ink rounded-2xl p-3.5 flex items-center justify-between gap-2", children: [
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-vermilion", children: [
            "Blocked \u2022 ",
            formatBlockedReason(task.blocked_kind)
          ] }),
          /* @__PURE__ */ jsxDEV("div", { class: "text-xs text-ink mt-0.5", children: [
            "Blocked ",
            formatRelEpoch(task.status_changed_at)
          ] })
        ] }),
        /* @__PURE__ */ jsxDEV(
          "button",
          {
            onclick: `openBlockedKindPicker(${task.id})`,
            class: "hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl shrink-0",
            children: "Change reason"
          }
        )
      ] }),
      stale && /* @__PURE__ */ jsxDEV("div", { class: "caution-stripe-amber border-2 border-ink rounded-2xl p-3.5 flex items-center justify-between gap-2", children: [
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-amber-950", children: "Stale \u2014 Quiet for over 24 hours" }),
          /* @__PURE__ */ jsxDEV("div", { class: "text-xs text-ink mt-0.5", children: [
            "Last activity ",
            formatRelEpoch(task.last_activity_at),
            "."
          ] })
        ] }),
        /* @__PURE__ */ jsxDEV(
          "button",
          {
            onclick: `touchTaskActivity(${task.id})`,
            class: "hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-3 rounded-xl shrink-0",
            children: "Nudge / Touch"
          }
        )
      ] }),
      /* @__PURE__ */ jsxDEV("section", { class: "hw-card rounded-2xl p-4 space-y-3 bg-card", children: [
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-xs font-bold uppercase text-muted mb-1", children: "Task Title" }),
          /* @__PURE__ */ jsxDEV(
            "input",
            {
              id: "edit-task-title",
              type: "text",
              value: draft.title,
              oninput: `updateTaskDraftField(${task.id}, 'title', this.value)`,
              onfocus: "keepFieldAboveKeyboard(this)",
              class: "tap-44 w-full hw-inset rounded-xl px-3 py-2 font-serif font-bold text-ink focus:outline-none"
            }
          )
        ] }),
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-xs font-bold uppercase text-muted mb-1", children: "Short Summary" }),
          /* @__PURE__ */ jsxDEV(
            "textarea",
            {
              id: "edit-task-desc",
              rows: 2,
              placeholder: "Brief one-line context shown on board cards...",
              oninput: `updateTaskDraftField(${task.id}, 'description', this.value)`,
              onfocus: "keepFieldAboveKeyboard(this)",
              class: "w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none",
              children: draft.description
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxDEV("section", { class: "hw-card rounded-2xl p-4 space-y-3.5 bg-card", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase tracking-wider text-muted", children: "Properties" }),
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-xs text-muted mb-1.5", children: "Status" }),
          /* @__PURE__ */ jsxDEV("div", { class: "grid grid-cols-4 gap-1.5", children: [
            { id: "todo", label: "To Do" },
            { id: "doing", label: "Doing" },
            { id: "blocked", label: "Blocked" },
            { id: "done", label: "Done" }
          ].map((st) => {
            const isCurrent = task.status === st.id;
            const activeStyle = st.id === "blocked" ? "bg-vermilion text-white border-ink shadow-[0_2px_0_#161615] cursor-default" : "bg-ink text-paper border-ink shadow-[0_2px_0_#161615] cursor-default";
            return /* @__PURE__ */ jsxDEV(
              "button",
              {
                onclick: `requestTaskStatusChange(${task.id}, '${st.id}')`,
                class: `tap-44 rounded-xl font-mono text-xs font-bold border-1.5 transition ${isCurrent ? activeStyle : "bg-recessed text-ink border-border"}`,
                children: st.label
              }
            );
          }) })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "grid grid-cols-2 gap-2.5", children: [
          /* @__PURE__ */ jsxDEV("div", { children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-xs text-muted mb-1", children: "Assignee" }),
            /* @__PURE__ */ jsxDEV(
              "select",
              {
                onchange: `manualAssignTask(${task.id}, this.value)`,
                class: "tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans font-bold text-ink",
                children: [
                  /* @__PURE__ */ jsxDEV("option", { value: "", selected: !task.assignee, children: "Unassigned" }),
                  state.agents.map((a) => /* @__PURE__ */ jsxDEV("option", { value: a.agent, selected: task.assignee === a.agent, children: [
                    "@",
                    a.agent
                  ] }))
                ]
              }
            )
          ] }),
          /* @__PURE__ */ jsxDEV("div", { children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-xs text-muted mb-1", children: "Priority" }),
            /* @__PURE__ */ jsxDEV(
              "select",
              {
                onchange: `updateTaskPriority(${task.id}, this.value)`,
                class: "tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans font-bold text-ink",
                children: [
                  /* @__PURE__ */ jsxDEV("option", { value: "low", selected: task.priority === "low", children: "Low" }),
                  /* @__PURE__ */ jsxDEV("option", { value: "normal", selected: task.priority === "normal", children: "Normal" }),
                  /* @__PURE__ */ jsxDEV("option", { value: "urgent", selected: task.priority === "urgent", children: "Urgent" })
                ]
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between mb-1.5", children: [
            /* @__PURE__ */ jsxDEV("label", { class: "font-mono text-xs text-muted", children: [
              "Due Date ",
              overdue ? /* @__PURE__ */ jsxDEV("strong", { class: "text-vermilion", children: "(Overdue)" }) : ""
            ] }),
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold text-ink", children: task.due_at ? `Due ${formatRelEpoch(task.due_at)}` : "No due date" })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { class: "grid grid-cols-4 gap-1.5", children: [
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onclick: `setTaskDueOffset(${task.id}, -7200)`,
                class: "tap-44 px-2 rounded-xl bg-rose-100 text-rose-900 border border-rose-400 font-mono text-xs font-bold",
                children: "2h ago"
              }
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onclick: `setTaskDueOffset(${task.id}, 14400)`,
                class: "tap-44 px-2 rounded-xl bg-recessed text-ink border border-border font-mono text-xs font-bold",
                children: "In 4h"
              }
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onclick: `setTaskDueOffset(${task.id}, 86400)`,
                class: "tap-44 px-2 rounded-xl bg-recessed text-ink border border-border font-mono text-xs font-bold",
                children: "Tomorrow"
              }
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onclick: `setTaskDueOffset(${task.id}, null)`,
                class: "tap-44 px-2 rounded-xl bg-recessed text-muted border border-border font-mono text-xs font-bold",
                children: "Clear"
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "pt-1 border-t border-border space-y-2", children: [
          /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-xs text-muted", children: "Labels" }),
          /* @__PURE__ */ jsxDEV("div", { class: "flex flex-wrap gap-1.5", children: [
            (task.labels || []).length === 0 && /* @__PURE__ */ jsxDEV("span", { class: "text-sm text-muted", children: "No labels yet" }),
            (task.labels || []).map((lbl) => /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs bg-recessed border border-ink pl-2.5 pr-1 py-1 rounded-xl font-bold flex items-center gap-1", children: [
              "#",
              escapeHtml(lbl),
              /* @__PURE__ */ jsxDEV(
                "button",
                {
                  onclick: `removeTaskLabel(${task.id}, '${escapeHtml(lbl)}')`,
                  class: "tap-44 w-9 h-9 rounded-lg text-muted hover:text-vermilion flex items-center justify-center",
                  title: "Remove label",
                  children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-x" })
                }
              )
            ] }))
          ] }),
          /* @__PURE__ */ jsxDEV("form", { onsubmit: `addTaskLabel(event, ${task.id})`, class: "flex gap-2", children: [
            /* @__PURE__ */ jsxDEV(
              "input",
              {
                id: "new-label-input",
                type: "text",
                onfocus: "keepFieldAboveKeyboard(this)",
                placeholder: "Add label (e.g. security, spec)...",
                class: "tap-44 flex-1 hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none"
              }
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                type: "submit",
                class: "hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold px-4 rounded-xl",
                children: "Add"
              }
            )
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxDEV(DrawerNotesSection, { task, draft }),
      /* @__PURE__ */ jsxDEV(DrawerChecklistSection, { task }),
      /* @__PURE__ */ jsxDEV(DrawerCommentsSection, { task, draft, userComments }),
      /* @__PURE__ */ jsxDEV(DrawerTimelineSection, { systemLogs })
    ] })
  ] });
  inner.innerHTML = String(html2);
  if (preserveScroll) {
    const nextScroller = document.getElementById("task-drawer-scroller");
    if (nextScroller) nextScroller.scrollTop = prevScroll;
  }
}
var win2 = window;
win2.openTaskDrawer = openTaskDrawer;
win2.closeTaskDrawer = closeTaskDrawer;
win2.updateTaskDraftField = updateTaskDraftField;
win2.commitTaskDraftIfNeeded = commitTaskDraftIfNeeded;
win2.renderTaskDrawer = renderTaskDrawer;
win2.keepFieldAboveKeyboard = keepFieldAboveKeyboard;

// src-frontend/js/views/kanban-card.tsx
function PriorityPill({ priority }) {
  if (priority === "urgent") {
    return /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold", children: "Urgent" });
  }
  if (priority === "low") {
    return /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-stone-200 text-stone-700 border border-stone-400 px-2 py-0.5 rounded-md font-semibold", children: "Low" });
  }
  return /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-paper text-ink border border-ink/40 px-2 py-0.5 rounded-md font-semibold", children: "Normal" });
}
function TaskCard({ task }) {
  const stale = isTaskStale(task);
  const overdue = isTaskOverdue(task);
  const todosDone = (task.todos || []).filter((td) => td.done === 1).length;
  const todosTotal = (task.todos || []).length;
  const commentCount = getUserCommentCount(task);
  const agStyle = task.assignee ? getAgentStyle(task.assignee) : null;
  const isSwiped = state.swipedTaskId === task.id;
  return /* @__PURE__ */ jsxDEV("div", { class: "swipe-shell select-none", id: `task-swipe-shell-${task.id}`, children: [
    /* @__PURE__ */ jsxDEV(
      "div",
      {
        id: `task-swipe-bg-${task.id}`,
        class: "swipe-bg bg-forest text-white px-4 flex items-center justify-between rounded-2xl transition-colors duration-150",
        children: [
          /* @__PURE__ */ jsxDEV("div", { id: `task-swipe-left-hint-${task.id}`, class: "flex items-center gap-2 font-mono text-xs font-bold", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "w-9 h-9 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center", children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-lightning text-base" }) }),
            /* @__PURE__ */ jsxDEV("span", { children: "Quick Actions" })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { id: `task-swipe-right-hint-${task.id}`, class: "flex items-center gap-2 font-mono text-xs font-bold", children: [
            /* @__PURE__ */ jsxDEV("span", { children: "Quick Actions" }),
            /* @__PURE__ */ jsxDEV("span", { class: "w-9 h-9 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center", children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-lightning text-base" }) })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ jsxDEV(
      "div",
      {
        id: `task-swipe-fg-${task.id}`,
        class: "swipe-fg hw-card rounded-2xl overflow-hidden bg-card relative",
        draggable: true,
        ondragstart: `handleKanbanDragStart(event, ${task.id})`,
        onpointerdown: `handleTaskPointerDown(event, ${task.id})`,
        children: [
          task.status === "blocked" ? /* @__PURE__ */ jsxDEV("div", { class: "caution-stripe-red px-3 py-1.5 border-b border-ink flex items-center justify-between", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-bold text-vermilion flex items-center gap-1", children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-hand-palm" }),
              " ",
              formatBlockedReason(task.blocked_kind)
            ] }),
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-semibold text-ink", children: formatRelEpoch(task.status_changed_at) })
          ] }) : stale ? /* @__PURE__ */ jsxDEV("div", { class: "caution-stripe-amber px-3 py-1.5 border-b border-ink flex items-center justify-between", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-bold text-amber-950 flex items-center gap-1", children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-hourglass-high" }),
              " Stale (Quiet >24h)"
            ] }),
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-bold text-amber-950", children: formatRelEpoch(task.last_activity_at) })
          ] }) : null,
          isSwiped && /* @__PURE__ */ jsxDEV("div", { class: "bg-charcoal text-paper px-3 py-2 border-b border-ink flex items-center justify-between gap-2", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold text-amber-300", children: "Quick Actions" }),
            /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5", children: [
              task.status !== "done" && /* @__PURE__ */ jsxDEV("button", { onclick: `quickCompleteTask(${task.id}, event)`, class: "tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center gap-1", children: [
                /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-check-circle" }),
                " Mark done"
              ] }),
              /* @__PURE__ */ jsxDEV("button", { onclick: `quickCycleAssignee(${task.id}, event)`, class: "tap-44 px-3 rounded-xl bg-paper text-ink font-mono text-xs font-bold flex items-center gap-1", children: [
                /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-user-switch" }),
                " ",
                task.assignee ? "Reassign" : "Claim (nyx)"
              ] }),
              /* @__PURE__ */ jsxDEV("button", { onclick: "clearTaskSwipe(event)", class: "tap-44 w-11 rounded-xl bg-black/40 text-paper flex items-center justify-center", children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-x" }) })
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { class: "p-3.5 space-y-2.5", children: [
            /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between gap-2 flex-wrap", children: [
              /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 flex-wrap", children: [
                /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold text-muted", children: [
                  "#",
                  task.id
                ] }),
                /* @__PURE__ */ jsxDEV(PriorityPill, { priority: task.priority }),
                overdue ? /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold flex items-center gap-1", children: [
                  /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-alarm" }),
                  " Overdue (",
                  formatRelEpoch(task.due_at),
                  ")"
                ] }) : task.due_at ? /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-recessed text-ink border border-border px-2 py-0.5 rounded font-medium", children: [
                  "Due ",
                  formatRelEpoch(task.due_at)
                ] }) : null
              ] }),
              /* @__PURE__ */ jsxDEV("div", { children: task.assignee && agStyle ? /* @__PURE__ */ jsxDEV("span", { class: `font-mono text-xs ${agStyle.bg} ${agStyle.text} border ${agStyle.border} px-2.5 py-0.5 rounded-lg font-bold inline-flex items-center gap-1`, children: [
                /* @__PURE__ */ jsxDEV("span", { class: `w-1.5 h-1.5 rounded-full ${agStyle.dot}` }),
                "@",
                task.assignee,
                Boolean(task.admin_assigned) && /* @__PURE__ */ jsxDEV("i", { class: "ph-fill ph-lock-key text-[11px]", title: "Assigned by you" })
              ] }) : /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs text-muted bg-recessed px-2 py-0.5 rounded-lg border border-border", children: "Unassigned" }) })
            ] }),
            /* @__PURE__ */ jsxDEV("div", { onclick: `openTaskDrawerIfNotSwiped(event, ${task.id})`, class: "cursor-pointer group", children: [
              /* @__PURE__ */ jsxDEV("h3", { class: "font-serif text-base font-bold text-ink group-hover:text-forest leading-snug", children: task.title }),
              task.description ? /* @__PURE__ */ jsxDEV("p", { class: "text-sm text-muted mt-1 line-clamp-2 leading-relaxed", children: task.description }) : null
            ] }),
            (task.labels || []).length > 0 && /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 flex-wrap", children: task.labels.map((lbl) => /* @__PURE__ */ jsxDEV(
              "button",
              {
                onclick: `setKanbanFilter('label', '${escapeHtml(lbl)}')`,
                class: "tap-44 px-2.5 rounded-lg font-mono text-xs bg-recessed hover:bg-ink hover:text-paper text-ink border border-border font-semibold transition flex items-center",
                children: [
                  "#",
                  lbl
                ]
              },
              lbl
            )) }),
            /* @__PURE__ */ jsxDEV("div", { class: "pt-2 border-t border-border flex items-center justify-between gap-2", children: [
              /* @__PURE__ */ jsxDEV("button", { onclick: `openTaskDrawerIfNotSwiped(event, ${task.id})`, class: "tap-44 px-1 flex items-center gap-3 font-mono text-xs text-muted text-left", children: [
                /* @__PURE__ */ jsxDEV("span", { class: `flex items-center gap-1 ${todosTotal > 0 && todosDone === todosTotal ? "text-forest font-bold" : ""}`, children: [
                  /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-check-square-offset text-sm" }),
                  todosDone,
                  "/",
                  todosTotal
                ] }),
                /* @__PURE__ */ jsxDEV("span", { class: `flex items-center gap-1 ${task.notes ? "text-ink font-semibold" : ""}`, children: [
                  /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-file-text text-sm" }),
                  task.notes ? "Doc" : "\u2014"
                ] }),
                /* @__PURE__ */ jsxDEV("span", { class: `flex items-center gap-1 ${commentCount > 0 ? "text-ink font-semibold" : ""}`, children: [
                  /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-chats-circle text-sm" }),
                  commentCount
                ] })
              ] }),
              /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5", children: [
                task.status !== "done" ? /* @__PURE__ */ jsxDEV(
                  "button",
                  {
                    onclick: `quickCompleteTask(${task.id}, event)`,
                    class: "hw-btn tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center gap-1",
                    title: "Mark task done",
                    children: [
                      /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-check" }),
                      /* @__PURE__ */ jsxDEV("span", { children: "Mark done" })
                    ]
                  }
                ) : /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold text-forest px-2 py-1 flex items-center gap-1", children: [
                  /* @__PURE__ */ jsxDEV("i", { class: "ph-fill ph-check-circle" }),
                  " Completed"
                ] }),
                /* @__PURE__ */ jsxDEV(
                  "button",
                  {
                    onclick: `openTaskDrawerIfNotSwiped(event, ${task.id})`,
                    class: "hw-btn tap-44 px-3 rounded-xl bg-recessed text-ink font-mono text-xs font-bold flex items-center",
                    children: "Open"
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ jsxDEV("div", { class: "grid grid-cols-4 gap-1 pt-1", children: [
              { id: "todo", label: "To Do" },
              { id: "doing", label: "Doing" },
              { id: "blocked", label: "Blocked" },
              { id: "done", label: "Done" }
            ].map((st) => {
              const isCurrent = task.status === st.id;
              return /* @__PURE__ */ jsxDEV(
                "button",
                {
                  onclick: `requestTaskStatusChange(${task.id}, '${st.id}')`,
                  class: `tap-44 rounded-xl font-mono text-[11px] font-bold border transition flex items-center justify-center ${isCurrent ? st.id === "blocked" ? "bg-vermilion text-white border-ink cursor-default" : "bg-ink text-paper border-ink cursor-default" : "bg-paper text-muted border-border hover:border-ink hover:text-ink"}`,
                  "aria-current": isCurrent ? "true" : void 0,
                  children: st.label
                },
                st.id
              );
            }) })
          ] })
        ]
      }
    )
  ] });
}

// src-frontend/js/views/needs-you.tsx
function renderNeedsYouView() {
  const waitingTasks = getWaitingHumanTasks();
  const waitingIds = new Set(waitingTasks.map((t) => t.id));
  const radarTasks = state.tasks.filter((t) => {
    if (waitingIds.has(t.id)) return false;
    return isTaskStale(t) || isTaskOverdue(t);
  });
  const html2 = /* @__PURE__ */ jsxDEV("div", { class: "p-3.5 space-y-4", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "hw-card rounded-2xl p-3.5 bg-card", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "flex items-start justify-between gap-2", children: [
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-[11px] uppercase tracking-wider text-vermilion font-bold", children: "Action Required Across All Projects" }),
          /* @__PURE__ */ jsxDEV("h1", { class: "font-serif text-2xl font-bold text-ink leading-tight mt-0.5", children: [
            "Needs You (",
            waitingTasks.length,
            ")"
          ] })
        ] }),
        /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-recessed text-ink border border-border px-2.5 py-1 rounded-lg font-bold", children: "Oldest First" })
      ] }),
      /* @__PURE__ */ jsxDEV("p", { class: "text-sm text-muted mt-1.5 leading-relaxed", children: "Tasks where an agent is paused waiting on your decision or sign-off, ordered by how long they have been waiting." })
    ] }),
    waitingTasks.length === 0 ? /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-2xl p-8 text-center", children: [
      /* @__PURE__ */ jsxDEV("i", { class: "ph-duotone ph-check-circle text-4xl text-forest" }),
      /* @__PURE__ */ jsxDEV("div", { class: "font-serif text-lg font-bold mt-2", children: "Zero Human Bottlenecks" }),
      /* @__PURE__ */ jsxDEV("p", { class: "text-sm text-muted mt-1", children: "All agents are unblocked and executing autonomously." })
    ] }) : waitingTasks.map((t, idx) => {
      const proj = state.projects.find((p) => p.id === t.project_id);
      const changedAt = t.status_changed_at || t.updated_at;
      const blockedSecs = NOW_EPOCH - changedAt;
      const blockedHours = Math.max(1, Math.round(blockedSecs / 3600));
      const overdue = isTaskOverdue(t);
      const lastComment = (t.comments || []).filter((c) => c.author !== "system").slice(-1)[0];
      return /* @__PURE__ */ jsxDEV("div", { class: "hw-card rounded-2xl overflow-hidden", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "caution-stripe-red px-3.5 py-2 border-b border-ink flex items-center justify-between", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-bold bg-vermilion text-white px-2 py-0.5 rounded", children: [
              "#",
              idx + 1,
              " \u2022 Waiting ",
              blockedHours,
              "h"
            ] }),
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold text-ink", children: formatBlockedReason(t.blocked_kind) })
          ] }),
          /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-semibold text-ink/80", children: [
            "Task #",
            t.id
          ] })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "p-3.5 space-y-3", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex flex-wrap items-center gap-1.5", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs bg-recessed border border-border px-2.5 py-0.5 rounded-md font-semibold text-ink", children: proj ? proj.title : "Project #" + t.project_id }),
            /* @__PURE__ */ jsxDEV(PriorityPill, { priority: t.priority }),
            overdue && /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold", children: "Overdue" })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { onclick: `openTaskDrawer(${t.id})`, class: "cursor-pointer group", children: [
            /* @__PURE__ */ jsxDEV("h3", { class: "font-serif text-lg font-bold text-ink group-hover:text-vermilion transition leading-snug", children: t.title }),
            t.description ? /* @__PURE__ */ jsxDEV("p", { class: "text-sm text-muted mt-1 leading-relaxed", children: t.description }) : null
          ] }),
          lastComment && /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-xl p-3 text-sm", children: [
            /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between font-mono text-xs text-muted mb-1", children: [
              /* @__PURE__ */ jsxDEV("span", { children: [
                "Latest note from ",
                /* @__PURE__ */ jsxDEV("strong", { class: "text-ink", children: [
                  "@",
                  lastComment.author
                ] })
              ] }),
              /* @__PURE__ */ jsxDEV("span", { children: formatRelEpoch(lastComment.ts) })
            ] }),
            /* @__PURE__ */ jsxDEV("p", { class: "text-ink font-medium leading-snug", children: [
              '"',
              lastComment.body,
              '"'
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { class: "pt-1 flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ jsxDEV("button", { onclick: `quickUnblockAndReplyModal(${t.id})`, class: "hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5", children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-lock-key-open text-base" }),
              /* @__PURE__ */ jsxDEV("span", { children: "Unblock" })
            ] }),
            /* @__PURE__ */ jsxDEV("button", { onclick: `quickCompleteTask(${t.id}, event)`, class: "hw-btn tap-44 bg-card text-forest font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5", children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-check-circle text-base" }),
              /* @__PURE__ */ jsxDEV("span", { children: "Mark done" })
            ] }),
            /* @__PURE__ */ jsxDEV("button", { onclick: `openTaskDrawer(${t.id})`, class: "hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1", children: [
              /* @__PURE__ */ jsxDEV("span", { children: "Open" }),
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-arrow-up-right text-sm" })
            ] })
          ] })
        ] })
      ] }, t.id);
    }),
    /* @__PURE__ */ jsxDEV("div", { class: "pt-2", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between mb-2", children: /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold uppercase tracking-wider text-muted", children: [
        "Radar: Stale & Overdue (",
        radarTasks.length,
        ")"
      ] }) }),
      radarTasks.length === 0 ? /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-xl p-4 text-center text-sm text-muted", children: "No stale or overdue tasks outside your queue." }) : /* @__PURE__ */ jsxDEV("div", { class: "space-y-2.5", children: radarTasks.map((t) => {
        const stale = isTaskStale(t);
        const overdue = isTaskOverdue(t);
        const lastAct = tsToEpoch(t.last_activity_at);
        const quietHours = Math.floor((NOW_EPOCH - lastAct) / 3600);
        return /* @__PURE__ */ jsxDEV("div", { class: `hw-card rounded-xl p-3.5 border-l-4 ${overdue ? "border-l-vermilion" : "border-l-ochre"} space-y-2.5`, children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between gap-2 flex-wrap", children: [
            /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 flex-wrap", children: [
              stale && /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-bold bg-amber-200 text-amber-950 border border-amber-700 px-2 py-0.5 rounded", children: [
                "Stale \u2022 Quiet for ",
                quietHours,
                "h"
              ] }),
              overdue && /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-bold bg-rose-200 text-rose-950 border border-rose-700 px-2 py-0.5 rounded", children: [
                "Overdue \u2022 Due ",
                formatRelEpoch(t.due_at)
              ] })
            ] }),
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs text-muted", children: [
              "#",
              t.id,
              " \u2022 ",
              t.assignee ? "@" + t.assignee : "Unassigned"
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { onclick: `openTaskDrawer(${t.id})`, class: "font-serif font-bold text-base text-ink cursor-pointer hover:underline", children: t.title }),
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-2 pt-1", children: [
            /* @__PURE__ */ jsxDEV("button", { onclick: `quickCompleteTask(${t.id}, event)`, class: "hw-btn tap-44 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center gap-1.5", children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-check-circle" }),
              /* @__PURE__ */ jsxDEV("span", { children: "Mark done" })
            ] }),
            stale && /* @__PURE__ */ jsxDEV("button", { onclick: `touchTaskActivity(${t.id})`, class: "hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center gap-1.5", children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-bell-ringing" }),
              /* @__PURE__ */ jsxDEV("span", { children: "Nudge agent" })
            ] }),
            /* @__PURE__ */ jsxDEV("button", { onclick: `openTaskDrawer(${t.id})`, class: "hw-btn tap-44 ml-auto bg-recessed text-ink font-mono text-xs font-bold px-3 rounded-xl", children: "Open" })
          ] })
        ] }, t.id);
      }) })
    ] })
  ] });
  return String(html2);
}

// src-frontend/js/views/kanban.tsx
function getProjectDistinctLabels(projectId) {
  const set = /* @__PURE__ */ new Set();
  state.tasks.filter((t) => t.project_id === projectId).forEach((t) => (t.labels || []).forEach((l) => set.add(l)));
  return Array.from(set).sort();
}
function renderKanbanView() {
  const currentProj = state.projects.find((p) => p.id === state.activeProjectId) || state.projects[0];
  if (!currentProj) {
    return String(
      /* @__PURE__ */ jsxDEV("div", { class: "p-8 text-center text-muted", children: [
        /* @__PURE__ */ jsxDEV("p", { class: "font-serif text-lg font-bold", children: "No Projects Found" }),
        /* @__PURE__ */ jsxDEV("button", { onclick: "openProjectModal(null)", class: "hw-btn tap-44 mt-3 px-4 rounded-xl bg-ink text-paper font-mono text-xs font-bold", children: "Create Project" })
      ] })
    );
  }
  const projectLabels = getProjectDistinctLabels(currentProj.id);
  const kf = state.kanbanFilter;
  const allProjTasks = state.tasks.filter((t) => t.project_id === currentProj.id);
  const filteredTasks = allProjTasks.filter((t) => {
    if (kf.status && kf.status !== "ALL" && t.status !== kf.status) return false;
    if (kf.assignee && kf.assignee !== "ALL") {
      if (kf.assignee === "UNASSIGNED" && t.assignee !== null) return false;
      if (kf.assignee !== "UNASSIGNED" && t.assignee !== kf.assignee) return false;
    }
    if (kf.priority && kf.priority !== "ALL" && t.priority !== kf.priority) return false;
    if (kf.label && kf.label !== "ALL" && !(t.labels || []).includes(kf.label)) return false;
    if (kf.blocked_kind && kf.blocked_kind !== "ALL" && t.blocked_kind !== kf.blocked_kind) return false;
    if (kf.q && kf.q.trim() !== "") {
      const needle = kf.q.trim().toLowerCase().replace(/[%_]/g, "");
      const hay = `${t.title || ""} ${t.description || ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const activeFilterCount = [
    kf.status !== "ALL",
    kf.assignee !== "ALL",
    kf.priority !== "ALL",
    kf.label !== "ALL",
    kf.blocked_kind !== "ALL",
    kf.q.trim() !== ""
  ].filter(Boolean).length;
  const columns = [
    { id: "todo", title: "To Do", dot: "bg-stone-500" },
    { id: "doing", title: "In Progress", dot: "bg-ochre" },
    { id: "blocked", title: "Blocked", dot: "bg-vermilion" },
    { id: "done", title: "Done", dot: "bg-forest" }
  ];
  const html2 = /* @__PURE__ */ jsxDEV("div", { class: "p-3.5 space-y-3 flex-1 flex flex-col", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "hw-card rounded-2xl p-3 bg-card", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between gap-2", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "min-w-0 flex-1", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] uppercase tracking-wider text-muted font-bold", children: "Active Project" }),
            currentProj.archived && /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[10px] bg-stone-800 text-white px-2 py-0.5 rounded", children: "Archived" })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { class: "relative mt-1", children: [
            /* @__PURE__ */ jsxDEV("select", { onchange: "selectProject(Number(this.value))", class: "tap-44 w-full appearance-none bg-recessed border-1.5 border-ink rounded-xl px-3 py-2 pr-9 font-serif font-bold text-ink focus:outline-none", children: state.projects.map((p) => /* @__PURE__ */ jsxDEV("option", { value: p.id, selected: p.id === currentProj.id, children: [
              p.title,
              " (",
              state.tasks.filter((t) => t.project_id === p.id).length,
              ")"
            ] }, p.id)) }),
            /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-caret-up-down absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink" })
          ] })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 shrink-0 pt-5", children: [
          /* @__PURE__ */ jsxDEV("button", { onclick: `openProjectModal(${currentProj.id})`, class: "hw-btn tap-44 w-11 rounded-xl bg-paper flex items-center justify-center text-ink", title: "Project settings & access", children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-sliders-horizontal text-lg" }) }),
          /* @__PURE__ */ jsxDEV("button", { onclick: "openProjectModal(null)", class: "hw-btn tap-44 w-11 rounded-xl bg-ink text-paper flex items-center justify-center", title: "New Project", children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-folder-plus text-lg" }) })
        ] })
      ] }),
      currentProj.description ? /* @__PURE__ */ jsxDEV("p", { class: "text-sm text-muted mt-2 leading-relaxed", children: currentProj.description }) : null,
      /* @__PURE__ */ jsxDEV("div", { class: "mt-2.5 pt-2 border-t border-border flex items-center justify-between gap-2", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 flex-wrap", children: [
          /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-bold text-muted flex items-center gap-1", children: [
            /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-users-three" }),
            " Access:"
          ] }),
          (currentProj.subscribers || []).length === 0 ? /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-emerald-100 text-emerald-950 border border-emerald-700 px-2 py-0.5 rounded-md font-semibold", children: "All agents" }) : currentProj.subscribers.map((ag) => {
            const st = getAgentStyle(ag);
            return /* @__PURE__ */ jsxDEV("span", { class: `font-mono text-[11px] ${st.bg} ${st.text} border ${st.border} px-2 py-0.5 rounded-md font-bold`, children: [
              "@",
              ag
            ] }, ag);
          })
        ] }),
        /* @__PURE__ */ jsxDEV("button", { onclick: `openProjectModal(${currentProj.id})`, class: "tap-44 px-2 font-mono text-xs underline font-bold text-ink shrink-0 flex items-center", children: "Edit access" })
      ] })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "space-y-2", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "relative flex-1", children: [
          /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-base" }),
          /* @__PURE__ */ jsxDEV(
            "input",
            {
              id: "kanban-search-input",
              type: "text",
              value: kf.q,
              oninput: "updateKanbanSearch(this.value)",
              placeholder: "Search tasks...",
              class: "tap-44 w-full hw-inset rounded-xl pl-9 pr-9 py-2 font-medium text-ink placeholder:text-muted focus:outline-none focus:border-ink"
            }
          ),
          kf.q ? /* @__PURE__ */ jsxDEV("button", { onclick: "updateKanbanSearch('')", class: "tap-44 absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-ink flex items-center justify-center", children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-x-circle text-lg" }) }) : null
        ] }),
        /* @__PURE__ */ jsxDEV("button", { onclick: "toggleKanbanFilterDrawer()", class: `hw-btn tap-44 px-3 rounded-xl font-mono text-xs font-bold flex items-center gap-1.5 ${kf.showFilters || activeFilterCount > 0 ? "bg-ink text-paper" : "bg-card text-ink"}`, children: [
          /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-funnel text-base" }),
          /* @__PURE__ */ jsxDEV("span", { children: "Filter" }),
          activeFilterCount > 0 && /* @__PURE__ */ jsxDEV("span", { class: "bg-ochre text-white px-1.5 py-0.2 rounded-full text-[10px]", children: activeFilterCount })
        ] }),
        /* @__PURE__ */ jsxDEV("button", { onclick: "openCreateTaskModal()", class: "hw-btn tap-44 px-3.5 rounded-xl bg-ink text-paper font-mono text-xs font-bold flex items-center gap-1 shrink-0", children: [
          /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-plus-bold text-sm" }),
          /* @__PURE__ */ jsxDEV("span", { children: "New Task" })
        ] })
      ] }),
      kf.showFilters && /* @__PURE__ */ jsxDEV("div", { class: "hw-card rounded-2xl p-3.5 bg-card space-y-3", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between", children: [
          /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold uppercase tracking-wider text-muted", children: "Filter Board" }),
          /* @__PURE__ */ jsxDEV("button", { onclick: "resetKanbanFilters()", class: "tap-44 px-2 font-mono text-xs text-ink font-bold underline flex items-center", children: "Reset filters" })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "grid grid-cols-2 gap-2.5", children: [
          /* @__PURE__ */ jsxDEV("div", { children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-[11px] font-bold text-muted mb-1", children: "Status" }),
            /* @__PURE__ */ jsxDEV("select", { onchange: "setKanbanFilter('status', this.value)", class: "tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink", children: [
              /* @__PURE__ */ jsxDEV("option", { value: "ALL", selected: kf.status === "ALL", children: "All statuses" }),
              /* @__PURE__ */ jsxDEV("option", { value: "todo", selected: kf.status === "todo", children: "To Do" }),
              /* @__PURE__ */ jsxDEV("option", { value: "doing", selected: kf.status === "doing", children: "In Progress" }),
              /* @__PURE__ */ jsxDEV("option", { value: "blocked", selected: kf.status === "blocked", children: "Blocked" }),
              /* @__PURE__ */ jsxDEV("option", { value: "done", selected: kf.status === "done", children: "Done" })
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-[11px] font-bold text-muted mb-1", children: "Assignee" }),
            /* @__PURE__ */ jsxDEV("select", { onchange: "setKanbanFilter('assignee', this.value)", class: "tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink", children: [
              /* @__PURE__ */ jsxDEV("option", { value: "ALL", selected: kf.assignee === "ALL", children: "Anyone" }),
              /* @__PURE__ */ jsxDEV("option", { value: "UNASSIGNED", selected: kf.assignee === "UNASSIGNED", children: "Unassigned" }),
              state.agents.map((a) => /* @__PURE__ */ jsxDEV("option", { value: a.agent, selected: kf.assignee === a.agent, children: [
                "@",
                a.agent
              ] }, a.agent))
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-[11px] font-bold text-muted mb-1", children: "Priority" }),
            /* @__PURE__ */ jsxDEV("select", { onchange: "setKanbanFilter('priority', this.value)", class: "tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink", children: [
              /* @__PURE__ */ jsxDEV("option", { value: "ALL", selected: kf.priority === "ALL", children: "Any priority" }),
              /* @__PURE__ */ jsxDEV("option", { value: "urgent", selected: kf.priority === "urgent", children: "Urgent" }),
              /* @__PURE__ */ jsxDEV("option", { value: "normal", selected: kf.priority === "normal", children: "Normal" }),
              /* @__PURE__ */ jsxDEV("option", { value: "low", selected: kf.priority === "low", children: "Low" })
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-[11px] font-bold text-muted mb-1", children: "Label" }),
            /* @__PURE__ */ jsxDEV("select", { onchange: "setKanbanFilter('label', this.value)", class: "tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink", children: [
              /* @__PURE__ */ jsxDEV("option", { value: "ALL", selected: kf.label === "ALL", children: "All labels" }),
              projectLabels.map((l) => /* @__PURE__ */ jsxDEV("option", { value: l, selected: kf.label === l, children: [
                "#",
                l
              ] }, l))
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { class: "col-span-2", children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-[11px] font-bold text-muted mb-1", children: "Blocked reason" }),
            /* @__PURE__ */ jsxDEV("select", { onchange: "setKanbanFilter('blocked_kind', this.value)", class: "tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink", children: [
              /* @__PURE__ */ jsxDEV("option", { value: "ALL", selected: kf.blocked_kind === "ALL", children: "Any reason" }),
              /* @__PURE__ */ jsxDEV("option", { value: "waiting-human", selected: kf.blocked_kind === "waiting-human", children: "Waiting on me" }),
              /* @__PURE__ */ jsxDEV("option", { value: "waiting-task", selected: kf.blocked_kind === "waiting-task", children: "Waiting on another task" }),
              /* @__PURE__ */ jsxDEV("option", { value: "waiting-external", selected: kf.blocked_kind === "waiting-external", children: "Waiting on external service" })
            ] })
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between gap-1.5", children: /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5", children: columns.map((col) => {
      const colCount = filteredTasks.filter((t) => t.status === col.id).length;
      return /* @__PURE__ */ jsxDEV(
        "button",
        {
          onclick: `scrollToKanbanColumn('${col.id}')`,
          class: "tap-44 px-3 rounded-xl bg-recessed hover:bg-card border border-border font-mono text-xs font-bold text-ink flex items-center gap-1.5 shrink-0",
          children: [
            /* @__PURE__ */ jsxDEV("span", { class: `w-2 h-2 rounded-full ${col.dot}` }),
            /* @__PURE__ */ jsxDEV("span", { children: col.title }),
            /* @__PURE__ */ jsxDEV("span", { class: "text-muted", children: colCount })
          ]
        },
        col.id
      );
    }) }) }),
    /* @__PURE__ */ jsxDEV("div", { class: "text-xs text-muted flex items-center justify-between px-0.5", children: /* @__PURE__ */ jsxDEV("span", { children: [
      /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-arrows-left-right mr-1" }),
      "Scroll columns \u2022 Drag cards or swipe a card for quick actions"
    ] }) }),
    /* @__PURE__ */ jsxDEV(
      "div",
      {
        id: "kanban-board-strip",
        "data-scroll-id": "kanban-board-horiz",
        class: "flex gap-3 overflow-x-auto pb-3 pt-0.5 snap-x snap-mandatory no-scrollbar -mx-3.5 px-3.5",
        children: columns.filter((c) => kf.status === "ALL" || kf.status === c.id).map((col) => {
          const colTasks = filteredTasks.filter((t) => t.status === col.id);
          return /* @__PURE__ */ jsxDEV(
            "div",
            {
              id: `kanban-col-${col.id}`,
              "data-col-status": col.id,
              ondragover: "handleKanbanDragOver(event)",
              ondragleave: "handleKanbanDragLeave(event)",
              ondrop: `handleKanbanDrop(event, '${col.id}')`,
              class: "w-[85vw] max-w-[330px] shrink-0 snap-center hw-inset rounded-2xl p-2.5 flex flex-col gap-2.5 min-h-[420px] transition-colors",
              children: [
                /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between px-2 py-1 border-b border-border", children: [
                  /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-2", children: [
                    /* @__PURE__ */ jsxDEV("span", { class: `w-2.5 h-2.5 rounded-full ${col.dot}` }),
                    /* @__PURE__ */ jsxDEV("h2", { class: "font-serif font-bold text-base text-ink", children: col.title })
                  ] }),
                  /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold bg-card border border-border px-2 py-0.5 rounded-lg text-ink", children: colTasks.length })
                ] }),
                /* @__PURE__ */ jsxDEV("div", { class: "space-y-2.5 flex-1", children: colTasks.length === 0 ? /* @__PURE__ */ jsxDEV("div", { class: "rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted my-2", children: [
                  "Drop a card here or tap a status button to move tasks to ",
                  /* @__PURE__ */ jsxDEV("strong", { children: col.title }),
                  "."
                ] }) : colTasks.map((task) => /* @__PURE__ */ jsxDEV(TaskCard, { task }, task.id)) })
              ]
            },
            col.id
          );
        })
      }
    )
  ] });
  return String(html2);
}
function scrollToKanbanColumn(colId) {
  const col = document.getElementById(`kanban-col-${colId}`);
  if (col) {
    col.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}
var win3 = window;
win3.scrollToKanbanColumn = scrollToKanbanColumn;

// src-frontend/js/views/kanban-actions.ts
async function selectProject(projId) {
  state.activeProjectId = projId;
  state.kanbanFilter.label = "ALL";
  if (window.renderMainViewport) window.renderMainViewport(false);
  try {
    await refreshTasks();
    if (window.renderMainViewport) window.renderMainViewport(true);
  } catch (_e) {
  }
}
function updateKanbanSearch(val) {
  state.kanbanFilter.q = val;
  if (window.renderMainViewport) window.renderMainViewport(true);
  const input2 = document.getElementById("kanban-search-input");
  if (input2) {
    input2.focus();
    input2.setSelectionRange(val.length, val.length);
  }
}
function toggleKanbanFilterDrawer() {
  state.kanbanFilter.showFilters = !state.kanbanFilter.showFilters;
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function setKanbanFilter(key, val) {
  state.kanbanFilter[key] = val;
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function resetKanbanFilters() {
  state.kanbanFilter = {
    q: "",
    status: "ALL",
    assignee: "ALL",
    label: "ALL",
    blocked_kind: "ALL",
    priority: "ALL",
    showFilters: true
  };
  if (window.renderMainViewport) window.renderMainViewport(true);
}
async function requestTaskStatusChange(taskId, newStatus) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.status === newStatus) {
    return;
  }
  if (newStatus === "blocked") {
    openBlockedKindPicker(taskId);
    return;
  }
  const prevStatus = task.status;
  const prevBlockedKind = task.blocked_kind;
  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}`, { status: newStatus });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Status change failed", errorMsg, "red");
    return;
  }
  task.status = newStatus;
  task.blocked_kind = null;
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  showToast(
    `Task #${task.id} \u2192 ${STATUS_LABELS[newStatus] || newStatus}`,
    prevStatus === "blocked" ? `Cleared "${formatBlockedReason(prevBlockedKind)}"` : task.title,
    newStatus === "done" ? "green" : "ink"
  );
  if (state.openTaskId === taskId) await loadTaskDetail(taskId);
  await refreshTasks();
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function openBlockedKindPicker(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const current = task.blocked_kind || "waiting-human";
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-vermilion">Blocked Reason</div>
          <h3 class="font-serif font-bold text-lg text-ink">Why is Task #${task.id} blocked?</h3>
        </div>
        <button onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <p class="text-sm text-muted">
        Choosing <strong class="text-ink">Waiting on me</strong> places this task in your <em>Needs You</em> queue.
      </p>

      <div class="space-y-2.5">
        ${[
    {
      kind: "waiting-human",
      title: "Waiting on me",
      desc: "Paused for your decision, approval, or credentials."
    },
    {
      kind: "waiting-task",
      title: "Waiting on another task",
      desc: "Depends on another task or migration finishing first."
    },
    {
      kind: "waiting-external",
      title: "Waiting on external service",
      desc: "Blocked on an upstream release, network check, or quota window."
    }
  ].map((opt) => `
          <button
            onclick="confirmSetTaskBlocked(${task.id}, '${opt.kind}')"
            class="w-full text-left p-3.5 rounded-2xl border-2 transition flex items-start justify-between gap-3 ${current === opt.kind && task.status === "blocked" ? "bg-rose-50 border-vermilion shadow-[0_2px_0_#E03E1A]" : "bg-card border-ink hover:bg-recessed"}"
          >
            <div>
              <div class="font-serif text-base font-bold text-ink">${opt.title}</div>
              <div class="text-xs text-muted mt-0.5">${opt.desc}</div>
            </div>
            <i class="ph-bold ph-arrow-right text-vermilion mt-1 text-base"></i>
          </button>
        `).join("")}
      </div>
    </div>
  `);
}
async function confirmSetTaskBlocked(taskId, blockedKind) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.status === "blocked" && task.blocked_kind === blockedKind) {
    closeTopModal();
    return;
  }
  const kind = blockedKind || "waiting-human";
  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}`, { status: "blocked", blocked_kind: kind });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Block failed", errorMsg, "red");
    return;
  }
  task.status = "blocked";
  task.blocked_kind = kind;
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  closeTopModal();
  showToast(`Task #${task.id} Blocked`, formatBlockedReason(task.blocked_kind), "red");
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function quickUnblockAndReplyModal(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  showCustomModal(`
    <form onsubmit="executeQuickUnblock(event, ${task.id})" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-forest">Unblock Task</div>
          <h3 class="font-serif font-bold text-lg text-ink">Unblock Task #${task.id}</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <div class="text-sm font-semibold text-ink">${escapeHtml(task.title)}</div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">
          Note for ${escapeHtml(task.assignee ? "@" + task.assignee : "agents")} (optional)
        </label>
        <textarea
          id="quick-unblock-comment"
          rows="3"
          onfocus="keepFieldAboveKeyboard(this)"
          placeholder="Leave an optional note or instructions..."
          class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none"
        ></textarea>
      </div>

      <button type="submit" class="hw-btn tap-44 w-full bg-forest text-white font-mono text-xs font-bold py-3 rounded-xl">
        Unblock &amp; Move to In Progress
      </button>
    </form>
  `);
}
async function executeQuickUnblock(e, taskId) {
  e.preventDefault();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const input2 = document.getElementById("quick-unblock-comment");
  const body = input2 ? input2.value.trim() : "";
  try {
    if (body) {
      await api.post(`/admin/api/kanban/tasks/${taskId}/comments`, { body });
    }
    await api.put(`/admin/api/kanban/tasks/${taskId}`, { status: "doing" });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Unblock failed", errorMsg, "red");
    return;
  }
  task.status = "doing";
  task.blocked_kind = null;
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  closeTopModal();
  showToast(`Task #${task.id} Unblocked`, `Moved to In Progress`, "green");
  if (state.openTaskId === taskId) await loadTaskDetail(taskId);
  await refreshTasks();
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}
async function manualAssignTask(taskId, agentVal) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const newAssignee = agentVal ? agentVal : null;
  if (task.assignee === newAssignee) return;
  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}`, { assignee: newAssignee });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Assign failed", errorMsg, "red");
    return;
  }
  task.assignee = newAssignee;
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  showToast(
    newAssignee ? `Assigned to @${newAssignee}` : "Task Unassigned",
    task.title
  );
  if (state.openTaskId === taskId) await loadTaskDetail(taskId);
  await refreshTasks();
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function updateTaskPriority(taskId, priority) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || task.priority === priority) return;
  task.priority = priority;
  showToast(`Priority set to ${PRIORITY_LABELS[priority] || priority}`);
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function setTaskDueOffset(taskId, offsetSec) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const nowSec = Math.floor(Date.now() / 1e3);
  task.due_at = offsetSec === null ? null : nowSec + offsetSec;
  showToast(task.due_at ? "Due date updated" : "Due date cleared");
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
async function touchTaskActivity(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  await loadTaskDetail(taskId);
  showToast("Task #" + task.id + " refreshed", "Latest data loaded", "green");
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
var win4 = window;
win4.selectProject = selectProject;
win4.updateKanbanSearch = updateKanbanSearch;
win4.toggleKanbanFilterDrawer = toggleKanbanFilterDrawer;
win4.setKanbanFilter = setKanbanFilter;
win4.resetKanbanFilters = resetKanbanFilters;
win4.requestTaskStatusChange = requestTaskStatusChange;
win4.openBlockedKindPicker = openBlockedKindPicker;
win4.confirmSetTaskBlocked = confirmSetTaskBlocked;
win4.quickUnblockAndReplyModal = quickUnblockAndReplyModal;
win4.executeQuickUnblock = executeQuickUnblock;
win4.manualAssignTask = manualAssignTask;
win4.updateTaskPriority = updateTaskPriority;
win4.setTaskDueOffset = setTaskDueOffset;
win4.touchTaskActivity = touchTaskActivity;
win4.keepFieldAboveKeyboard = keepFieldAboveKeyboard;

// src-frontend/js/views/kanban-dnd.ts
var draggedTaskId = null;
var lastSwipeGestureTs = 0;
function openTaskDrawerIfNotSwiped(e, taskId) {
  if (Date.now() - lastSwipeGestureTs < 320) {
    if (e) e.stopPropagation();
    return;
  }
  openTaskDrawer(taskId);
}
function handleKanbanDragStart(e, taskId) {
  draggedTaskId = taskId;
  if (e.dataTransfer) {
    e.dataTransfer.setData("text/plain", String(taskId));
    e.dataTransfer.effectAllowed = "move";
  }
}
function handleKanbanDragOver(e) {
  e.preventDefault();
  const col = e.currentTarget;
  if (col && !col.classList.contains("kanban-drop-active")) {
    col.classList.add("kanban-drop-active");
  }
}
function handleKanbanDragLeave(e) {
  const col = e.currentTarget;
  if (col) col.classList.remove("kanban-drop-active");
}
function handleKanbanDrop(e, targetStatus) {
  e.preventDefault();
  const col = e.currentTarget;
  if (col) col.classList.remove("kanban-drop-active");
  const id = draggedTaskId || Number(e.dataTransfer?.getData("text/plain"));
  draggedTaskId = null;
  if (!id) return;
  void requestTaskStatusChange(id, targetStatus);
}
var SWIPE_THRESHOLD_PX = 70;
var activeTaskSwipe = null;
function handleTaskPointerDown(e, taskId) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const target = e.target;
  if (target?.closest("button, a, input, select, textarea")) return;
  const fg = document.getElementById(`task-swipe-fg-${taskId}`);
  const bg = document.getElementById(`task-swipe-bg-${taskId}`);
  const leftHint = document.getElementById(`task-swipe-left-hint-${taskId}`);
  const rightHint = document.getElementById(`task-swipe-right-hint-${taskId}`);
  const strip = document.getElementById("kanban-board-strip");
  if (!fg) return;
  fg.classList.remove("swipe-snap");
  activeTaskSwipe = {
    taskId,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    rawDx: 0,
    lockedHoriz: false,
    aborted: false,
    fg,
    bg,
    leftHint,
    rightHint,
    strip
  };
  window.addEventListener("pointermove", handleTaskPointerMove, { passive: false });
  window.addEventListener("pointerup", handleTaskPointerUp);
  window.addEventListener("pointercancel", handleTaskPointerUp);
}
function handleTaskPointerMove(e) {
  if (!activeTaskSwipe || e.pointerId !== activeTaskSwipe.pointerId || activeTaskSwipe.aborted) return;
  const dx = e.clientX - activeTaskSwipe.startX;
  const dy = e.clientY - activeTaskSwipe.startY;
  if (!activeTaskSwipe.lockedHoriz) {
    if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
      activeTaskSwipe.aborted = true;
      cleanupTaskPointerListeners();
      return;
    }
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      activeTaskSwipe.lockedHoriz = true;
      if (activeTaskSwipe.strip) {
        activeTaskSwipe.strip.style.overflowX = "hidden";
      }
      activeTaskSwipe.fg.setAttribute("draggable", "false");
    }
  }
  if (activeTaskSwipe.lockedHoriz) {
    if (e.cancelable) e.preventDefault();
    activeTaskSwipe.rawDx = dx;
    const damped = applySwipeResistance(dx, SWIPE_THRESHOLD_PX);
    activeTaskSwipe.fg.style.transform = `translate3d(${damped}px, 0, 0)`;
    const past = Math.abs(dx) >= SWIPE_THRESHOLD_PX;
    if (activeTaskSwipe.bg) {
      activeTaskSwipe.bg.className = `swipe-bg px-4 flex items-center justify-between rounded-2xl transition-colors duration-150 ${past ? "bg-forest text-white" : "bg-charcoal text-stone-300"}`;
    }
    if (activeTaskSwipe.leftHint && activeTaskSwipe.rightHint) {
      activeTaskSwipe.leftHint.style.opacity = dx > 0 ? "1" : "0.15";
      activeTaskSwipe.leftHint.style.transform = `scale(${past && dx > 0 ? 1.08 : 0.95})`;
      activeTaskSwipe.rightHint.style.opacity = dx < 0 ? "1" : "0.15";
      activeTaskSwipe.rightHint.style.transform = `scale(${past && dx < 0 ? 1.08 : 0.95})`;
    }
  }
}
function handleTaskPointerUp(e) {
  if (!activeTaskSwipe || e.pointerId !== activeTaskSwipe.pointerId) return;
  const { taskId, lockedHoriz, rawDx, fg, strip } = activeTaskSwipe;
  cleanupTaskPointerListeners();
  activeTaskSwipe = null;
  if (strip) {
    strip.style.overflowX = "";
  }
  if (fg) {
    fg.setAttribute("draggable", "true");
  }
  if (!lockedHoriz || !fg) return;
  lastSwipeGestureTs = Date.now();
  const passedThreshold = Math.abs(rawDx) >= SWIPE_THRESHOLD_PX;
  fg.classList.add("swipe-snap");
  requestAnimationFrame(() => {
    fg.style.transform = "translate3d(0px, 0, 0)";
  });
  let finished = false;
  const onFinish = () => {
    if (finished) return;
    finished = true;
    fg.removeEventListener("transitionend", onFinish);
    fg.classList.remove("swipe-snap");
    if (passedThreshold) {
      state.swipedTaskId = state.swipedTaskId === taskId ? null : taskId;
      if (window.renderMainViewport) window.renderMainViewport(true);
    }
  };
  fg.addEventListener("transitionend", onFinish);
  setTimeout(onFinish, 290);
}
function cleanupTaskPointerListeners() {
  window.removeEventListener("pointermove", handleTaskPointerMove);
  window.removeEventListener("pointerup", handleTaskPointerUp);
  window.removeEventListener("pointercancel", handleTaskPointerUp);
}
function clearTaskSwipe(e) {
  if (e) e.stopPropagation();
  state.swipedTaskId = null;
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function quickCompleteTask(taskId, e) {
  if (e) e.stopPropagation();
  state.swipedTaskId = null;
  void requestTaskStatusChange(taskId, "done");
}
function quickCycleAssignee(taskId, e) {
  if (e) e.stopPropagation();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const order = [null, ...state.agents.map((a) => a.agent)];
  const idx = order.indexOf(task.assignee);
  const next = order[(idx + 1) % order.length];
  state.swipedTaskId = null;
  void manualAssignTask(taskId, next || "");
}
var win5 = window;
win5.openTaskDrawerIfNotSwiped = openTaskDrawerIfNotSwiped;
win5.handleKanbanDragStart = handleKanbanDragStart;
win5.handleKanbanDragOver = handleKanbanDragOver;
win5.handleKanbanDragLeave = handleKanbanDragLeave;
win5.handleKanbanDrop = handleKanbanDrop;
win5.handleTaskPointerDown = handleTaskPointerDown;
win5.handleTaskPointerMove = handleTaskPointerMove;
win5.handleTaskPointerUp = handleTaskPointerUp;
win5.clearTaskSwipe = clearTaskSwipe;
win5.quickCompleteTask = quickCompleteTask;
win5.quickCycleAssignee = quickCycleAssignee;

// src-frontend/js/views/kanban-modals.ts
async function clearTaskNotes(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  try {
    await api.put("/admin/api/kanban/tasks/" + taskId, { notes: "" });
  } catch (_e) {
    const errorMsg = _e instanceof Error ? _e.message : String(_e);
    showToast("Clear failed", errorMsg, "red");
    return;
  }
  task.notes = "";
  const draft = getTaskDraft(task);
  draft.notes = "";
  draft.dirty = false;
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  showToast("Cleared document notes");
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
async function addTaskLabel(e, taskId) {
  e.preventDefault();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const input2 = document.getElementById("new-label-input");
  const raw2 = input2 ? input2.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") : "";
  if (!raw2) return;
  if (!task.labels.includes(raw2)) {
    try {
      await api.post(`/admin/api/kanban/tasks/${taskId}/labels`, { label: raw2 });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast("Add label failed", errorMsg, "red");
      return;
    }
    task.labels.push(raw2);
    task.last_activity_at = Math.floor(Date.now() / 1e3);
    showToast(`Added label #${raw2}`);
  }
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
async function removeTaskLabel(taskId, label) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  try {
    await api.del(`/admin/api/kanban/tasks/${taskId}/labels/${encodeURIComponent(label)}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Remove label failed", errorMsg, "red");
    return;
  }
  task.labels = task.labels.filter((l) => l !== label);
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  showToast(`Removed #${label}`);
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
async function toggleTodoItem(taskId, todoId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const todo = task.todos.find((td) => td.id === todoId);
  if (!todo) return;
  const newDone = todo.done === 1 ? 0 : 1;
  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}/todos/${todoId}`, { done: newDone });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Todo update failed", errorMsg, "red");
    return;
  }
  todo.done = newDone;
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
async function addTodoItem(e, taskId) {
  e.preventDefault();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const input2 = document.getElementById("new-todo-input");
  const text = input2 ? input2.value.trim() : "";
  if (!text) {
    showToast("Please enter checklist text", "", "red");
    return;
  }
  let newTodo = null;
  try {
    newTodo = await api.post(`/admin/api/kanban/tasks/${taskId}/todos`, { text });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Add todo failed", errorMsg, "red");
    return;
  }
  task.todos.push({
    id: newTodo.id || newTodo.todo?.id || Date.now(),
    task_id: task.id,
    text,
    done: 0,
    sort_order: task.todos.length
  });
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  showToast("Added checklist step");
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
async function deleteTodoItem(taskId, todoId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  try {
    await api.del(`/admin/api/kanban/tasks/${taskId}/todos/${todoId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Delete todo failed", errorMsg, "red");
    return;
  }
  task.todos = task.todos.filter((td) => td.id !== todoId);
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
async function postTaskComment(e, taskId) {
  e.preventDefault();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const input2 = document.getElementById("new-comment-body");
  const body = input2 ? input2.value.trim() : "";
  if (!body) return;
  let saved = null;
  try {
    saved = await api.post(`/admin/api/kanban/tasks/${taskId}/comments`, { body });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Comment failed", errorMsg, "red");
    return;
  }
  task.comments.push({
    id: saved.id || saved.comment?.id || Date.now(),
    task_id: task.id,
    author: "luki",
    body,
    ts: Math.floor(Date.now() / 1e3)
  });
  const draft = getTaskDraft(task);
  draft.commentDraft = "";
  task.last_activity_at = Math.floor(Date.now() / 1e3);
  showToast("Comment posted");
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function confirmDeleteTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="font-mono text-xs font-bold uppercase text-vermilion">Delete Task</div>
      <h3 class="font-serif font-bold text-lg text-ink">Delete Task #${task.id}?</h3>
      <p class="text-sm text-muted">
        This permanently deletes <strong>"${escapeHtml(task.title)}"</strong> and its ${(task.todos || []).length} checklist steps.
      </p>
      <div class="flex gap-2">
        <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
        <button onclick="executeDeleteTask(${task.id})" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Delete Task</button>
      </div>
    </div>
  `);
}
async function executeDeleteTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  try {
    await api.del(`/admin/api/kanban/tasks/${taskId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Delete failed", errorMsg, "red");
    return;
  }
  state.tasks = state.tasks.filter((t) => t.id !== taskId);
  delete state.taskDrafts[taskId];
  closeTopModal();
  state.openTaskId = null;
  const drawer = document.getElementById("task-drawer");
  if (drawer) {
    drawer.classList.add("hidden");
    drawer.classList.remove("flex");
  }
  showToast(`Deleted Task #${taskId}`);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function openCreateTaskModal() {
  const proj = state.projects.find((p) => p.id === state.activeProjectId) || state.projects[0];
  const title2 = proj ? proj.title : "Project";
  showCustomModal(`
    <form onsubmit="executeCreateTask(event)" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">${escapeHtml(title2)}</div>
          <h3 class="font-serif font-bold text-lg text-ink">New Task</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Title</label>
        <input id="create-task-title" type="text" required placeholder="What needs to be done?" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-bold text-ink focus:outline-none" />
      </div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Summary (optional)</label>
        <input id="create-task-desc" type="text" placeholder="Short context..." class="tap-44 w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none" />
      </div>

      <div class="grid grid-cols-2 gap-2.5">
        <div>
          <label class="block font-mono text-xs font-bold text-muted mb-1">Priority</label>
          <select id="create-task-priority" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans text-ink">
            <option value="normal" selected>Normal</option>
            <option value="urgent">Urgent</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div>
          <label class="block font-mono text-xs font-bold text-muted mb-1">Assignee</label>
          <select id="create-task-assignee" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans text-ink">
            <option value="">Unassigned</option>
            ${state.agents.map((a) => `<option value="${a.agent}">@${a.agent}</option>`).join("")}
          </select>
        </div>
      </div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Labels (comma-separated)</label>
        <input id="create-task-labels" type="text" placeholder="spec, storage" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none" />
      </div>

      <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
        Create Task
      </button>
    </form>
  `);
}
async function executeCreateTask(e) {
  e.preventDefault();
  const titleInput = document.getElementById("create-task-title");
  const descInput = document.getElementById("create-task-desc");
  const assigneeSelect = document.getElementById("create-task-assignee");
  const labelsInput = document.getElementById("create-task-labels");
  const title2 = titleInput ? titleInput.value.trim() : "";
  const desc = descInput ? descInput.value.trim() : "";
  const assigneeVal = assigneeSelect && assigneeSelect.value ? assigneeSelect.value : null;
  const rawLabels = labelsInput ? labelsInput.value : "";
  const labels = rawLabels.split(",").map((s) => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "")).filter(Boolean);
  let created = null;
  try {
    created = await api.post(`/admin/api/kanban/projects/${state.activeProjectId}/tasks`, {
      title: title2,
      description: desc,
      assignee: assigneeVal,
      labels
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Create failed", errorMsg, "red");
    return;
  }
  const now = Math.floor(Date.now() / 1e3);
  const newTask = {
    id: created.id || created.task?.id || Date.now(),
    project_id: state.activeProjectId || 1,
    title: title2,
    description: desc || "",
    notes: "",
    status: "todo",
    blocked_kind: null,
    assignee: assigneeVal,
    labels,
    todos: [],
    comments: [],
    comment_count: 0,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
    created_by: "luki",
    claimed_at: null
  };
  state.tasks.unshift(newTask);
  closeTopModal();
  showToast(`Created Task #${newTask.id}`, title2, "green");
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function openProjectModal(projId) {
  const proj = projId ? state.projects.find((p) => p.id === projId) : null;
  const subs = proj ? proj.subscribers || [] : [];
  showCustomModal(`
    <form onsubmit="saveProjectModal(event, ${proj ? proj.id : "null"})" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">
            ${proj ? "Project Settings" : "New Project"}
          </div>
          <h3 class="font-serif font-bold text-lg text-ink">
            ${proj ? "Edit Project & Agent Access" : "Create Kanban Project"}
          </h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Project Title</label>
        <input id="proj-modal-title" type="text" required value="${escapeHtml(proj ? proj.title : "")}" placeholder="Project title..." class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-bold text-ink" />
      </div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Description</label>
        <textarea id="proj-modal-desc" rows="2" class="w-full hw-inset rounded-xl px-3 py-2 text-ink">${escapeHtml(proj && proj.description ? proj.description : "")}</textarea>
      </div>

      <!-- Project Subscribers -->
      <div class="hw-inset rounded-xl p-3.5 space-y-2">
        <div class="font-mono text-xs font-bold uppercase text-ink">
          Subscribed Agents
        </div>
        <p class="text-xs text-muted leading-snug">
          Leave all unchecked so every agent can view and claim tasks. Or select specific agents to restrict access.
        </p>
        <div class="grid grid-cols-3 gap-2 pt-1">
          ${state.agents.map((a) => `
            <label class="tap-44 flex items-center gap-2 p-2.5 rounded-xl bg-card border border-border cursor-pointer font-mono text-xs font-bold">
              <input type="checkbox" name="proj-sub" value="${a.agent}" ${subs.includes(a.agent) ? "checked" : ""} class="accent-ink w-4 h-4" />
              <span>@${a.agent}</span>
            </label>
          `).join("")}
        </div>
      </div>

      <div class="flex gap-2 pt-1">
        ${proj && state.projects.length > 1 ? `
          <button type="button" onclick="deleteProject(${proj.id})" class="hw-btn tap-44 bg-rose-100 text-vermilion font-mono text-xs font-bold px-3.5 rounded-xl">
            Delete
          </button>
        ` : ""}
        <button type="submit" class="hw-btn tap-44 flex-1 bg-ink text-paper font-mono text-xs font-bold py-2.5 rounded-xl">
          ${proj ? "Save Changes" : "Create Project"}
        </button>
      </div>
    </form>
  `);
}
async function saveProjectModal(e, projId) {
  e.preventDefault();
  const titleInput = document.getElementById("proj-modal-title");
  const descInput = document.getElementById("proj-modal-desc");
  const checked = Array.from(document.querySelectorAll('input[name="proj-sub"]:checked')).map((el) => el.value);
  const title2 = titleInput ? titleInput.value.trim() : "";
  const desc = descInput ? descInput.value.trim() : "";
  if (!title2) return;
  try {
    if (projId) {
      await api.put(`/admin/api/kanban/projects/${projId}`, { title: title2, description: desc, subscribers: checked });
      const proj = state.projects.find((p) => p.id === projId);
      if (proj) {
        proj.title = title2;
        proj.description = desc || "";
        proj.subscribers = checked;
        showToast(`Updated ${proj.title}`, checked.length ? `Access: ${checked.join(", ")}` : "Open to all agents");
      }
    } else {
      const created = await api.post("/admin/api/kanban/projects", { title: title2, description: desc, subscribers: checked });
      const newProj = {
        id: created.id || created.project?.id || Date.now(),
        title: title2,
        description: desc || "",
        archived: false,
        subscribers: checked
      };
      state.projects.push(newProj);
      state.activeProjectId = newProj.id;
      await refreshTasks();
      showToast(`Created ${newProj.title}`, "", "green");
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Project save failed", errorMsg, "red");
    return;
  }
  closeTopModal();
  if (window.renderMainViewport) window.renderMainViewport(true);
}
async function deleteProject(projId) {
  const proj = state.projects.find((p) => p.id === projId);
  try {
    await api.del(`/admin/api/kanban/projects/${projId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Delete failed", errorMsg, "red");
    return;
  }
  state.projects = state.projects.filter((p) => p.id !== projId);
  state.tasks = state.tasks.filter((t) => t.project_id !== projId);
  state.activeProjectId = state.projects.length && state.projects[0] ? state.projects[0].id : null;
  await refreshTasks();
  closeTopModal();
  showToast(`Deleted project`, proj ? proj.title : "", "red");
  if (window.renderMainViewport) window.renderMainViewport(false);
}
var win6 = window;
win6.clearTaskNotes = clearTaskNotes;
win6.addTaskLabel = addTaskLabel;
win6.removeTaskLabel = removeTaskLabel;
win6.toggleTodoItem = toggleTodoItem;
win6.addTodoItem = addTodoItem;
win6.deleteTodoItem = deleteTodoItem;
win6.postTaskComment = postTaskComment;
win6.confirmDeleteTask = confirmDeleteTask;
win6.executeDeleteTask = executeDeleteTask;
win6.openCreateTaskModal = openCreateTaskModal;
win6.executeCreateTask = executeCreateTask;
win6.openProjectModal = openProjectModal;
win6.saveProjectModal = saveProjectModal;
win6.deleteProject = deleteProject;

// src-frontend/js/views/feed-card.tsx
function MessageCard({ m, isInsideThread = false }) {
  const st = getAgentStyle(m.sender);
  const parentMsg = m.reply_to ? state.messages.find((p) => p.id === m.reply_to) : null;
  const rootId = getRootMessageId(m) ?? m.id;
  const replies = getDirectAndThreadReplies(rootId);
  const replyCount = replies.length;
  return /* @__PURE__ */ jsxDEV("div", { class: "swipe-shell select-none", id: `msg-swipe-shell-${m.id}`, children: [
    /* @__PURE__ */ jsxDEV(
      "div",
      {
        id: `msg-swipe-bg-${m.id}`,
        class: "swipe-bg bg-charcoal text-stone-200 px-4 flex items-center justify-start gap-2.5 rounded-2xl transition-colors duration-150",
        children: [
          /* @__PURE__ */ jsxDEV(
            "span",
            {
              id: `msg-swipe-icon-${m.id}`,
              class: "w-10 h-10 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center transition-transform duration-150",
              children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-arrow-bend-up-left text-lg" })
            }
          ),
          /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold", children: [
            /* @__PURE__ */ jsxDEV("div", { id: `msg-swipe-label-${m.id}`, children: "Swipe to reply" }),
            /* @__PURE__ */ jsxDEV("div", { class: "text-[10px] opacity-80", children: [
              "@",
              m.sender,
              " \u2022 #",
              m.channel
            ] })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ jsxDEV(
      "article",
      {
        id: `msg-card-${m.id}`,
        onpointerdown: `handleMsgPointerDown(event, ${m.id})`,
        onclick: `openMessageThreadIfNotSwiped(${rootId}, event)`,
        class: `swipe-fg hw-card rounded-2xl p-3.5 bg-card space-y-2.5 cursor-pointer relative ${m.priority === "urgent" ? "border-l-4 border-l-vermilion" : ""}`,
        children: [
          parentMsg && /* @__PURE__ */ jsxDEV(
            "button",
            {
              type: "button",
              onclick: `scrollToQuotedMessage(${parentMsg.id}, event)`,
              class: "w-full text-left hw-inset rounded-xl px-3 py-2 border-l-4 border-l-forest flex items-center justify-between gap-2 hover:bg-card transition",
              children: [
                /* @__PURE__ */ jsxDEV("div", { class: "min-w-0", children: [
                  /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold text-forest flex items-center gap-1", children: [
                    /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-arrow-bend-up-left" }),
                    /* @__PURE__ */ jsxDEV("span", { children: [
                      "Replying to @",
                      parentMsg.sender
                    ] })
                  ] }),
                  /* @__PURE__ */ jsxDEV("div", { class: "text-xs text-muted truncate mt-0.5", children: [
                    '"',
                    parentMsg.body,
                    '"'
                  ] })
                ] }),
                /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] text-muted shrink-0", children: "Jump" })
              ]
            }
          ),
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between gap-2 flex-wrap", children: [
            /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 flex-wrap", children: [
              /* @__PURE__ */ jsxDEV(
                "button",
                {
                  onclick: `event.stopPropagation(); setMsgFilter('sender', '${escapeHtml(m.sender)}')`,
                  class: `tap-44 px-2.5 rounded-xl font-mono text-xs font-bold ${st.bg} ${st.text} border ${st.border} flex items-center gap-1`,
                  children: [
                    "@",
                    m.sender
                  ]
                }
              ),
              /* @__PURE__ */ jsxDEV(
                "button",
                {
                  onclick: `event.stopPropagation(); setMsgFilter('channel', '${escapeHtml(m.channel)}')`,
                  class: "tap-44 px-2.5 rounded-xl font-mono text-xs font-bold bg-recessed text-ink border border-border flex items-center",
                  children: [
                    "#",
                    m.channel
                  ]
                }
              ),
              m.priority === "urgent" && /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold", children: "Urgent" }),
              m.priority === "low" && /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] bg-stone-200 text-stone-700 px-2 py-0.5 rounded-md font-semibold", children: "Low" }),
              m.audience === "luki" && /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] px-2 py-0.5 rounded-md bg-amber-200 text-amber-950 border border-amber-700 font-bold", children: "Just me" })
            ] }),
            /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1", onclick: "event.stopPropagation()", children: [
              /* @__PURE__ */ jsxDEV(
                "button",
                {
                  onclick: `startReplyToMessage(${m.id}, event)`,
                  class: "tap-44 w-11 rounded-xl bg-recessed hover:bg-ink hover:text-paper text-ink flex items-center justify-center transition",
                  title: "Reply to message",
                  children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-arrow-bend-up-left text-base" })
                }
              ),
              /* @__PURE__ */ jsxDEV(
                "button",
                {
                  onclick: `openEditMessageModal(${m.id})`,
                  class: "tap-44 w-11 rounded-xl bg-recessed hover:bg-ink hover:text-paper text-ink flex items-center justify-center transition",
                  title: "Edit message",
                  children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-pencil-simple text-base" })
                }
              ),
              /* @__PURE__ */ jsxDEV(
                "button",
                {
                  onclick: `confirmDeleteMessage(${m.id})`,
                  class: "tap-44 w-11 rounded-xl bg-recessed hover:bg-vermilion hover:text-white text-muted flex items-center justify-center transition",
                  title: "Delete message",
                  children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-trash text-base" })
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("p", { class: "text-sm text-ink leading-relaxed break-words whitespace-pre-wrap", children: m.body }),
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between font-mono text-xs text-muted pt-1.5 border-t border-border/60", children: [
            /* @__PURE__ */ jsxDEV("span", { children: [
              formatFriendlyIsoTime(m.ts),
              " \u2022 ",
              formatRelIso(m.ts)
            ] }),
            /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-2", children: !isInsideThread && replyCount > 0 ? /* @__PURE__ */ jsxDEV("span", { class: "text-forest font-bold flex items-center gap-1", children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-chats-circle" }),
              replyCount,
              " ",
              replyCount === 1 ? "reply" : "replies"
            ] }) : /* @__PURE__ */ jsxDEV("span", { class: "text-muted flex items-center gap-1", children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-chat-teardrop" }),
              " Thread"
            ] }) })
          ] })
        ]
      }
    )
  ] });
}
function renderMessageCard(m, isInsideThread = false) {
  return String(/* @__PURE__ */ jsxDEV(MessageCard, { m, isInsideThread }));
}
function renderThreadTimeline(rootMsg) {
  const replies = getDirectAndThreadReplies(rootMsg.id);
  const html2 = /* @__PURE__ */ jsxDEV("div", { class: "p-3.5 pb-24 space-y-3.5", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "hw-card rounded-2xl p-2.5 bg-card flex items-center justify-between gap-2", children: [
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          onclick: "closeMessageThread()",
          class: "tap-44 px-3 rounded-xl bg-recessed text-ink font-mono text-xs font-bold flex items-center gap-1.5 border border-border",
          children: [
            /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-arrow-left text-base" }),
            /* @__PURE__ */ jsxDEV("span", { children: "Back to Bus Feed" })
          ]
        }
      ),
      /* @__PURE__ */ jsxDEV("span", { class: "font-serif font-bold text-base text-ink pr-2", children: [
        "Thread in #",
        rootMsg.channel
      ] })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "space-y-1.5", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-muted px-1", children: "Original Post" }),
      /* @__PURE__ */ jsxDEV(MessageCard, { m: rootMsg, isInsideThread: true })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "space-y-2.5 pt-1", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-muted px-1", children: [
        "Replies (",
        replies.length,
        ")"
      ] }),
      replies.length === 0 ? /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-2xl p-6 text-center text-sm text-muted", children: "No replies yet. Swipe right on the post above or tap below to reply." }) : replies.map((r) => /* @__PURE__ */ jsxDEV("div", { class: "pl-3 border-l-2 border-forest", children: /* @__PURE__ */ jsxDEV(MessageCard, { m: r, isInsideThread: true }) }))
    ] })
  ] });
  return String(html2);
}

// src-frontend/js/views/feed.tsx
function getChannelMembers(channelName) {
  let members = state.channelMembers[channelName];
  if (!members || members.length === 0) {
    if (channelName.startsWith("dm:")) {
      const parts = channelName.split(":");
      members = parts.slice(1);
    } else {
      members = state.agents.map((a) => a.agent);
    }
    state.channelMembers[channelName] = members;
  }
  return members;
}
function getDistinctSenders() {
  const set = /* @__PURE__ */ new Set(["luki"]);
  state.messages.forEach((m) => set.add(m.sender));
  state.agents.forEach((a) => set.add(a.agent));
  return Array.from(set).sort();
}
function getRootMessageId(msg) {
  if (!msg) return null;
  let curr = msg;
  let safety = 0;
  while (curr.reply_to && safety < 20) {
    const parent = state.messages.find((m) => m.id === curr.reply_to);
    if (!parent) break;
    curr = parent;
    safety++;
  }
  return curr.id;
}
function getDirectAndThreadReplies(rootId) {
  return state.messages.filter((m) => m.id !== rootId && getRootMessageId(m) === rootId).sort((a, b) => a.id - b.id);
}
function renderMessagesView() {
  const mf = state.msgFilter;
  const senders = getDistinctSenders();
  if (!state.channels.includes(state.composerDraft.channel)) {
    state.composerDraft.channel = mf.channel !== "ALL" ? mf.channel : "all-agent";
  }
  const threadRootMsg = state.openThreadMsgId ? state.messages.find((m) => m.id === state.openThreadMsgId) : null;
  if (state.openThreadMsgId && !threadRootMsg) {
    state.openThreadMsgId = null;
  }
  const sortedMsgs = [...state.messages].sort((a, b) => b.id - a.id);
  const filteredMsgs = sortedMsgs.filter((m) => {
    if (mf.channel && mf.channel !== "ALL" && m.channel !== mf.channel) return false;
    if (mf.sender && mf.sender !== "ALL" && m.sender !== mf.sender) return false;
    if (mf.priority && mf.priority !== "ALL" && m.priority !== mf.priority) return false;
    if (mf.q && mf.q.trim() !== "") {
      const needle = mf.q.trim().toLowerCase().replace(/[%_]/g, "");
      if (!m.body.toLowerCase().includes(needle)) return false;
    }
    return true;
  });
  const draft = state.composerDraft;
  const replyTarget = draft.reply_to ? state.messages.find((m) => m.id === draft.reply_to) : null;
  const prioHintStyle = draft.priority === "urgent" ? "bg-vermilion text-white border-vermilion" : draft.priority === "low" ? "bg-stone-200 text-stone-700 border-stone-400" : "bg-recessed text-ink border-border";
  const targetCh = mf.channel !== "ALL" ? mf.channel : state.composerDraft.channel;
  const members = getChannelMembers(targetCh);
  const html2 = /* @__PURE__ */ jsxDEV("div", { class: "flex-1 flex flex-col justify-between min-h-full", children: [
    threadRootMsg ? /* @__PURE__ */ jsxDEV("div", { dangerouslySetInnerHTML: { __html: renderThreadTimeline(threadRootMsg) } }) : /* @__PURE__ */ jsxDEV("div", { class: "p-3.5 pb-24 space-y-3", children: [
      /* @__PURE__ */ jsxDEV("div", { class: "hw-card rounded-2xl p-3 bg-card space-y-2.5", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold uppercase tracking-wider text-muted", children: [
            "Channels (",
            state.channels.length,
            ")"
          ] }),
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5", children: [
            mf.channel !== "ALL" && mf.channel !== "all-agent" && /* @__PURE__ */ jsxDEV(
              "button",
              {
                onclick: `confirmDeleteChannel('${escapeHtml(mf.channel)}')`,
                class: "tap-44 px-3 font-mono text-xs font-bold bg-rose-100 text-vermilion border border-rose-400 rounded-xl flex items-center",
                children: [
                  "Delete #",
                  mf.channel
                ]
              }
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                onclick: "openCreateChannelModal()",
                class: "hw-btn tap-44 px-3 font-mono text-xs font-bold bg-ink text-paper rounded-xl flex items-center gap-1",
                children: [
                  /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-plus" }),
                  " New Channel"
                ]
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { "data-scroll-id": "msg-channel-strip", class: "flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5", children: [
          /* @__PURE__ */ jsxDEV(
            "button",
            {
              onclick: "setMsgFilter('channel', 'ALL')",
              class: `tap-44 px-3 rounded-xl font-mono text-xs font-bold shrink-0 border transition flex items-center ${mf.channel === "ALL" ? "bg-ink text-paper border-ink" : "bg-recessed text-ink border-border"}`,
              children: [
                "All (",
                state.messages.length,
                ")"
              ]
            }
          ),
          state.channels.slice().sort().map((ch) => {
            const count = state.messages.filter((m) => m.channel === ch).length;
            const active = mf.channel === ch;
            const isDm = ch.startsWith("dm:");
            return /* @__PURE__ */ jsxDEV(
              "button",
              {
                onclick: `setMsgFilter('channel', '${escapeHtml(ch)}')`,
                class: `tap-44 px-3 rounded-xl font-mono text-xs font-bold shrink-0 border transition flex items-center gap-1.5 ${active ? "bg-ink text-paper border-ink" : "bg-recessed text-ink border-border"}`,
                children: [
                  /* @__PURE__ */ jsxDEV("i", { class: `ph-bold ${isDm ? "ph-chats" : "ph-hash"} text-xs opacity-75` }),
                  /* @__PURE__ */ jsxDEV("span", { children: ch }),
                  /* @__PURE__ */ jsxDEV("span", { class: "text-[11px] opacity-70", children: count })
                ]
              },
              ch
            );
          })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "pt-2 border-t border-border flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 flex-wrap min-w-0", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] font-bold text-muted flex items-center gap-1", children: [
              /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-users" }),
              " #",
              targetCh,
              " members (",
              members.length,
              "):"
            ] }),
            members.length === 0 ? /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-[11px] text-muted italic", children: "No members" }) : members.map((ag) => {
              const st = getAgentStyle(ag);
              return /* @__PURE__ */ jsxDEV("span", { class: `font-mono text-[11px] ${st.bg} ${st.text} border ${st.border} px-2 py-0.5 rounded-md font-bold`, children: [
                "@",
                ag
              ] }, ag);
            })
          ] }),
          /* @__PURE__ */ jsxDEV(
            "button",
            {
              type: "button",
              onclick: `openChannelMembersModal('${escapeHtml(targetCh)}')`,
              class: "tap-44 px-2.5 rounded-xl bg-recessed border border-border font-mono text-xs font-bold text-ink shrink-0 flex items-center gap-1",
              children: [
                /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-user-gear text-sm" }),
                /* @__PURE__ */ jsxDEV("span", { children: "Members" })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "grid grid-cols-3 gap-1.5 pt-1 border-t border-border", children: [
          /* @__PURE__ */ jsxDEV("select", { onchange: "setMsgFilter('sender', this.value)", class: "tap-44 hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink", children: [
            /* @__PURE__ */ jsxDEV("option", { value: "ALL", selected: mf.sender === "ALL", children: "All senders" }),
            senders.map((s) => /* @__PURE__ */ jsxDEV("option", { value: s, selected: mf.sender === s, children: [
              "@",
              s
            ] }, s))
          ] }),
          /* @__PURE__ */ jsxDEV("select", { onchange: "setMsgFilter('priority', this.value)", class: "tap-44 hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink", children: [
            /* @__PURE__ */ jsxDEV("option", { value: "ALL", selected: mf.priority === "ALL", children: "Any priority" }),
            /* @__PURE__ */ jsxDEV("option", { value: "urgent", selected: mf.priority === "urgent", children: "Urgent" }),
            /* @__PURE__ */ jsxDEV("option", { value: "normal", selected: mf.priority === "normal", children: "Normal" }),
            /* @__PURE__ */ jsxDEV("option", { value: "low", selected: mf.priority === "low", children: "Low" })
          ] }),
          /* @__PURE__ */ jsxDEV(
            "input",
            {
              id: "msg-search-input",
              type: "text",
              value: mf.q,
              oninput: "setMsgFilter('q', this.value)",
              placeholder: "Search posts...",
              class: "tap-44 hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink focus:outline-none"
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxDEV("div", { class: "text-xs text-muted px-1 flex items-center justify-between", children: /* @__PURE__ */ jsxDEV("span", { children: [
        /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-hand-swipe-right mr-1" }),
        "Swipe right on any post to reply \u2022 Tap a post to open its thread"
      ] }) }),
      /* @__PURE__ */ jsxDEV("div", { class: "space-y-2.5", children: filteredMsgs.length === 0 ? /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-2xl p-8 text-center text-sm text-muted", children: "No messages match your filter." }) : filteredMsgs.map((m) => /* @__PURE__ */ jsxDEV("div", { dangerouslySetInnerHTML: { __html: renderMessageCard(m, false) } }, m.id)) })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { id: "composer-dock", class: "sticky bottom-0 left-0 right-0 z-20 px-3 pb-2.5 pt-1.5 bg-gradient-to-t from-paper via-paper to-transparent", children: !state.composerExpanded ? (
      /* Compact Bar */
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          type: "button",
          onclick: "expandComposer()",
          class: "hw-card tap-44 w-full rounded-2xl px-3.5 py-2.5 bg-card flex items-center justify-between gap-2 text-left active:translate-y-0.5 transition",
          children: [
            /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-2 min-w-0 flex-1", children: [
              /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-xs font-bold bg-ink text-paper px-2.5 py-1 rounded-lg shrink-0 flex items-center gap-1", children: [
                /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-hash text-xs text-amber-400" }),
                draft.channel
              ] }),
              /* @__PURE__ */ jsxDEV("span", { class: `font-mono text-[11px] px-2 py-0.5 rounded-md border font-bold shrink-0 ${prioHintStyle}`, children: PRIORITY_LABELS[draft.priority] || "Normal" }),
              /* @__PURE__ */ jsxDEV("span", { class: "text-sm text-muted truncate pl-1", children: replyTarget ? `Replying to @${replyTarget.sender}...` : draft.body ? draft.body : "Send a message..." })
            ] }),
            /* @__PURE__ */ jsxDEV("span", { class: "w-10 h-10 rounded-xl bg-ink text-paper flex items-center justify-center shrink-0", children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-paper-plane-tilt text-base" }) })
          ]
        }
      )
    ) : (
      /* Expanded Full Composer Sheet */
      /* @__PURE__ */ jsxDEV("form", { onsubmit: "sendOperatorMessage(event)", class: "hw-card rounded-2xl p-3.5 bg-card space-y-3 shadow-2xl", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between border-b border-border pb-2", children: [
          /* @__PURE__ */ jsxDEV("span", { class: "font-serif text-base font-bold text-ink flex items-center gap-1.5", children: [
            /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-chat-centered-text text-forest" }),
            " Send a message"
          ] }),
          /* @__PURE__ */ jsxDEV(
            "button",
            {
              type: "button",
              onclick: "collapseComposer()",
              class: "tap-44 px-3 rounded-xl bg-recessed text-ink font-mono text-xs font-bold flex items-center gap-1 border border-border",
              children: [
                /* @__PURE__ */ jsxDEV("span", { children: "Dismiss" }),
                /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-caret-down" })
              ]
            }
          )
        ] }),
        replyTarget && /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-xl p-2.5 flex items-start justify-between gap-2 border-l-4 border-l-forest", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "min-w-0", children: [
            /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold text-forest", children: [
              "Replying to @",
              replyTarget.sender,
              " in #",
              replyTarget.channel
            ] }),
            /* @__PURE__ */ jsxDEV("div", { class: "text-xs text-muted truncate mt-0.5", children: [
              '"',
              replyTarget.body,
              '"'
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV(
            "button",
            {
              type: "button",
              onclick: "cancelComposerReply()",
              class: "tap-44 w-11 rounded-xl bg-card text-ink flex items-center justify-center shrink-0 border border-border",
              title: "Cancel reply",
              children: /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-x" })
            }
          )
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "grid grid-cols-3 gap-2", children: [
          /* @__PURE__ */ jsxDEV("div", { children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-[11px] font-bold text-muted mb-1", children: "Channel" }),
            /* @__PURE__ */ jsxDEV(
              "select",
              {
                id: "compose-channel",
                onchange: "updateComposerDraft('channel', this.value)",
                class: "tap-44 w-full hw-inset rounded-xl px-2 py-1.5 font-mono text-xs font-bold text-ink",
                children: state.channels.slice().sort().map((ch) => /* @__PURE__ */ jsxDEV("option", { value: ch, selected: draft.channel === ch, children: [
                  "#",
                  ch
                ] }, ch))
              }
            )
          ] }),
          /* @__PURE__ */ jsxDEV("div", { children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-[11px] font-bold text-muted mb-1", children: "Priority" }),
            /* @__PURE__ */ jsxDEV(
              "select",
              {
                id: "compose-priority",
                onchange: "updateComposerDraft('priority', this.value)",
                class: "tap-44 w-full hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink",
                children: [
                  /* @__PURE__ */ jsxDEV("option", { value: "normal", selected: draft.priority === "normal", children: "Normal" }),
                  /* @__PURE__ */ jsxDEV("option", { value: "urgent", selected: draft.priority === "urgent", children: "Urgent" }),
                  /* @__PURE__ */ jsxDEV("option", { value: "low", selected: draft.priority === "low", children: "Low" })
                ]
              }
            )
          ] }),
          /* @__PURE__ */ jsxDEV("div", { children: [
            /* @__PURE__ */ jsxDEV("label", { class: "block font-mono text-[11px] font-bold text-muted mb-1", children: "Audience" }),
            /* @__PURE__ */ jsxDEV(
              "select",
              {
                id: "compose-audience",
                onchange: "updateComposerDraft('audience', this.value)",
                class: "tap-44 w-full hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink",
                children: [
                  /* @__PURE__ */ jsxDEV("option", { value: "agents", selected: draft.audience === "agents", children: "Agents" }),
                  /* @__PURE__ */ jsxDEV("option", { value: "luki", selected: draft.audience === "luki", children: "Just me" })
                ]
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxDEV(
          "textarea",
          {
            id: "compose-body",
            rows: 3,
            required: true,
            oninput: "updateComposerDraft('body', this.value)",
            onfocus: "keepFieldAboveKeyboard(this)",
            placeholder: "Write your message...",
            class: "w-full hw-inset rounded-xl p-3 text-ink focus:outline-none leading-relaxed",
            children: draft.body
          }
        ),
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-end gap-2", children: [
          /* @__PURE__ */ jsxDEV(
            "button",
            {
              type: "button",
              onclick: "collapseComposer()",
              class: "hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold px-4 rounded-xl",
              children: "Cancel"
            }
          ),
          /* @__PURE__ */ jsxDEV(
            "button",
            {
              type: "submit",
              onclick: "sendOperatorMessage(event)",
              class: "hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-5 rounded-xl flex items-center gap-1.5",
              children: [
                /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-paper-plane-right" }),
                /* @__PURE__ */ jsxDEV("span", { children: "Send a message" })
              ]
            }
          )
        ] })
      ] })
    ) })
  ] });
  return String(html2);
}

// src-frontend/js/views/feed-gestures.ts
var lastSwipeGestureTs2 = 0;
var SWIPE_THRESHOLD_PX2 = 70;
function openMessageThread(rootId, e) {
  if (e) e.stopPropagation();
  state.openThreadMsgId = rootId;
  const rootMsg = state.messages.find((m) => m.id === rootId);
  if (rootMsg) {
    state.composerDraft.channel = rootMsg.channel;
  }
  if (window.renderMainViewport) window.renderMainViewport(false);
}
function openMessageThreadIfNotSwiped(rootId, e) {
  if (Date.now() - lastSwipeGestureTs2 < 320) {
    if (e) e.stopPropagation();
    return;
  }
  openMessageThread(rootId, e);
}
function closeMessageThread() {
  state.openThreadMsgId = null;
  if (window.renderMainViewport) window.renderMainViewport(false);
}
var activeMsgSwipe = null;
function handleMsgPointerDown(e, msgId) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const target = e.target;
  if (target?.closest("button, a, input, select, textarea")) return;
  const fg = document.getElementById(`msg-card-${msgId}`);
  const bg = document.getElementById(`msg-swipe-bg-${msgId}`);
  const icon = document.getElementById(`msg-swipe-icon-${msgId}`);
  const label = document.getElementById(`msg-swipe-label-${msgId}`);
  if (!fg) return;
  fg.classList.remove("swipe-snap");
  activeMsgSwipe = {
    msgId,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    rawDx: 0,
    lockedHoriz: false,
    aborted: false,
    fg,
    bg,
    icon,
    label
  };
  window.addEventListener("pointermove", handleMsgPointerMove, { passive: false });
  window.addEventListener("pointerup", handleMsgPointerUp);
  window.addEventListener("pointercancel", handleMsgPointerUp);
}
function handleMsgPointerMove(e) {
  if (!activeMsgSwipe || e.pointerId !== activeMsgSwipe.pointerId || activeMsgSwipe.aborted) return;
  const dx = e.clientX - activeMsgSwipe.startX;
  const dy = e.clientY - activeMsgSwipe.startY;
  if (!activeMsgSwipe.lockedHoriz) {
    if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
      activeMsgSwipe.aborted = true;
      cleanupMsgPointerListeners();
      return;
    }
    if (dx > 8 && dx > Math.abs(dy) * 1.15) {
      activeMsgSwipe.lockedHoriz = true;
    } else if (dx < -14) {
      activeMsgSwipe.aborted = true;
      cleanupMsgPointerListeners();
      return;
    }
  }
  if (activeMsgSwipe.lockedHoriz) {
    if (e.cancelable) e.preventDefault();
    const clampedDx = Math.max(0, dx);
    activeMsgSwipe.rawDx = clampedDx;
    const damped = applySwipeResistance(clampedDx, SWIPE_THRESHOLD_PX2);
    activeMsgSwipe.fg.style.transform = `translate3d(${damped}px, 0, 0)`;
    const past = clampedDx >= SWIPE_THRESHOLD_PX2;
    if (activeMsgSwipe.bg) {
      activeMsgSwipe.bg.className = `swipe-bg px-4 flex items-center justify-start gap-2.5 rounded-2xl transition-colors duration-150 ${past ? "bg-forest text-white" : "bg-charcoal text-stone-200"}`;
    }
    if (activeMsgSwipe.icon) {
      activeMsgSwipe.icon.style.transform = `scale(${past ? 1.12 : 0.92})`;
    }
    if (activeMsgSwipe.label) {
      activeMsgSwipe.label.textContent = past ? "Release to reply" : "Swipe to reply";
    }
  }
}
function handleMsgPointerUp(e) {
  if (!activeMsgSwipe || e.pointerId !== activeMsgSwipe.pointerId) return;
  const { msgId, lockedHoriz, rawDx, fg } = activeMsgSwipe;
  cleanupMsgPointerListeners();
  activeMsgSwipe = null;
  if (!lockedHoriz || !fg) return;
  lastSwipeGestureTs2 = Date.now();
  const passedThreshold = rawDx >= SWIPE_THRESHOLD_PX2;
  fg.classList.add("swipe-snap");
  requestAnimationFrame(() => {
    fg.style.transform = "translate3d(0px, 0, 0)";
  });
  let finished = false;
  const onFinish = () => {
    if (finished) return;
    finished = true;
    fg.removeEventListener("transitionend", onFinish);
    fg.classList.remove("swipe-snap");
    if (passedThreshold) {
      startReplyToMessage(msgId);
    }
  };
  fg.addEventListener("transitionend", onFinish);
  setTimeout(onFinish, 290);
}
function cleanupMsgPointerListeners() {
  window.removeEventListener("pointermove", handleMsgPointerMove);
  window.removeEventListener("pointerup", handleMsgPointerUp);
  window.removeEventListener("pointercancel", handleMsgPointerUp);
}
function startReplyToMessage(msgId, e) {
  if (e) e.stopPropagation();
  const target = state.messages.find((m) => m.id === msgId);
  if (!target) return;
  state.composerDraft.reply_to = target.id;
  state.composerDraft.channel = target.channel;
  state.composerExpanded = true;
  if (window.renderMainViewport) window.renderMainViewport(true);
  setTimeout(() => {
    const ta = document.getElementById("compose-body");
    if (ta) {
      ta.focus();
      keepFieldAboveKeyboard(ta);
    }
  }, 40);
}
function cancelComposerReply() {
  state.composerDraft.reply_to = null;
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function scrollToQuotedMessage(targetId, e) {
  if (e) e.stopPropagation();
  const targetEl = document.getElementById(`msg-card-${targetId}`);
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    targetEl.classList.remove("highlight-pulse");
    void targetEl.offsetWidth;
    targetEl.classList.add("highlight-pulse");
    return;
  }
  const msg = state.messages.find((m) => m.id === targetId);
  if (msg) {
    const rootId = getRootMessageId(msg);
    state.openThreadMsgId = rootId;
    if (window.renderMainViewport) window.renderMainViewport(false);
    setTimeout(() => {
      const el = document.getElementById(`msg-card-${targetId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("highlight-pulse");
      }
    }, 50);
  }
}
function expandComposer() {
  if (state.msgFilter.channel !== "ALL" && !state.composerDraft.reply_to) {
    state.composerDraft.channel = state.msgFilter.channel;
  }
  state.composerExpanded = true;
  if (window.renderMainViewport) window.renderMainViewport(true);
  setTimeout(() => {
    const ta = document.getElementById("compose-body");
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      keepFieldAboveKeyboard(ta);
    }
  }, 40);
}
function collapseComposer() {
  state.composerExpanded = false;
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function updateComposerDraft(field, value) {
  state.composerDraft[field] = value;
}
function setMsgFilter(key, val) {
  state.msgFilter[key] = val;
  if (key === "channel" && val !== "ALL") {
    state.composerDraft.channel = val;
  }
  if (window.renderMainViewport) window.renderMainViewport(true);
  if (key === "q") {
    const input2 = document.getElementById("msg-search-input");
    if (input2) {
      input2.focus();
      input2.setSelectionRange(val.length, val.length);
    }
  }
}
var win7 = window;
win7.openMessageThread = openMessageThread;
win7.openMessageThreadIfNotSwiped = openMessageThreadIfNotSwiped;
win7.closeMessageThread = closeMessageThread;
win7.handleMsgPointerDown = handleMsgPointerDown;
win7.handleMsgPointerMove = handleMsgPointerMove;
win7.handleMsgPointerUp = handleMsgPointerUp;
win7.startReplyToMessage = startReplyToMessage;
win7.cancelComposerReply = cancelComposerReply;
win7.scrollToQuotedMessage = scrollToQuotedMessage;
win7.expandComposer = expandComposer;
win7.collapseComposer = collapseComposer;
win7.updateComposerDraft = updateComposerDraft;
win7.setMsgFilter = setMsgFilter;

// src-frontend/js/views/feed-actions.ts
async function sendOperatorMessage(e) {
  if (e && e.preventDefault) e.preventDefault();
  const channelEl = document.getElementById("compose-channel");
  const priorityEl = document.getElementById("compose-priority");
  const audienceEl = document.getElementById("compose-audience");
  const bodyInput = document.getElementById("compose-body");
  const channel = channelEl ? channelEl.value : state.composerDraft.channel;
  const priority = priorityEl ? priorityEl.value : state.composerDraft.priority;
  const audience = audienceEl ? audienceEl.value : state.composerDraft.audience;
  const body = bodyInput ? bodyInput.value.trim() : (state.composerDraft.body || "").trim();
  if (!body) {
    showToast("Cannot send empty message", "Please write something first", "red");
    if (bodyInput) bodyInput.focus();
    return;
  }
  const replyTo = state.composerDraft.reply_to || null;
  let newId = null;
  try {
    const res = await api.post("/admin/api/send", { channel, body, priority, audience, reply_to: replyTo });
    newId = res.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast("Send failed", msg, "red");
    return;
  }
  state.messages.push({
    id: newId,
    sender: "luki",
    channel,
    priority,
    audience,
    reply_to: replyTo,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    body,
    edited: false
  });
  if (!state.channels.includes(channel)) state.channels.push(channel);
  state.composerDraft = {
    channel,
    priority,
    audience,
    body: "",
    reply_to: null
  };
  state.composerExpanded = false;
  showToast(
    replyTo ? "Reply sent" : "Message sent",
    `Posted in #${channel} (${PRIORITY_LABELS[priority] || priority} \u2022 ${AUDIENCE_LABELS[audience] || audience})`,
    "green"
  );
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}
function openEditMessageModal(msgId) {
  const msg = state.messages.find((m) => m.id === msgId);
  if (!msg) return;
  showCustomModal(`
    <form onsubmit="executeEditMessage(event, ${msg.id})" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">Edit Post</div>
          <h3 class="font-serif font-bold text-lg text-ink">Message by @${escapeHtml(msg.sender)}</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>
      <textarea id="edit-msg-body" rows="4" required class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none">${escapeHtml(msg.body)}</textarea>
      <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
        Save Changes
      </button>
    </form>
  `);
}
async function executeEditMessage(e, msgId) {
  e.preventDefault();
  const msg = state.messages.find((m) => m.id === msgId);
  if (!msg) return;
  const input2 = document.getElementById("edit-msg-body");
  const newBody = input2 ? input2.value.trim() : "";
  try {
    await api.put(`/admin/api/messages/${msgId}`, { body: newBody });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Edit failed", errorMsg, "red");
    return;
  }
  msg.body = newBody;
  msg.edited = true;
  closeTopModal();
  showToast("Message updated");
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function confirmDeleteMessage(msgId) {
  const msg = state.messages.find((m) => m.id === msgId);
  if (!msg) return;
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="font-mono text-xs font-bold uppercase text-vermilion">Delete Message</div>
      <h3 class="font-serif font-bold text-lg text-ink">Remove this post from #${escapeHtml(msg.channel)}?</h3>
      <p class="text-sm text-muted bg-recessed p-3 rounded-xl">"${escapeHtml(msg.body)}"</p>
      <div class="flex gap-2">
        <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
        <button onclick="executeDeleteMessage(${msg.id})" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Delete</button>
      </div>
    </div>
  `);
}
async function executeDeleteMessage(msgId) {
  try {
    await api.del(`/admin/api/messages/${msgId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Delete failed", errorMsg, "red");
    return;
  }
  state.messages = state.messages.filter((m) => m.id !== msgId);
  if (state.openThreadMsgId === msgId) state.openThreadMsgId = null;
  closeTopModal();
  showToast("Message deleted");
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}
function openChannelMembersModal(channelName) {
  const members = getChannelMembers(channelName);
  const allAgentNames = state.agents.map((a) => a.agent);
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-forest">Channel Membership</div>
          <h3 class="font-serif font-bold text-lg text-ink">#${escapeHtml(channelName)} Members</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <p class="text-xs text-muted leading-relaxed">
        Add or remove agents on <strong class="text-ink">#${escapeHtml(channelName)}</strong>. Changes immediately emit <span class="font-mono">channel.member_added</span> or <span class="font-mono">channel.member_removed</span> on the bus.
      </p>

      <!-- Current Members List -->
      <div class="space-y-2">
        <div class="font-mono text-xs font-bold uppercase text-muted">
          Current Members (${members.length})
        </div>
        ${members.length === 0 ? `
          <div class="hw-inset rounded-xl p-3.5 text-center text-xs text-muted">
            No agents currently assigned to #${escapeHtml(channelName)}.
          </div>
        ` : members.map((ag) => {
    const st = getAgentStyle(ag);
    const agObj = state.agents.find((a) => a.agent === ag);
    return `
            <div class="hw-inset rounded-xl p-2.5 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="font-mono text-xs font-bold ${st.bg} ${st.text} border ${st.border} px-2.5 py-1 rounded-lg">
                  @${escapeHtml(ag)}
                </span>
                <span class="text-xs text-muted truncate">${escapeHtml(agObj ? agObj.role : "Registered Agent")}</span>
              </div>
              <button
                type="button"
                onclick="removeChannelMember('${escapeHtml(channelName)}', '${escapeHtml(ag)}')"
                class="hw-btn tap-44 px-3 rounded-xl bg-rose-100 text-vermilion font-mono text-xs font-bold flex items-center gap-1 shrink-0"
              >
                <i class="ph-bold ph-user-minus"></i>
                <span>Remove</span>
              </button>
            </div>
          `;
  }).join("")}
      </div>

      <!-- Available Agents to Add -->
      <div class="space-y-2 pt-2 border-t border-border">
        <div class="font-mono text-xs font-bold uppercase text-muted">
          Add Agent to #${escapeHtml(channelName)}
        </div>
        ${allAgentNames.filter((a) => !members.includes(a)).length === 0 ? `
          <div class="text-xs text-muted py-1">All registered agents are already members of this channel.</div>
        ` : `
          <div class="grid grid-cols-2 gap-2">
            ${allAgentNames.filter((a) => !members.includes(a)).map((ag) => `
              <button
                type="button"
                onclick="addChannelMember('${escapeHtml(channelName)}', '${escapeHtml(ag)}')"
                class="hw-btn tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <i class="ph-bold ph-user-plus"></i>
                <span>Add @${escapeHtml(ag)}</span>
              </button>
            `).join("")}
          </div>
        `}

        <!-- Custom Handle Add -->
        <form onsubmit="addCustomChannelMember(event, '${escapeHtml(channelName)}')" class="flex gap-2 pt-1">
          <input
            id="custom-channel-member-input"
            type="text"
            placeholder="Or enter agent handle..."
            class="tap-44 flex-1 hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none"
          />
          <button type="submit" class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-4 rounded-xl">
            Add
          </button>
        </form>
      </div>
    </div>
  `);
}
async function addChannelMember(channelName, agentName) {
  try {
    await api.post(`/admin/api/channels/${encodeURIComponent(channelName)}/members`, { agent: agentName });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Add member failed", errorMsg, "red");
    return;
  }
  const members = getChannelMembers(channelName);
  if (!members.includes(agentName)) {
    members.push(agentName);
    const ag = state.agents.find((a) => a.agent === agentName);
    if (ag && ag.channels && !ag.channels.includes(channelName)) {
      ag.channels.push(channelName);
    }
    showToast(`Added @${agentName}`, `Member of #${channelName}`, "green");
  }
  openChannelMembersModal(channelName);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function addCustomChannelMember(e, channelName) {
  e.preventDefault();
  const input2 = document.getElementById("custom-channel-member-input");
  const handle = input2 ? input2.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") : "";
  if (!handle) return;
  addChannelMember(channelName, handle);
}
async function removeChannelMember(channelName, agentName) {
  try {
    await api.del(`/admin/api/channels/${encodeURIComponent(channelName)}/members/${encodeURIComponent(agentName)}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Remove member failed", errorMsg, "red");
    return;
  }
  const members = getChannelMembers(channelName);
  state.channelMembers[channelName] = members.filter((m) => m !== agentName);
  const ag = state.agents.find((a) => a.agent === agentName);
  if (ag && ag.channels) {
    ag.channels = ag.channels.filter((c) => c !== channelName);
  }
  showToast(`Removed @${agentName}`, `Removed from #${channelName}`);
  openChannelMembersModal(channelName);
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function openCreateChannelModal() {
  showCustomModal(`
    <form onsubmit="executeCreateChannel(event)" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">New Channel</div>
          <h3 class="font-serif font-bold text-lg text-ink">Create or Open Channel</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <p class="text-sm text-muted leading-relaxed">
        Use lowercase letters, numbers, or hyphens (e.g. <strong class="text-ink">deploy-log</strong>), or open a direct message between two agents in alphabetical order (e.g. <strong class="text-ink">dm:nyx:wren</strong>).
      </p>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Channel Name</label>
        <input id="new-channel-name" type="text" required placeholder="e.g. deploy-log or dm:nyx:wren" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none" />
      </div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Opening Message</label>
        <input id="new-channel-seed" type="text" required value="Channel opened by luki." class="tap-44 w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none" />
      </div>

      <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
        Create Channel
      </button>
    </form>
  `);
}
async function executeCreateChannel(e) {
  e.preventDefault();
  const nameInput = document.getElementById("new-channel-name");
  const seedInput = document.getElementById("new-channel-seed");
  const name = nameInput ? nameInput.value.trim() : "";
  const seed = seedInput ? seedInput.value.trim() : "";
  if (name.startsWith("dm:")) {
    const parts = name.split(":");
    if (parts.length !== 3) {
      showToast("Invalid DM channel name", "Format must be dm:agentA:agentB", "red");
      return;
    }
    const [, a, b] = parts;
    if (!a || !b) {
      showToast("Invalid DM channel name", "Format must be dm:agentA:agentB", "red");
      return;
    }
    const regNames = state.agents.map((ag) => ag.agent);
    if (!regNames.includes(a) || !regNames.includes(b)) {
      showToast("Unknown agent in DM pair", "Both agents must be registered", "red");
      return;
    }
    if (a >= b) {
      showToast("Order agent names alphabetically", `Try dm:${[a, b].sort().join(":")}`, "red");
      return;
    }
  } else {
    const re = /^[a-z0-9][a-z0-9_-]{0,31}$/;
    if (!re.test(name)) {
      showToast("Invalid channel name", "Use lowercase letters, digits, hyphens, or underscores", "red");
      return;
    }
  }
  try {
    await api.post("/admin/api/channels", { name });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Create channel failed", errorMsg, "red");
    return;
  }
  if (!state.channels.includes(name)) {
    state.channels.push(name);
  }
  if (!state.channelMembers[name]) {
    state.channelMembers[name] = name.startsWith("dm:") ? name.split(":").slice(1) : state.agents.map((a) => a.agent);
  }
  if (seed) {
    try {
      await api.post("/admin/api/send", { channel: name, body: seed, priority: "normal", audience: "agents" });
      await refreshMessages();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast("Opening message failed", errorMsg, "red");
    }
  }
  state.msgFilter.channel = name;
  state.composerDraft.channel = name;
  closeTopModal();
  showToast(`Created #${name}`, seed ? "Opening message posted" : "", "green");
  if (window.renderMainViewport) window.renderMainViewport(true);
}
function confirmDeleteChannel(channelName) {
  const count = state.messages.filter((m) => m.channel === channelName).length;
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="font-mono text-xs font-bold uppercase text-vermilion">Delete Channel</div>
      <h3 class="font-serif font-bold text-lg text-ink">Delete #${escapeHtml(channelName)}?</h3>
      <p class="text-sm text-muted">
        This removes the channel and all <strong>${count} messages</strong> inside it.
      </p>
      <div class="flex gap-2">
        <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
        <button onclick="executeDeleteChannel('${escapeHtml(channelName)}')" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Delete Channel</button>
      </div>
    </div>
  `);
}
async function executeDeleteChannel(channelName) {
  try {
    await api.del(`/admin/api/channels/${encodeURIComponent(channelName)}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast("Delete failed", errorMsg, "red");
    return;
  }
  state.channels = state.channels.filter((c) => c !== channelName);
  delete state.channelMembers[channelName];
  state.messages = state.messages.filter((m) => m.channel !== channelName);
  state.msgFilter.channel = "ALL";
  state.composerDraft.channel = "all-agent";
  closeTopModal();
  showToast(`Deleted #${channelName}`);
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}
var win8 = window;
win8.sendOperatorMessage = sendOperatorMessage;
win8.openEditMessageModal = openEditMessageModal;
win8.executeEditMessage = executeEditMessage;
win8.confirmDeleteMessage = confirmDeleteMessage;
win8.executeDeleteMessage = executeDeleteMessage;
win8.openChannelMembersModal = openChannelMembersModal;
win8.addChannelMember = addChannelMember;
win8.addCustomChannelMember = addCustomChannelMember;
win8.removeChannelMember = removeChannelMember;
win8.openCreateChannelModal = openCreateChannelModal;
win8.executeCreateChannel = executeCreateChannel;
win8.confirmDeleteChannel = confirmDeleteChannel;
win8.executeDeleteChannel = executeDeleteChannel;

// src-frontend/js/views/agents.tsx
function renderAgentsView() {
  const html2 = /* @__PURE__ */ jsxDEV("div", { class: "p-3.5 space-y-3.5", children: [
    /* @__PURE__ */ jsxDEV("div", { class: "hw-card rounded-2xl p-3.5 bg-card flex items-center justify-between gap-2", children: [
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("div", { class: "font-mono text-xs font-bold uppercase text-muted", children: "Connected Crew" }),
        /* @__PURE__ */ jsxDEV("h1", { class: "font-serif text-xl font-bold text-ink", children: [
          "Agents (",
          state.agents.length,
          ")"
        ] }),
        /* @__PURE__ */ jsxDEV("p", { class: "text-xs text-muted mt-0.5", children: "Manage agent credentials, live connection modes, and rate quotas." })
      ] }),
      /* @__PURE__ */ jsxDEV("button", { onclick: "openRegisterAgentModal()", class: "hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-3.5 rounded-xl shrink-0 flex items-center gap-1.5", children: [
        /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-plus-bold" }),
        /* @__PURE__ */ jsxDEV("span", { children: "Register" })
      ] })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "hw-card rounded-2xl p-3 bg-card flex items-center justify-between gap-2", children: [
      /* @__PURE__ */ jsxDEV("button", { onclick: "pollOnce().then(() => openUnifiedPollSheet())", class: "hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5", children: [
        /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-lightning text-sm" }),
        /* @__PURE__ */ jsxDEV("span", { children: "Simulate Agent Activity" })
      ] }),
      /* @__PURE__ */ jsxDEV("button", { onclick: "openUnifiedPollSheet()", class: "hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold px-3.5 rounded-xl flex items-center justify-center gap-1.5", children: [
        /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-broadcast text-sm" }),
        /* @__PURE__ */ jsxDEV("span", { children: [
          "Event Log (",
          state.pollEvents.length,
          ")"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxDEV("div", { class: "space-y-3", children: state.agents.map((ag) => {
      const st = getAgentStyle(ag.agent);
      const pct = Math.min(100, Math.round(ag.rate.used / ag.rate.limit * 100));
      const isHighRate = pct >= 85;
      const isLiveWs = ag.transport === "ws";
      const windowLabel = ag.rate.windowSec === 3600 ? "Hourly quota" : "Per-minute quota";
      return /* @__PURE__ */ jsxDEV("div", { class: "hw-card rounded-2xl p-3.5 bg-card space-y-3", children: [
        /* @__PURE__ */ jsxDEV("div", { class: "flex items-start justify-between gap-2", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-2.5", children: [
            /* @__PURE__ */ jsxDEV("div", { class: `w-11 h-11 rounded-xl ${st.bg} border-1.5 ${st.border} flex items-center justify-center font-mono font-bold text-base ${st.text}`, children: ag.agent.slice(0, 2).toUpperCase() }),
            /* @__PURE__ */ jsxDEV("div", { children: [
              /* @__PURE__ */ jsxDEV("div", { class: "flex items-center gap-1.5 flex-wrap", children: [
                /* @__PURE__ */ jsxDEV("span", { class: "font-mono text-base font-bold text-ink", children: [
                  "@",
                  ag.agent
                ] }),
                /* @__PURE__ */ jsxDEV("span", { class: `font-mono text-[11px] px-2 py-0.5 rounded-md font-bold flex items-center gap-1 ${isLiveWs ? "bg-emerald-100 text-emerald-950 border border-emerald-700" : "bg-amber-100 text-amber-950 border border-amber-700"}`, children: [
                  /* @__PURE__ */ jsxDEV("span", { class: `w-1.5 h-1.5 rounded-full ${isLiveWs ? "bg-emerald-600 led-blink" : "bg-amber-600"}` }),
                  isLiveWs ? "Live Socket" : "Polling"
                ] })
              ] }),
              /* @__PURE__ */ jsxDEV("div", { class: "text-xs text-muted mt-0.5", children: ag.role || "Autonomous Agent" })
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("button", { onclick: `toggleAgentTransport('${escapeHtml(ag.agent)}')`, class: "tap-44 px-2.5 rounded-xl bg-recessed border border-border font-mono text-xs font-bold text-ink", children: "Switch mode" })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "hw-inset rounded-xl p-3 space-y-1.5", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex items-center justify-between font-mono text-xs", children: [
            /* @__PURE__ */ jsxDEV("span", { class: "text-muted font-semibold", children: windowLabel }),
            /* @__PURE__ */ jsxDEV("span", { class: `font-bold ${isHighRate ? "text-ochre" : "text-ink"}`, children: [
              ag.rate.used,
              " of ",
              ag.rate.limit,
              " sends used"
            ] })
          ] }),
          /* @__PURE__ */ jsxDEV("div", { class: "w-full h-2.5 bg-paper rounded-full overflow-hidden border border-border", children: /* @__PURE__ */ jsxDEV("div", { class: `h-full transition-all duration-300 ${isHighRate ? "bg-ochre" : "bg-forest"}`, style: `width: ${pct}%` }) })
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "space-y-1 font-mono text-xs text-muted", children: [
          /* @__PURE__ */ jsxDEV("div", { class: "flex justify-between", children: [
            /* @__PURE__ */ jsxDEV("span", { children: [
              "Registered: ",
              /* @__PURE__ */ jsxDEV("strong", { class: "text-ink", children: (ag.created || "").slice(0, 10) || "\u2014" })
            ] }),
            /* @__PURE__ */ jsxDEV("span", { children: [
              "Last active: ",
              /* @__PURE__ */ jsxDEV("strong", { class: "text-ink", children: formatRelIso(ag.last_seen) })
            ] })
          ] }),
          isLiveWs && ag.channels ? /* @__PURE__ */ jsxDEV("div", { class: "pt-1.5 flex items-center gap-1.5 flex-wrap", children: [
            /* @__PURE__ */ jsxDEV("span", { children: "Listening:" }),
            ag.channels.map((c) => /* @__PURE__ */ jsxDEV("span", { class: "bg-recessed text-ink px-2 py-0.5 rounded border border-border", children: [
              "#",
              c
            ] }, c))
          ] }) : null
        ] }),
        /* @__PURE__ */ jsxDEV("div", { class: "pt-1 flex items-center gap-2", children: [
          /* @__PURE__ */ jsxDEV("button", { onclick: `rotateAgentToken('${escapeHtml(ag.agent)}')`, class: "hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5", children: [
            /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-key text-base" }),
            /* @__PURE__ */ jsxDEV("span", { children: "Rotate Secret" })
          ] }),
          /* @__PURE__ */ jsxDEV("button", { onclick: `confirmRevokeAgent('${escapeHtml(ag.agent)}')`, class: "hw-btn tap-44 bg-recessed hover:bg-vermilion hover:text-white text-ink font-mono text-xs font-bold px-3.5 rounded-xl flex items-center justify-center gap-1.5 transition", children: [
            /* @__PURE__ */ jsxDEV("i", { class: "ph-bold ph-prohibit text-base" }),
            /* @__PURE__ */ jsxDEV("span", { children: "Revoke" })
          ] })
        ] })
      ] }, ag.agent);
    }) })
  ] });
  return String(html2);
}
function generateHexToken(len = 48) {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
function openRegisterAgentModal() {
  showCustomModal(`
    <form onsubmit="executeRegisterAgent(event)" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">New Crew Member</div>
          <h3 class="font-serif font-bold text-lg text-ink">Register Agent</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <p class="text-sm text-muted">
        Choose a lowercase handle (letters, numbers, hyphens). You will receive a one-time secret token for the agent.
      </p>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Agent Handle</label>
        <input id="reg-agent-name" type="text" required placeholder="e.g. kestral-02" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none" />
      </div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Role Description</label>
        <input id="reg-agent-role" type="text" placeholder="e.g. Telemetry & Alerting Worker" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none" />
      </div>

      <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
        Register &amp; Generate Secret
      </button>
    </form>
  `);
}
async function executeRegisterAgent(e) {
  e.preventDefault();
  const nameInput = document.getElementById("reg-agent-name");
  const roleInput = document.getElementById("reg-agent-role");
  const name = nameInput ? nameInput.value.trim() : "";
  const role = roleInput ? roleInput.value.trim() : "";
  const re = /^[a-z0-9][a-z0-9_-]{0,31}$/;
  if (!re.test(name)) {
    showToast("Invalid agent handle", "Use lowercase letters, numbers, hyphens, or underscores", "red");
    return;
  }
  if (state.agents.some((a) => a.agent === name)) {
    showToast("Agent already registered", `@${name} is already on the bus`, "red");
    return;
  }
  let token = null;
  try {
    const _r = await api.post("/admin/api/agents", { agent: name, role: role || void 0 });
    token = _r.token || _r.secret || null;
  } catch (_e) {
    const errorMsg = _e instanceof Error ? _e.message : String(_e);
    showToast("Registration failed", errorMsg, "red");
    return;
  }
  await loadAll();
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
  if (token) showOneTimeTokenModal(name, token, "REGISTERED");
  else showToast(`Registered @${name}`, "", "green");
}
async function rotateAgentToken(agentName) {
  let _tok = null;
  try {
    const _r = await api.post("/admin/api/agents/" + encodeURIComponent(agentName) + "/rotate");
    _tok = _r.token || _r.secret || null;
  } catch (_e) {
    const errorMsg = _e instanceof Error ? _e.message : String(_e);
    showToast("Rotate failed", errorMsg, "red");
    return;
  }
  if (window.renderMainViewport) window.renderMainViewport(true);
  if (_tok) showOneTimeTokenModal(agentName, _tok, "ROTATED");
  else showToast("Rotated @" + agentName, "", "green");
}
function showOneTimeTokenModal(agentName, token, mode) {
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="caution-stripe-amber border-2 border-ink rounded-xl p-3.5">
        <div class="font-mono text-xs font-bold uppercase text-amber-950">
          ${mode === "ROTATED" ? "Secret Rotated" : "Agent Registered"}
        </div>
        <div class="font-serif font-bold text-base text-ink mt-0.5">
          One-Time Secret for @${escapeHtml(agentName)}
        </div>
        <p class="text-xs text-amber-950 mt-0.5">
          Copy this secret now. For security, it is only shown once.
        </p>
      </div>

      <div class="hw-inset rounded-xl p-3.5 font-mono text-sm break-all select-all text-ink border-2 border-ink" id="secret-token-box">${token}</div>

      <div class="flex gap-2">
        <button onclick="copyTokenText('${token}')" class="hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold py-3 rounded-xl flex items-center justify-center gap-1.5">
          <i class="ph-bold ph-copy text-base"></i>
          <span>Copy Secret</span>
        </button>
        <button onclick="closeTopModal()" class="hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold py-3 px-4 rounded-xl">
          Close
        </button>
      </div>
    </div>
  `);
}
function confirmRevokeAgent(agentName) {
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="font-mono text-xs font-bold uppercase text-vermilion">Revoke Access</div>
      <h3 class="font-serif font-bold text-lg text-ink">Revoke @${escapeHtml(agentName)}?</h3>
      <p class="text-sm text-muted">
        Their secret token stops working immediately. Past messages from <strong>@${escapeHtml(agentName)}</strong> stay in the feed.
      </p>
      <div class="flex gap-2">
        <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
        <button onclick="executeRevokeAgent('${escapeHtml(agentName)}')" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Revoke Agent</button>
      </div>
    </div>
  `);
}
async function executeRevokeAgent(agentName) {
  try {
    await api.del("/admin/api/agents/" + encodeURIComponent(agentName));
  } catch (_e) {
    const errorMsg = _e instanceof Error ? _e.message : String(_e);
    showToast("Revoke failed", errorMsg, "red");
    return;
  }
  state.agents = state.agents.filter((a) => a.agent !== agentName);
  Object.keys(state.channelMembers).forEach((ch) => {
    const mems = state.channelMembers[ch];
    if (mems) {
      state.channelMembers[ch] = mems.filter((m) => m !== agentName);
    }
  });
  closeTopModal();
  showToast(`Revoked @${agentName}`, "Credentials deactivated");
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}
function toggleAgentTransport(agentName) {
  const ag = state.agents.find((a) => a.agent === agentName);
  if (!ag) return;
  setNowEpoch(NOW_EPOCH + 1);
  ag.transport = ag.transport === "ws" ? "poll" : "ws";
  ag.last_seen = nowIso();
  showToast(`@${agentName} \u2192 ${ag.transport === "ws" ? "Live Socket" : "Polling"}`);
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}
var win9 = window;
win9.openRegisterAgentModal = openRegisterAgentModal;
win9.executeRegisterAgent = executeRegisterAgent;
win9.rotateAgentToken = rotateAgentToken;
win9.confirmRevokeAgent = confirmRevokeAgent;
win9.executeRevokeAgent = executeRevokeAgent;
win9.toggleAgentTransport = toggleAgentTransport;
win9.copyTokenText = copyTokenText;

// src-frontend/js/app.ts
function initTheme() {
  try {
    const saved = localStorage.getItem("bus_op01_theme");
    state.darkMode = saved === "dark";
  } catch (_e) {
    state.darkMode = false;
  }
  applyThemeClass();
}
function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  try {
    localStorage.setItem("bus_op01_theme", state.darkMode ? "dark" : "light");
  } catch (_e) {
  }
  applyThemeClass();
}
function applyThemeClass() {
  const root = document.documentElement;
  if (state.darkMode) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  const icon = document.getElementById("theme-toggle-icon");
  const label = document.getElementById("theme-toggle-label");
  if (icon && label) {
    if (state.darkMode) {
      icon.className = "ph-bold ph-sun-dim text-lg text-amber-400";
      label.textContent = "Light";
    } else {
      icon.className = "ph-bold ph-moon text-lg";
      label.textContent = "Dark";
    }
  }
}
function switchMainTab(tab) {
  const changed = state.activeTab !== tab;
  state.activeTab = tab;
  if (tab !== "messages") {
    state.openThreadMsgId = null;
  }
  renderNavState();
  renderMainViewport(!changed);
  if (changed) {
    const vp = document.getElementById("main-viewport");
    if (vp) vp.scrollTop = 0;
  }
}
function renderNavState() {
  const tabs = ["messages", "needs-you", "kanban", "agents"];
  tabs.forEach((t) => {
    const btn = document.getElementById(`nav-${t}`);
    if (!btn) return;
    if (state.activeTab === t) {
      btn.className = "tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition bg-ink text-paper shadow-[0_2px_0_#161615]";
    } else {
      btn.className = "tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition text-muted hover:text-ink";
    }
  });
  updateHeaderTelemetry();
}
function renderMainViewport(preserveScroll = true) {
  const vp = document.getElementById("main-viewport");
  if (!vp) return;
  const prevTop = preserveScroll ? vp.scrollTop : 0;
  if (preserveScroll) {
    vp.querySelectorAll("[data-scroll-id]").forEach((el) => {
      const scrollId = el.getAttribute("data-scroll-id");
      if (scrollId) {
        horizScrolls[scrollId] = {
          left: el.scrollLeft,
          top: el.scrollTop
        };
      }
    });
  }
  const bannerHtml = renderResyncBanner();
  if (state.activeTab === "needs-you") {
    vp.innerHTML = bannerHtml + renderNeedsYouView();
  } else if (state.activeTab === "kanban") {
    vp.innerHTML = bannerHtml + renderKanbanView();
  } else if (state.activeTab === "messages") {
    vp.innerHTML = bannerHtml + renderMessagesView();
  } else if (state.activeTab === "agents") {
    vp.innerHTML = bannerHtml + renderAgentsView();
  }
  if (preserveScroll) {
    vp.scrollTop = prevTop;
    vp.querySelectorAll("[data-scroll-id]").forEach((el) => {
      const scrollId = el.getAttribute("data-scroll-id");
      if (scrollId) {
        const saved = horizScrolls[scrollId];
        if (saved) {
          el.scrollLeft = saved.left;
          el.scrollTop = saved.top;
        }
      }
    });
  }
}
setLoginSuccessHandler(async (user) => {
  await loadAll();
  state.adminUser = user;
  renderNavState();
  renderMainViewport(false);
  startPoller();
  showToast("Signed in", `Welcome back @${user}`, "green");
});
Object.assign(window, {
  busAuth,
  state,
  initTheme,
  toggleDarkMode,
  applyThemeClass,
  switchMainTab,
  renderNavState,
  renderMainViewport,
  showLogin,
  hideLogin,
  handleLogin,
  doSignOut,
  loadAll,
  refreshTasks,
  refreshMessages,
  loadTaskDetail,
  manualRefresh,
  updateHeaderTelemetry,
  startPoller,
  pollOnce,
  handlePollEvent,
  renderResyncBanner,
  resyncFromServer,
  showToast,
  showCustomModal,
  openModal,
  closeTopModal,
  openAdminModal,
  changeAdminPassword,
  exportBusDump,
  openUnifiedPollSheet,
  togglePollInspectorScope,
  openTaskDrawer,
  closeTaskDrawer,
  updateTaskDraftField,
  commitTaskDraftIfNeeded,
  renderTaskDrawer,
  keepFieldAboveKeyboard,
  copyTokenText,
  escapeHtml,
  renderNeedsYouView,
  renderKanbanView,
  scrollToKanbanColumn,
  applySwipeResistance,
  openTaskDrawerIfNotSwiped,
  handleKanbanDragStart,
  handleKanbanDragOver,
  handleKanbanDragLeave,
  handleKanbanDrop,
  handleTaskPointerDown,
  handleTaskPointerMove,
  handleTaskPointerUp,
  cleanupTaskPointerListeners,
  clearTaskSwipe,
  quickCompleteTask,
  quickCycleAssignee,
  selectProject,
  updateKanbanSearch,
  toggleKanbanFilterDrawer,
  setKanbanFilter,
  resetKanbanFilters,
  requestTaskStatusChange,
  openBlockedKindPicker,
  confirmSetTaskBlocked,
  quickUnblockAndReplyModal,
  executeQuickUnblock,
  manualAssignTask,
  updateTaskPriority,
  setTaskDueOffset,
  touchTaskActivity,
  clearTaskNotes,
  addTaskLabel,
  removeTaskLabel,
  toggleTodoItem,
  addTodoItem,
  deleteTodoItem,
  postTaskComment,
  confirmDeleteTask,
  executeDeleteTask,
  openCreateTaskModal,
  executeCreateTask,
  openProjectModal,
  saveProjectModal,
  deleteProject,
  renderMessagesView,
  openMessageThread,
  openMessageThreadIfNotSwiped,
  closeMessageThread,
  handleMsgPointerDown,
  handleMsgPointerMove,
  handleMsgPointerUp,
  cleanupMsgPointerListeners,
  startReplyToMessage,
  cancelComposerReply,
  scrollToQuotedMessage,
  expandComposer,
  collapseComposer,
  updateComposerDraft,
  setMsgFilter,
  sendOperatorMessage,
  openEditMessageModal,
  executeEditMessage,
  confirmDeleteMessage,
  executeDeleteMessage,
  openChannelMembersModal,
  addChannelMember,
  addCustomChannelMember,
  removeChannelMember,
  openCreateChannelModal,
  executeCreateChannel,
  confirmDeleteChannel,
  executeDeleteChannel,
  renderAgentsView,
  generateHexToken,
  openRegisterAgentModal,
  executeRegisterAgent,
  rotateAgentToken,
  confirmRevokeAgent,
  executeRevokeAgent,
  toggleAgentTransport
});
window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  if (busAuth.get()) {
    loadAll().then(() => {
      renderNavState();
      renderMainViewport(false);
      startPoller();
    }).catch(() => showLogin("Session expired \u2014 sign in again."));
  } else {
    showLogin();
  }
});
export {
  applyThemeClass,
  initTheme,
  renderMainViewport,
  renderNavState,
  switchMainTab,
  toggleDarkMode
};
