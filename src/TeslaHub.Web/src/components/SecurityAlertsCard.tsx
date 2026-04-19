import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../api/client';
import TeslaPairingWizard from './TeslaPairingWizard';
import TeslaDeveloperAppGuide from './TeslaDeveloperAppGuide';

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
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function SecurityAlertsCard() {
  const { t } = useTranslation();
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
      setFeedback({ ok: true, text: t('securityAlerts.feedback.connected') });
    } else if (tesla === 'missing_params') {
      setFeedback({ ok: false, text: t('securityAlerts.feedback.missingParams') });
    } else if (tesla === 'error') {
      const detail = params.get('detail');
      setFeedback({ ok: false, text: detail || t('securityAlerts.feedback.authError') });
    }
    params.delete('tesla');
    params.delete('detail');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
    window.history.replaceState({}, '', newUrl);
    queryClient.invalidateQueries({ queryKey: ['teslaOAuthStatus'] });
  }, [queryClient, t]);

  const loginMutation = useMutation({
    mutationFn: () => api<LoginPayload>('/tesla-oauth/login', { method: 'POST' }),
    onSuccess: (data) => {
      window.location.href = data.authorizeUrl;
    },
    onError: (error: Error) => {
      setFeedback({ ok: false, text: error.message || t('securityAlerts.feedback.loginError') });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => api('/tesla-oauth/refresh', { method: 'POST' }),
    onSuccess: () => {
      setFeedback({ ok: true, text: t('securityAlerts.feedback.refreshed') });
      queryClient.invalidateQueries({ queryKey: ['teslaOAuthStatus'] });
    },
    onError: (error: Error) => {
      setFeedback({ ok: false, text: error.message || t('securityAlerts.feedback.refreshFailed') });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api('/tesla-oauth/disconnect', { method: 'POST' }),
    onSuccess: () => {
      setFeedback({ ok: true, text: t('securityAlerts.feedback.disconnected') });
      queryClient.invalidateQueries({ queryKey: ['teslaOAuthStatus'] });
    },
    onError: (error: Error) => {
      setFeedback({ ok: false, text: error.message || t('securityAlerts.feedback.disconnectFailed') });
    },
  });

  const expiresLabel = useMemo(() => {
    if (!status?.accessTokenExpiresAt) return null;
    const expiresAt = new Date(status.accessTokenExpiresAt).getTime();
    const diffMs = expiresAt - Date.now();
    if (diffMs <= 0) return t('securityAlerts.connectedPanel.expired');
    const minutes = Math.round(diffMs / 60_000);
    if (minutes < 60) {
      return t('securityAlerts.connectedPanel.expiresIn', {
        value: t('securityAlerts.connectedPanel.minutes', { count: minutes }),
      });
    }
    const hours = Math.round(minutes / 60);
    if (hours < 48) {
      return t('securityAlerts.connectedPanel.expiresIn', {
        value: t('securityAlerts.connectedPanel.hours', { count: hours }),
      });
    }
    const days = Math.round(hours / 24);
    return t('securityAlerts.connectedPanel.expiresIn', {
      value: t('securityAlerts.connectedPanel.days', { count: days }),
    });
  }, [status?.accessTokenExpiresAt, t]);

  if (isLoading) {
    return (
      <div className={cardClass}>
        <div className={sectionTitleClass}>{t('securityAlerts.title')}</div>
        <p className={subTextClass}>{t('securityAlerts.loading')}</p>
      </div>
    );
  }

  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;

  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={sectionTitleClass}>{t('securityAlerts.title')}</div>
          <p className={subTextClass}>
            {t('securityAlerts.subtitle')}{' '}
            <span className="text-[#9ca3af]">{t('securityAlerts.selfHostNote')}</span>
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
          {connected
            ? t('securityAlerts.statusConnected')
            : configured
              ? t('securityAlerts.statusNotConnected')
              : t('securityAlerts.statusNotConfigured')}
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
        <div className="space-y-3">
          <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-2 text-xs text-[#9ca3af]">
            <p>{t('securityAlerts.notConfigured.intro')}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <code className="text-[#e0e0e0]">TESLA_CLIENT_ID</code>
              </li>
              <li>
                <code className="text-[#e0e0e0]">TESLA_CLIENT_SECRET</code>
              </li>
              <li>
                <code className="text-[#e0e0e0]">TESLA_REDIRECT_URI</code>{' '}
                ({t('securityAlerts.notConfigured.redirectHint')}{' '}
                <code className="text-[#e0e0e0]">/api/tesla-oauth/callback</code>)
              </li>
            </ul>
            <p>
              <a
                className={linkClass}
                href="https://github.com/Olrik-WP/TeslaHub#security-alerts-optional"
                target="_blank"
                rel="noreferrer"
              >
                {t('securityAlerts.notConfigured.guideLink')}
              </a>{' '}
              {t('securityAlerts.notConfigured.guideHint')}
            </p>
            <p className="text-[#6b7280]">
              <Trans
                i18nKey="securityAlerts.creditPrefix"
                t={t}
                components={{ wrap: <span /> }}
              />{' '}
              <a className={linkClass} href="https://github.com/abarghoud/SentryGuard" target="_blank" rel="noreferrer">
                SentryGuard
              </a>{' '}
              {t('securityAlerts.creditSuffix')}
            </p>
          </div>

          <TeslaDeveloperAppGuide />
        </div>
      )}

      {configured && !connected && (
        <div className="space-y-3">
          <p className="text-xs text-[#9ca3af]">{t('securityAlerts.notConnected.intro')}</p>
          <button
            className={buttonPrimary}
            disabled={loginMutation.isPending}
            onClick={() => loginMutation.mutate()}
          >
            {loginMutation.isPending
              ? t('securityAlerts.notConnected.redirecting')
              : t('securityAlerts.notConnected.connect')}
          </button>
        </div>
      )}

      {connected && status && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className={sectionTitleClass}>{t('securityAlerts.connectedPanel.account')}</div>
              <div className="text-[#e0e0e0] mt-1 break-all">{status.fullName || status.email || '—'}</div>
              {status.email && status.fullName && (
                <div className={`${subTextClass} break-all`}>{status.email}</div>
              )}
            </div>
            <div>
              <div className={sectionTitleClass}>{t('securityAlerts.connectedPanel.vehicles')}</div>
              <div className="text-[#e0e0e0] mt-1">{status.vehicleCount}</div>
              <div className={subTextClass}>{t('securityAlerts.connectedPanel.vehiclesHint')}</div>
            </div>
            <div>
              <div className={sectionTitleClass}>{t('securityAlerts.connectedPanel.accessToken')}</div>
              <div className="text-[#e0e0e0] mt-1">{expiresLabel ?? '—'}</div>
              <div className={subTextClass}>{formatDateTime(status.accessTokenExpiresAt)}</div>
            </div>
            <div>
              <div className={sectionTitleClass}>{t('securityAlerts.connectedPanel.lastRefresh')}</div>
              <div className="text-[#e0e0e0] mt-1">{formatDateTime(status.lastRefreshAt)}</div>
              {status.refreshFailureCount > 0 && (
                <div className="text-[#f0a7a7]">
                  {t('securityAlerts.connectedPanel.failedAttempts', { count: status.refreshFailureCount })}
                </div>
              )}
            </div>
          </div>

          {status.lastRefreshError && (
            <div className="text-xs px-3 py-2 rounded bg-[#3d1a1a] text-[#f0a7a7] break-all">
              {t('securityAlerts.connectedPanel.lastError', { detail: status.lastRefreshError })}
            </div>
          )}

          {status.scopes.length > 0 && (
            <div>
              <div className={sectionTitleClass}>{t('securityAlerts.connectedPanel.scopes')}</div>
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
              {refreshMutation.isPending
                ? t('securityAlerts.connectedPanel.refreshing')
                : t('securityAlerts.connectedPanel.refresh')}
            </button>
            <button
              className={buttonSecondary}
              disabled={disconnectMutation.isPending}
              onClick={() => {
                if (window.confirm(t('securityAlerts.connectedPanel.confirmDisconnect'))) {
                  disconnectMutation.mutate();
                }
              }}
            >
              {disconnectMutation.isPending
                ? t('securityAlerts.connectedPanel.disconnecting')
                : t('securityAlerts.connectedPanel.disconnect')}
            </button>
          </div>

          <TeslaPairingWizard />
        </div>
      )}
    </div>
  );
}
