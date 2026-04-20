import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../api/client';

type Subscription = {
  vehicleId: number;
  vin: string;
  displayName?: string | null;
  sentryAlerts: boolean;
  breakInAlerts: boolean;
};

type Recipient = {
  id: number;
  name: string;
  channelType: string;
  channelTarget: string;
  isActive: boolean;
  language: string;
  subscriptions: Subscription[];
};

type Vehicle = {
  id: number;
  vin: string;
  displayName?: string | null;
  keyPaired: boolean;
};

type AlertEvent = {
  id: number;
  vin: string;
  vehicleDisplayName?: string | null;
  alertType: string;
  detail?: string | null;
  detectedAt: string;
  recipientsNotified: number;
  recipientsFailed: number;
  failureReason?: string | null;
};

const sectionTitleClass = 'text-xs text-[#9ca3af] uppercase tracking-wider';
const subTextClass = 'text-xs text-[#6b7280]';
const cardClass = 'bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3';
const inputClass =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#e31937]';
const buttonPrimary =
  'bg-[#e31937] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f] disabled:opacity-50 disabled:cursor-not-allowed';
const buttonSecondary =
  'bg-[#2a2a2a] text-white px-3 py-1.5 rounded-lg text-xs font-medium min-h-[36px] active:bg-[#3a3a3a] disabled:opacity-50 disabled:cursor-not-allowed';

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function SecurityAlertRecipients({ vehicles }: { vehicles: Vehicle[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState({ name: '', channelTarget: '', language: 'en' });

  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: ['securityRecipients'],
    queryFn: () => api<Recipient[]>('/security-alerts/recipients'),
  });

  const { data: events = [] } = useQuery<AlertEvent[]>({
    queryKey: ['securityEvents'],
    queryFn: () => api<AlertEvent[]>('/security-alerts/events?limit=20'),
    refetchInterval: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api('/security-alerts/recipients', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          channelType: 'telegram',
          channelTarget: draft.channelTarget.trim(),
          isActive: true,
          language: draft.language,
        }),
      }),
    onSuccess: () => {
      setDraft({ name: '', channelTarget: '', language: 'en' });
      setFeedback({ ok: true, text: t('securityAlerts.recipients.feedback.added') });
      queryClient.invalidateQueries({ queryKey: ['securityRecipients'] });
    },
    onError: (err: Error) => setFeedback({ ok: false, text: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api(`/security-alerts/recipients/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['securityRecipients'] }),
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => api(`/security-alerts/recipients/${id}/test`, { method: 'POST' }),
    onSuccess: () => setFeedback({ ok: true, text: t('securityAlerts.recipients.feedback.testSent') }),
    onError: (err: Error) => setFeedback({ ok: false, text: err.message }),
  });

  const subscribeMutation = useMutation({
    mutationFn: (payload: { recipientId: number; vehicleId: number; sentryAlerts: boolean; breakInAlerts: boolean }) =>
      api(`/security-alerts/recipients/${payload.recipientId}/subscriptions`, {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: payload.vehicleId,
          sentryAlerts: payload.sentryAlerts,
          breakInAlerts: payload.breakInAlerts,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['securityRecipients'] }),
  });

  const unsubscribeMutation = useMutation({
    mutationFn: (payload: { recipientId: number; vehicleId: number }) =>
      api(`/security-alerts/recipients/${payload.recipientId}/subscriptions/${payload.vehicleId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['securityRecipients'] }),
  });

  const eligibleVehicles = vehicles.filter((v) => v.keyPaired);

  return (
    <div className="space-y-4 border-t border-[#2a2a2a] pt-4">
      <div>
        <div className={sectionTitleClass}>{t('securityAlerts.recipients.title')}</div>
        <p className={subTextClass}>{t('securityAlerts.recipients.intro')}</p>
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

      {/* Add recipient form */}
      <div className={cardClass}>
        <div className="text-sm text-[#e0e0e0]">{t('securityAlerts.recipients.addTitle')}</div>
        <div className="text-xs px-3 py-2 rounded bg-[#3a2a1a] text-[#e0c47e] border border-[#5a3a1a]">
          <Trans
            i18nKey="securityAlerts.recipients.startBotWarning"
            t={t}
            components={{ b: <strong /> }}
          />
        </div>
        <div className="grid sm:grid-cols-3 gap-2">
          <input
            className={inputClass}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t('securityAlerts.recipients.namePlaceholder')}
          />
          <input
            className={inputClass}
            value={draft.channelTarget}
            onChange={(e) => setDraft({ ...draft, channelTarget: e.target.value })}
            placeholder={t('securityAlerts.recipients.chatIdPlaceholder')}
          />
          <select
            className={inputClass}
            value={draft.language}
            onChange={(e) => setDraft({ ...draft, language: e.target.value })}
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
          </select>
        </div>
        <p className={subTextClass}>
          <Trans
            i18nKey="securityAlerts.recipients.chatIdHelp"
            t={t}
            components={{
              link: (
                <a
                  className="text-[#e31937] underline"
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noreferrer"
                >
                  @userinfobot
                </a>
              ),
              b: <strong />,
            }}
          />
        </p>
        <button
          className={buttonPrimary}
          disabled={createMutation.isPending || !draft.name.trim() || !draft.channelTarget.trim()}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending
            ? t('securityAlerts.recipients.adding')
            : t('securityAlerts.recipients.addButton')}
        </button>
      </div>

      {/* Recipient list with per-vehicle matrix */}
      {recipients.length > 0 && (
        <div className="space-y-3">
          {recipients.map((r) => (
            <div key={r.id} className={cardClass}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-[#e0e0e0] truncate">{r.name}</div>
                  <div className={`${subTextClass} truncate`}>
                    {t('securityAlerts.recipients.telegramTarget')}{' '}
                    <code className="text-[#9ca3af]">{r.channelTarget}</code>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    className={buttonSecondary}
                    disabled={testMutation.isPending}
                    onClick={() => testMutation.mutate(r.id)}
                  >
                    {t('securityAlerts.recipients.sendTest')}
                  </button>
                  <button
                    className={buttonSecondary}
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (window.confirm(t('securityAlerts.recipients.confirmRemove', { name: r.name }))) {
                        deleteMutation.mutate(r.id);
                      }
                    }}
                  >
                    {t('securityAlerts.recipients.remove')}
                  </button>
                </div>
              </div>

              {eligibleVehicles.length === 0 && (
                <p className={subTextClass}>{t('securityAlerts.recipients.needPairedVehicle')}</p>
              )}

              {eligibleVehicles.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-[#6b7280]">
                    <tr>
                      <th className="text-left font-normal py-1">{t('securityAlerts.recipients.matrixVehicle')}</th>
                      <th className="text-center font-normal py-1">{t('securityAlerts.recipients.matrixSentry')}</th>
                      <th className="text-center font-normal py-1">{t('securityAlerts.recipients.matrixBreakIn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleVehicles.map((v) => {
                      const sub = r.subscriptions.find((s) => s.vehicleId === v.id);
                      return (
                        <tr key={v.id} className="border-t border-[#2a2a2a]">
                          <td className="py-1 text-[#e0e0e0] truncate">
                            {v.displayName || v.vin}
                            <div className={subTextClass}>{v.vin}</div>
                          </td>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              checked={sub?.sentryAlerts ?? false}
                              onChange={(e) => {
                                const sentryAlerts = e.target.checked;
                                const breakInAlerts = sub?.breakInAlerts ?? true;
                                if (!sentryAlerts && !breakInAlerts) {
                                  unsubscribeMutation.mutate({ recipientId: r.id, vehicleId: v.id });
                                } else {
                                  subscribeMutation.mutate({
                                    recipientId: r.id,
                                    vehicleId: v.id,
                                    sentryAlerts,
                                    breakInAlerts,
                                  });
                                }
                              }}
                            />
                          </td>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              checked={sub?.breakInAlerts ?? false}
                              onChange={(e) => {
                                const breakInAlerts = e.target.checked;
                                const sentryAlerts = sub?.sentryAlerts ?? true;
                                if (!sentryAlerts && !breakInAlerts) {
                                  unsubscribeMutation.mutate({ recipientId: r.id, vehicleId: v.id });
                                } else {
                                  subscribeMutation.mutate({
                                    recipientId: r.id,
                                    vehicleId: v.id,
                                    sentryAlerts,
                                    breakInAlerts,
                                  });
                                }
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent alert history */}
      <div className={cardClass}>
        <div className="text-sm text-[#e0e0e0]">{t('securityAlerts.history.title')}</div>
        {events.length === 0 ? (
          <p className={subTextClass}>{t('securityAlerts.history.empty')}</p>
        ) : (
          <ul className="space-y-1">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider shrink-0 ${
                    e.alertType === 'SENTRY_ALERT'
                      ? 'bg-[#3d1a1a] text-[#f0a7a7]'
                      : 'bg-[#3a2a1a] text-[#e0a47e]'
                  }`}
                >
                  {e.alertType.replace(/_/g, ' ')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[#e0e0e0] truncate">
                    {e.vehicleDisplayName || e.vin} — {e.detail || '—'}
                  </div>
                  <div className={subTextClass}>
                    {formatDateTime(e.detectedAt)} ·{' '}
                    {t('securityAlerts.history.notified', { count: e.recipientsNotified })}
                    {e.recipientsFailed > 0
                      ? `, ${t('securityAlerts.history.failed', { count: e.recipientsFailed })}`
                      : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
