// Single source of truth for the TeslaHub admin/user session on the
// frontend. Tokens + their expiry are persisted to localStorage so the
// session survives:
//   * tab close / browser quit
//   * full PWA cold start from the iOS home-screen icon (where cookies
//     set in Safari are NOT visible to the standalone app, so we cannot
//     rely on the HttpOnly refresh cookie alone)
//   * HTTP-only deployments such as http://teslamate.tailf5c0e5.ts.net
//     where Secure cookies would be silently dropped by the browser.
//
// This module intentionally does NOT touch the Tesla Fleet / OAuth
// tokens — those live in the server-side encrypted store and are not
// our concern here.

const STORAGE_KEY = 'teslahub_session';

// Legacy key from before this refactor — read once during migration so
// existing logged-in users don't get bounced to /login on the first
// load of the new code.
const LEGACY_ACCESS_TOKEN_KEY = 'teslahub_token';

// Treat a token as "about to expire" this many milliseconds before its
// real exp claim. Keeps us from making authenticated calls with a token
// the API will reject by the time it arrives.
const EXPIRY_SKEW_MS = 30_000;

export interface PersistedSession {
  accessToken: string;
  refreshToken: string | null;
  // ms since epoch, in the client's clock
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number | null;
}

let cached: PersistedSession | null = loadFromStorage();

function loadFromStorage(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedSession>;
      if (typeof parsed.accessToken === 'string' && typeof parsed.accessTokenExpiresAt === 'number') {
        return {
          accessToken: parsed.accessToken,
          refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
          accessTokenExpiresAt: parsed.accessTokenExpiresAt,
          refreshTokenExpiresAt: typeof parsed.refreshTokenExpiresAt === 'number'
            ? parsed.refreshTokenExpiresAt
            : null,
        };
      }
    }

    // Migration path: the old code stored only the access token under
    // 'teslahub_token' with no expiry. Keep using it (treat as already
    // expired so we go through /refresh on the next call) and clean up
    // once the new session is established.
    const legacy = localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY);
    if (legacy) {
      return {
        accessToken: legacy,
        refreshToken: null,
        accessTokenExpiresAt: 0,
        refreshTokenExpiresAt: null,
      };
    }
  } catch {
    // localStorage may be unavailable in private mode — treat as no session.
  }
  return null;
}

function persist(session: PersistedSession | null) {
  cached = session;
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  } catch {
    // localStorage may be unavailable — keep the in-memory copy so the
    // current tab still works.
  }
}

export interface SessionUpdate {
  accessToken: string;
  refreshToken?: string | null;
  // seconds until the access token expires (server-provided)
  expiresIn: number;
  // days until the refresh token expires (server-provided)
  refreshExpiresInDays?: number | null;
}

export function setSession(update: SessionUpdate) {
  const now = Date.now();
  const previousRefreshToken = cached?.refreshToken ?? null;
  const previousRefreshExpiry = cached?.refreshTokenExpiresAt ?? null;

  const refreshToken = update.refreshToken !== undefined
    ? (update.refreshToken ?? previousRefreshToken)
    : previousRefreshToken;

  const refreshExpiresAt = update.refreshExpiresInDays != null
    ? now + update.refreshExpiresInDays * 24 * 60 * 60 * 1000
    : previousRefreshExpiry;

  persist({
    accessToken: update.accessToken,
    refreshToken,
    accessTokenExpiresAt: now + update.expiresIn * 1000,
    refreshTokenExpiresAt: refreshExpiresAt,
  });
}

export function clearSession() {
  persist(null);
}

export function getAccessToken(): string | null {
  return cached?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return cached?.refreshToken ?? null;
}

export function isAccessTokenValid(): boolean {
  if (!cached) return false;
  return cached.accessTokenExpiresAt - EXPIRY_SKEW_MS > Date.now();
}

export function isRefreshTokenValid(): boolean {
  if (!cached) return false;
  // refreshTokenExpiresAt = null is treated as "unknown but assume valid"
  // so we still attempt a refresh when migrating from the legacy storage
  // shape.
  if (cached.refreshTokenExpiresAt == null) return true;
  return cached.refreshTokenExpiresAt > Date.now();
}

export function hasSession(): boolean {
  return cached != null;
}
