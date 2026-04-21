import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../api/client';
import TeslaPairingWizard from './TeslaPairingWizard';
import TeslaDeveloperAppGuide from './TeslaDeveloperAppGuide';

type TeslaAccountSummary = {
  id: number;
  email?: string | null;
  fullName?: string | null;
  connectedAt?: string | null;
  accessTokenExpiresAt?: string | null;
  lastRefreshAt?: string | null;
  refreshFailureCount: number;
  lastRefreshError?: string | null;
  vehicleCount: number;
};

type TeslaOAuthStatus = {
  configured: boolean;
  connected: boolean;
  // Legacy single-account fields — describe the most recently updated
  // account. Kept readable so older clients keep working.
  email?: string | null;
  fullName?: string | null;
  connectedAt?: string | null;
  accessTokenExpiresAt?: string | null;
  lastRefreshAt?: string | null;
  refreshFailureCount: number;
  lastRefreshError?: string | null;
  scopes: string[];
  vehicleCount: number;
  // New multi-account array. Present in all responses from current
  // TeslaHub builds; may be absent/empty on older backends (we fall
  // back to the legacy fields then).
  accounts?: TeslaAccountSummary[];
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

  // Multi-account: disconnect one specific Tesla identity without
  // touching the others. The backend exposes DELETE /accounts/{id}
  // which is paired by TeslaAccount.Id (not the Tesla user id).
  const disconnectOneMutation = useMutation({
    mutationFn: (accountId: number) =>
      api(`/tesla-oauth/accounts/${accountId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setFeedback({ ok: true, text: t('securityAlerts.feedback.disconnected') });
      queryClient.invalidateQueries({ queryKey: ['teslaOAuthStatus'] });
    },
    onError: (error: Error) => {
      setFeedback({ ok: false, text: error.message || t('securityAlerts.feedback.disconnectFailed') });
    },
  });

  // Humanised "expires in 42 min / 3 h / 5 d" helper. Reused for each
  // account in the connected list so the label reflects that specific
  // account's token lifetime.
  const expiresLabelFor = (at?: string | null): string | null => {
    if (!at) return null;
    const expiresAt = new Date(at).getTime();
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
  };

  // Build the list of accounts to render. Prefer the new `accounts`
  // array (multi-account backend); fall back to a one-element list
  // synthesised from the legacy top-level fields for compatibility.
  const accounts: TeslaAccountSummary[] = useMemo(() => {
    if (!status) return [];
    if (status.accounts && status.accounts.length > 0) return status.accounts;
    if (!status.connected) return [];
    return [{
      id: 0,
      email: status.email ?? null,
      fullName: status.fullName ?? null,
      connectedAt: status.connectedAt ?? null,
      accessTokenExpiresAt: status.accessTokenExpiresAt ?? null,
      lastRefreshAt: status.lastRefreshAt ?? null,
      refreshFailureCount: status.refreshFailureCount,
      lastRefreshError: status.lastRefreshError ?? null,
      vehicleCount: status.vehicleCount,
    }];
  }, [status]);

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

      <div className="bg-[#3a2a1a] border border-[#7a5a2a] rounded-lg p-3 space-y-2">
        <div className="flex items-start gap-2">
          <span className="text-[#e0a47e] text-base leading-none mt-0.5" aria-hidden="true">⚠️</span>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#e0a47e]">
              {t('securityAlerts.advancedWarning.title')}
            </p>
            <p className="text-xs text-[#c0a07e] leading-relaxed">
              {t('securityAlerts.advancedWarning.body')}
            </p>
            <a
              className="text-xs text-[#e0a47e] underline hover:text-[#ffc499] inline-block"
              href="https://github.com/Olrik-WP/TeslaHub#security-alerts-optional"
              target="_blank"
              rel="noreferrer"
            >
              {t('securityAlerts.advancedWarning.guideLabel')}
            </a>
          </div>
        </div>
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
          {/* One card per connected Tesla identity. Multi-account is the
              norm now (couples sharing one TeslaHub) so we render a list
              even for a single account to keep the UI consistent. */}
          <div className="space-y-3">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="border border-[#2a2a2a] rounded-lg p-3 space-y-3 bg-[#0f0f0f]"
              >
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className={sectionTitleClass}>{t('securityAlerts.connectedPanel.account')}</div>
                    {/* Tesla only returns email/profile claims when the
                        OAuth scope explicitly asks for them, which is not
                        the default in older TeslaHub installs. Fall back
                        to a stable label so multi-account UIs at least
                        distinguish the entries. */}
                    <div className="text-[#e0e0e0] mt-1 break-all">
                      {acc.fullName || acc.email || t('securityAlerts.connectedPanel.unnamedAccount', { id: acc.id || '?' })}
                    </div>
                    {acc.email && acc.fullName && (
                      <div className={`${subTextClass} break-all`}>{acc.email}</div>
                    )}
                  </div>
                  <div>
                    <div className={sectionTitleClass}>{t('securityAlerts.connectedPanel.vehicles')}</div>
                    <div className="text-[#e0e0e0] mt-1">{acc.vehicleCount}</div>
                    <div className={subTextClass}>{t('securityAlerts.connectedPanel.vehiclesHint')}</div>
                  </div>
                  <div>
                    <div className={sectionTitleClass}>{t('securityAlerts.connectedPanel.accessToken')}</div>
                    <div className="text-[#e0e0e0] mt-1">{expiresLabelFor(acc.accessTokenExpiresAt) ?? '—'}</div>
                    <div className={subTextClass}>{formatDateTime(acc.accessTokenExpiresAt)}</div>
                  </div>
                  <div>
                    <div className={sectionTitleClass}>{t('securityAlerts.connectedPanel.lastRefresh')}</div>
                    <div className="text-[#e0e0e0] mt-1">{formatDateTime(acc.lastRefreshAt)}</div>
                    {acc.refreshFailureCount > 0 && (
                      <div className="text-[#f0a7a7]">
                        {t('securityAlerts.connectedPanel.failedAttempts', { count: acc.refreshFailureCount })}
                      </div>
                    )}
                  </div>
                </div>

                {acc.lastRefreshError && (
                  <div className="text-xs px-3 py-2 rounded bg-[#3d1a1a] text-[#f0a7a7] break-all">
                    {t('securityAlerts.connectedPanel.lastError', { detail: acc.lastRefreshError })}
                  </div>
                )}

                {/* Per-account actions: refresh tokens / disconnect just
                    this identity. If the account comes from the legacy
                    fallback (id === 0) we use the old endpoints. */}
                <div className="flex flex-wrap gap-2">
                  <button
                    className={buttonSecondary}
                    disabled={refreshMutation.isPending}
                    onClick={() => refreshMutation.mutate()}
                    title={t('securityAlerts.connectedPanel.refreshHint')}
                  >
                    {refreshMutation.isPending
                      ? t('securityAlerts.connectedPanel.refreshing')
                      : t('securityAlerts.connectedPanel.refresh')}
                  </button>
                  <button
                    className={buttonSecondary}
                    disabled={disconnectMutation.isPending || disconnectOneMutation.isPending}
                    onClick={() => {
                      if (!window.confirm(t('securityAlerts.connectedPanel.confirmDisconnect'))) return;
                      if (acc.id === 0) disconnectMutation.mutate();
                      else disconnectOneMutation.mutate(acc.id);
                    }}
                  >
                    {(disconnectMutation.isPending || disconnectOneMutation.isPending)
                      ? t('securityAlerts.connectedPanel.disconnecting')
                      : t('securityAlerts.connectedPanel.disconnect')}
                  </button>
                </div>
              </div>
            ))}
          </div>

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

          {/* "Add another Tesla account" — typical use case: a couple
              sharing a TeslaHub instance where each spouse owns their
              own car. The OAuth flow opens Tesla auth in the current
              browser, which normally auto-uses whoever is logged in on
              the device (so this button is best tapped from the other
              spouse's phone). */}
          <div>
            <button
              className={buttonPrimary}
              disabled={loginMutation.isPending}
              onClick={() => loginMutation.mutate()}
            >
              {loginMutation.isPending
                ? t('securityAlerts.notConnected.redirecting')
                : t('securityAlerts.connectedPanel.addAccount')}
            </button>
            <p className={`${subTextClass} mt-1`}>
              {t('securityAlerts.connectedPanel.addAccountHint')}
            </p>
          </div>

          <TeslaPairingWizard />
        </div>
      )}
    </div>
  );
}
