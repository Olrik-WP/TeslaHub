const API_BASE = '/api';

let accessToken: string | null = localStorage.getItem('teslahub_token');

export function setAccessToken(token: string) {
  accessToken = token;
  localStorage.setItem('teslahub_token', token);
}

export function clearTokens() {
  accessToken = null;
  localStorage.removeItem('teslahub_token');
}

export function isAuthenticated() {
  return !!accessToken;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) return false;

    const data = await res.json();
    setAccessToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

export async function tryInitialRefresh(): Promise<boolean> {
  if (accessToken) return true;
  return tryRefresh();
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options?.headers,
      },
    });

  let res = await doFetch();

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await doFetch();
    } else {
      clearTokens();
      window.location.href = '/login';
      throw new Error('Session expired');
    }
  }

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function login(username: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error('Too many attempts. Try again later.');
    throw new Error('Invalid credentials');
  }

  const data = await res.json();
  setAccessToken(data.accessToken);
  return data;
}

export async function logout() {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  clearTokens();
}
