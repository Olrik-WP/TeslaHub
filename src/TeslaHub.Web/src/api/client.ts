import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  hasSession,
  isAccessTokenValid,
  isRefreshTokenValid,
  setSession,
} from './session';

const API_BASE = '/api';

type AuthExpiredHandler = () => void;
let onAuthExpired: AuthExpiredHandler | null = null;

export function setAuthExpiredHandler(handler: AuthExpiredHandler) {
  onAuthExpired = handler;
}

export function getStoredAccessToken(): string | null {
  return getAccessToken();
}

export function isAuthenticated(): boolean {
  // "Authenticated enough to render the app shell" — the actual API
  // calls will trigger a /refresh transparently if the access token is
  // expired. We only require a session record (with a refresh token or
  // a still-valid access token) to skip the redirect to /login.
  return isAccessTokenValid() || (hasSession() && isRefreshTokenValid());
}

// In-flight refresh promise: collapses concurrent 401s into a single
// /refresh call so we don't burn 5 refreshes when the dashboard fires
// 5 parallel queries on cold start.
let refreshInFlight: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshToken = getRefreshToken();
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          // Send the refresh token in the body so we still work in
          // iOS PWA standalone mode (cookies isolated from Safari) and
          // on HTTP deployments (Secure cookie dropped). The server
          // falls back to the cookie when the body is empty.
          body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        });

        if (res.status === 401) {
          // Server explicitly rejected the refresh token — it's gone /
          // expired / revoked. This is the only path that should
          // forcibly log the user out.
          clearSession();
          return false;
        }

        if (!res.ok) {
          // Any other status (5xx, 502 from Cloudflare while the
          // backend restarts, …) is treated as a transient failure.
          // We do NOT clear the session: the user stays logged in and
          // the next call will retry.
          return false;
        }

        const data = await res.json();
        if (!data?.accessToken) return false;

        setSession({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? null,
          expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 900,
          refreshExpiresInDays: typeof data.refreshExpiresInDays === 'number'
            ? data.refreshExpiresInDays
            : null,
        });
        return true;
      } catch {
        // Network error — backend unreachable, captive portal, airplane
        // mode toggling… do NOT log the user out. They'll get a normal
        // error from the failing API call instead.
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function tryInitialRefresh(): Promise<boolean> {
  // Fast path: token still valid client-side, no network needed. This
  // is what lets the iPhone home-screen icon open the app instantly
  // (and offline-tolerantly) for the duration of TESLAHUB_SESSION_DAYS.
  if (isAccessTokenValid()) return true;

  // Token expired / missing but we have something to refresh with —
  // either our own refresh token in localStorage or the HttpOnly
  // cookie. Try refresh; if it fails for network reasons we keep the
  // session record so a retry is possible.
  if (hasSession() && isRefreshTokenValid()) {
    const ok = await refreshOnce();
    if (ok) return true;
    // refreshOnce only clears the session on a real 401. If we got
    // here with a network error, hasSession() is still true → keep
    // user on the app (they may still see cached data, and the next
    // online request will retry).
    return isAuthenticated();
  }

  // No local session at all — but we might still have the HttpOnly
  // refresh cookie from a previous browser session (classic web flow).
  // One attempt; never log out on failure since the user is already
  // not logged in.
  return refreshOnce();
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  // Proactively refresh if the access token is about to expire. Avoids
  // the round-trip + retry on every other call once we cross the 15min
  // boundary mid-session.
  if (!isAccessTokenValid() && hasSession() && isRefreshTokenValid()) {
    await refreshOnce();
  }

  const doFetch = () => {
    const token = getAccessToken();
    return fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });
  };

  let res = await doFetch();

  if (res.status === 401) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      res = await doFetch();
      if (res.status !== 401) {
        if (!res.ok) throw new Error(await extractErrorMessage(res));
        return res.json();
      }
    }

    // Refresh failed AND we still get 401 — the session is genuinely
    // dead. Tell the app shell so it can redirect to /login. We only
    // clear the session here if refreshOnce did not already do it
    // (which it does on a real 401 from /refresh).
    if (refreshInFlight === null && hasSession() && !isAccessTokenValid() && !isRefreshTokenValid()) {
      clearSession();
    }

    if (onAuthExpired) {
      onAuthExpired();
    } else {
      window.location.href = '/login';
    }
    throw new Error('Session expired');
  }

  if (!res.ok) {
    throw new Error(await extractErrorMessage(res));
  }

  return res.json();
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') || contentType.includes('application/problem+json')) {
      const body = await res.json();
      const detail = typeof body?.detail === 'string' ? body.detail.trim() : '';
      const title = typeof body?.title === 'string' ? body.title.trim() : '';
      const error = typeof body?.error === 'string' ? body.error.trim() : '';
      if (detail && title) return `${title}: ${detail}`;
      if (detail) return detail;
      if (title) return title;
      if (error) return error;
    } else {
      const text = (await res.text()).trim();
      // Reject HTML responses (Cloudflare 502 / nginx upstream errors etc.)
      // — they would dump the entire HTML page into our toast banner
      // otherwise. Keep a short readable status line instead.
      const looksLikeHtml = contentType.includes('text/html')
        || /^\s*<!doctype/i.test(text)
        || /^\s*<html/i.test(text);
      if (text && !looksLikeHtml) return truncate(text, 240);
    }
  } catch {
    // ignore body parsing failures, fall back to status line
  }
  return `API error: ${res.status} ${res.statusText}`;
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : value.slice(0, max) + '…';
}

export async function login(username: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    if (res.status === 429) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail ?? 'Too many attempts. Try again later.');
    }
    throw new Error('Invalid credentials');
  }

  const data = await res.json();
  setSession({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? null,
    expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 900,
    refreshExpiresInDays: typeof data.refreshExpiresInDays === 'number'
      ? data.refreshExpiresInDays
      : null,
  });
  return data;
}

export async function logout() {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } finally {
    clearSession();
  }
}
