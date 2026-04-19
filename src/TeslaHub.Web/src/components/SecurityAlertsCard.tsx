import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import TeslaPairingWizard from './TeslaPairingWizard';

type TeslaOAuthStatus = {
  configured: boolean;
  connected: boolean;
  email?: string | null;
  fullName?: string | null;
  connectedAt?: string | null;
  accessTokenExpiresAt?: string | null;
  lastRefreshAt?: string | null;
  refreshFailureCount: number;
  lastRefreshError?: string | null;
  scopes: string[];
  vehicleCount: number;
};

type LoginPayload = { authorizeUrl: string; state: string };

const cardClass = 'bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-4';
const sectionTitleClass = 'text-xs text-[#9ca3af] uppercase tracking-wider';
const subTextClass = 'text-xs text-[#6b7280]';
const buttonPrimary =
  'bg-[#e31937] text-white px-6 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f] disabled:opacity-50 disabled:cursor-not-allowed';
const buttonSecondary =
  'bg-[#2a2a2a] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#3a3a3a] disabled:opacity-50 disabled:cursor-not-allowed';
const linkClass = 'text-[#e31937] underline hover:text-[#ff4757]';

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  try {
    const date = new Date(value);
    return date.toLocaleString();
  } catch {
    return value;
  }
}

export default function SecurityAlertsCard() {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: status, isLoading } = useQuery<TeslaOAuthStatus>({
    queryKey: ['teslaOAuthStatus'],
    queryFn: () => api<TeslaOAuthStatus>('/tesla-oauth/status'),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tesla = params.get('tesla');
    if (!tesla) return;
    if (tesla === 'connected') {
      setFeedback({ ok: true, text: 'Tesla account connected successfully.' });
    } else if (tesla === 'missing_params') {
      setFeedback({ ok: false, text: 'Tesla returned an incomplete response. Please try again.' });
    } else if (tesla === 'error') {
      const detail = params.get('detail');
      setFeedback({ ok: false, text: detail || 'Tesla authentication failed.' });
    }
    params.delete('tesla');
    params.delete('detail');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
    window.history.replaceState({}, '', newUrl);
    queryClient.invalidateQueries({ queryKey: ['teslaOAuthStatus'] });
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: () => api<LoginPayload>('/tesla-oauth/login', { method: 'POST' }),
    onSuccess: (data) => {
      window.location.href = data.authorizeUrl;
    },
    onError: (error: Error) => {
      setFeedback({ ok: false, text: error.message || 'Could not start Tesla sign-in.' });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => api('/tesla-oauth/refresh', { method: 'POST' }),
    onSuccess: () => {
      setFeedback({ ok: true, text: 'Tesla tokens refreshed.' });
      queryClient.invalidateQueries({ queryKey: ['teslaOAuthStatus'] });
    },
    onError: (error: Error) => {
      setFeedback({ ok: false, text: error.message || 'Refresh failed.' });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api('/tesla-oauth/disconnect', { method: 'POST' }),
    onSuccess: () => {
      setFeedback({ ok: true, text: 'Tesla account disconnected.' });
      queryClient.invalidateQueries({ queryKey: ['teslaOAuthStatus'] });
    },
    onError: (error: Error) => {
      setFeedback({ ok: false, text: error.message || 'Disconnect failed.' });
    },
  });

  const expiresLabel = useMemo(() => {
    if (!status?.accessTokenExpiresAt) return null;
    const expiresAt = new Date(status.accessTokenExpiresAt).getTime();
    const diffMs = expiresAt - Date.now();
    if (diffMs <= 0) return 'expired';
    const minutes = Math.round(diffMs / 60_000);
    if (minutes < 60) return `expires in ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `expires in ${hours}h`;
    const days = Math.round(hours / 24);
    return `expires in ${days}d`;
  }, [status?.accessTokenExpiresAt]);

  if (isLoading) {
    return (
      <div className={cardClass}>
        <div className={sectionTitleClass}>Security Alerts</div>
        <p className={subTextClass}>Loading…</p>
      </div>
    );
  }

  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;

  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={sectionTitleClass}>Security Alerts</div>
          <p className={subTextClass}>
            Optional real-time Tesla Sentry & break-in notifications.{' '}
            <span className="text-[#9ca3af]">Powered by your own Tesla developer app — fully self-hosted.</span>
          </p>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider ${
            connected
              ? 'bg-[#1a3d1a] text-[#7ee07e]'
              : configured
                ? 'bg-[#3a2a1a] text-[#e0a47e]'
                : 'bg-[#2a2a2a] text-[#9ca3af]'
          }`}
        >
          {connected ? 'connected' : configured ? 'not connected' : 'not configured'}
        </span>
      </div>

      {feedback && (
        <div
          className={`text-xs px-3 py-2 rounded ${
            feedback.ok ? 'bg-[#1a3d1a] text-[#a7e9a7]' : 'bg-[#3d1a1a] text-[#f0a7a7]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {!configured && (
        <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-2 text-xs text-[#9ca3af]">
          <p>
            To enable real-time Tesla Sentry alerts, add a Tesla developer app and configure the following environment
            variables in your TeslaHub deployment:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <code className="text-[#e0e0e0]">TESLA_CLIENT_ID</code>
            </li>
            <li>
              <code className="text-[#e0e0e0]">TESLA_CLIENT_SECRET</code>
            </li>
            <li>
              <code className="text-[#e0e0e0]">TESLA_REDIRECT_URI</code> (must end with{' '}
              <code className="text-[#e0e0e0]">/api/tesla-oauth/callback</code>)
            </li>
          </ul>
          <p>
            See the{' '}
            <a
              className={linkClass}
              href="https://github.com/Olrik-WP/TeslaHub#security-alerts-optional"
              target="_blank"
              rel="noreferrer"
            >
              Security Alerts setup guide
            </a>{' '}
            in the TeslaHub README for the full step-by-step walkthrough.
          </p>
          <p className="text-[#6b7280]">
            Inspired by{' '}
            <a className={linkClass} href="https://github.com/abarghoud/SentryGuard" target="_blank" rel="noreferrer">
              SentryGuard
            </a>{' '}
            (AGPL-3.0). TeslaHub keeps everything self-hosted: no data ever leaves your server.
          </p>
        </div>
      )}

      {configured && !connected && (
        <div className="space-y-3">
          <p className="text-xs text-[#9ca3af]">
            Sign in with the Tesla account that owns the vehicles you want to monitor. Tokens are encrypted at rest with
            AES-GCM and never leave your TeslaHub instance.
          </p>
          <button
            className={buttonPrimary}
            disabled={loginMutation.isPending}
            onClick={() => loginMutation.mutate()}
          >
            {loginMutation.isPending ? 'Redirecting…' : 'Connect Tesla account'}
          </button>
        </div>
      )}

      {connected && status && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className={sectionTitleClass}>Account</div>
              <div className="text-[#e0e0e0] mt-1 break-all">{status.fullName || status.email || '—'}</div>
              {status.email && status.fullName && (
                <div className={`${subTextClass} break-all`}>{status.email}</div>
              )}
            </div>
            <div>
              <div className={sectionTitleClass}>Vehicles</div>
              <div className="text-[#e0e0e0] mt-1">{status.vehicleCount}</div>
              <div className={subTextClass}>discovered in next PR</div>
            </div>
            <div>
              <div className={sectionTitleClass}>Access token</div>
              <div className="text-[#e0e0e0] mt-1">{expiresLabel ?? '—'}</div>
              <div className={subTextClass}>{formatDateTime(status.accessTokenExpiresAt)}</div>
            </div>
            <div>
              <div className={sectionTitleClass}>Last refresh</div>
              <div className="text-[#e0e0e0] mt-1">{formatDateTime(status.lastRefreshAt)}</div>
              {status.refreshFailureCount > 0 && (
                <div className="text-[#f0a7a7]">{status.refreshFailureCount} failed attempt(s)</div>
              )}
            </div>
          </div>

          {status.lastRefreshError && (
            <div className="text-xs px-3 py-2 rounded bg-[#3d1a1a] text-[#f0a7a7] break-all">
              Last error: {status.lastRefreshError}
            </div>
          )}

          {status.scopes.length > 0 && (
            <div>
              <div className={sectionTitleClass}>Granted scopes</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {status.scopes.map((scope) => (
                  <span key={scope} className="text-[10px] bg-[#0a0a0a] text-[#9ca3af] px-2 py-0.5 rounded">
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              className={buttonSecondary}
              disabled={refreshMutation.isPending}
              onClick={() => refreshMutation.mutate()}
            >
              {refreshMutation.isPending ? 'Refreshing…' : 'Refresh tokens now'}
            </button>
            <button
              className={buttonSecondary}
              disabled={disconnectMutation.isPending}
              onClick={() => {
                if (window.confirm('Disconnect Tesla account? You will need to sign in again to receive alerts.')) {
                  disconnectMutation.mutate();
                }
              }}
            >
              {disconnectMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>

          <TeslaPairingWizard />
        </div>
      )}
    </div>
  );
}
