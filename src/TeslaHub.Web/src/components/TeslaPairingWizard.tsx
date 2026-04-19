import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { api } from '../api/client';
import SecurityAlertRecipients from './SecurityAlertRecipients';

type TeslaVehicle = {
  id: number;
  vin: string;
  displayName?: string | null;
  model?: string | null;
  telemetryConfigured: boolean;
  keyPaired: boolean;
};

type TeslaPairingStatus = {
  keyGenerated: boolean;
  domain?: string | null;
  publicKeyUrl?: string | null;
  partnerRegistered: boolean;
  partnerRegisteredAt?: string | null;
  partnerRegistrationError?: string | null;
  pairingUrl?: string | null;
  vehicles: TeslaVehicle[];
};

const sectionTitleClass = 'text-xs text-[#9ca3af] uppercase tracking-wider';
const subTextClass = 'text-xs text-[#6b7280]';
const buttonPrimary =
  'bg-[#e31937] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f] disabled:opacity-50 disabled:cursor-not-allowed';
const buttonSecondary =
  'bg-[#2a2a2a] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#3a3a3a] disabled:opacity-50 disabled:cursor-not-allowed';
const inputClass =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#e31937]';
const codeBlockClass = 'bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs font-mono text-[#9ca3af] break-all';

function defaultDomainGuess(): string {
  if (typeof window === 'undefined') return '';
  return window.location.host;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider ${
        ok ? 'bg-[#1a3d1a] text-[#7ee07e]' : 'bg-[#3a2a1a] text-[#e0a47e]'
      }`}
    >
      {label}
    </span>
  );
}

export default function TeslaPairingWizard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState(defaultDomainGuess());
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const { data: status, isLoading } = useQuery<TeslaPairingStatus>({
    queryKey: ['teslaPairingStatus'],
    queryFn: () => api<TeslaPairingStatus>('/tesla-pairing/status'),
  });

  useEffect(() => {
    if (status?.domain && !domain) setDomain(status.domain);
  }, [status?.domain, domain]);

  useEffect(() => {
    const url = status?.pairingUrl;
    if (!url) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#e0e0e0', light: '#0a0a0a' } })
      .then((data) => setQrDataUrl(data))
      .catch(() => setQrDataUrl(null));
  }, [status?.pairingUrl]);

  const generateMutation = useMutation({
    mutationFn: () =>
      api('/tesla-pairing/keypair', { method: 'POST', body: JSON.stringify({ domain }) }),
    onSuccess: () => {
      setFeedback({ ok: true, text: t('securityAlerts.wizard.feedback.keyGenerated') });
      queryClient.invalidateQueries({ queryKey: ['teslaPairingStatus'] });
    },
    onError: (err: Error) => setFeedback({ ok: false, text: err.message || t('securityAlerts.wizard.feedback.keyError') }),
  });

  const registerMutation = useMutation({
    mutationFn: () => api('/tesla-pairing/register-partner', { method: 'POST' }),
    onSuccess: () => {
      setFeedback({ ok: true, text: t('securityAlerts.wizard.feedback.registered') });
      queryClient.invalidateQueries({ queryKey: ['teslaPairingStatus'] });
    },
    onError: (err: Error) => setFeedback({ ok: false, text: err.message || t('securityAlerts.wizard.feedback.registerError') }),
  });

  const syncMutation = useMutation({
    mutationFn: () => api<{ count: number }>('/tesla-pairing/sync-vehicles', { method: 'POST' }),
    onSuccess: (data) => {
      setFeedback({ ok: true, text: t('securityAlerts.wizard.feedback.synced', { count: data.count }) });
      queryClient.invalidateQueries({ queryKey: ['teslaPairingStatus'] });
    },
    onError: (err: Error) => setFeedback({ ok: false, text: err.message || t('securityAlerts.wizard.feedback.syncError') }),
  });

  const markPairedMutation = useMutation({
    mutationFn: ({ id, paired }: { id: number; paired: boolean }) =>
      api(`/tesla-pairing/vehicles/${id}/paired`, { method: 'POST', body: JSON.stringify({ paired }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teslaPairingStatus'] }),
  });

  const configureTelemetryMutation = useMutation({
    mutationFn: (vehicleIds: number[]) =>
      api('/tesla-pairing/configure-telemetry', { method: 'POST', body: JSON.stringify({ vehicleIds }) }),
    onSuccess: () => {
      setFeedback({ ok: true, text: t('securityAlerts.wizard.feedback.telemetryConfigured') });
      queryClient.invalidateQueries({ queryKey: ['teslaPairingStatus'] });
    },
    onError: (err: Error) => setFeedback({ ok: false, text: err.message || t('securityAlerts.wizard.feedback.telemetryError') }),
  });

  const publicKeyTestUrl = useMemo(() => status?.publicKeyUrl ?? null, [status?.publicKeyUrl]);

  if (isLoading) {
    return <p className={subTextClass}>{t('securityAlerts.loading')}</p>;
  }

  const keyGenerated = status?.keyGenerated ?? false;
  const partnerRegistered = status?.partnerRegistered ?? false;
  const vehicles = status?.vehicles ?? [];
  const labelDone = t('securityAlerts.wizard.common.done');
  const labelTodo = t('securityAlerts.wizard.common.todo');

  return (
    <div className="space-y-4">
      <div className="border-t border-[#2a2a2a] pt-4 space-y-1">
        <div className={sectionTitleClass}>{t('securityAlerts.wizard.title')}</div>
        <p className={subTextClass}>{t('securityAlerts.wizard.intro')}</p>
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

      {/* Step 1 — keypair generation */}
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-[#e0e0e0]">{t('securityAlerts.wizard.step1.title')}</div>
          <StatusPill ok={keyGenerated} label={keyGenerated ? labelDone : labelTodo} />
        </div>
        <p className={subTextClass}>{t('securityAlerts.wizard.step1.intro')}</p>
        <div className="space-y-2">
          <label className={sectionTitleClass}>{t('securityAlerts.wizard.step1.domainLabel')}</label>
          <input
            className={inputClass}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={t('securityAlerts.wizard.step1.domainPlaceholder')}
          />
          <p className={subTextClass}>{t('securityAlerts.wizard.step1.domainHint')}</p>
        </div>
        <button
          className={buttonPrimary}
          disabled={generateMutation.isPending || !domain.trim()}
          onClick={() => generateMutation.mutate()}
        >
          {generateMutation.isPending
            ? t('securityAlerts.wizard.step1.generating')
            : keyGenerated
              ? t('securityAlerts.wizard.step1.regenerate')
              : t('securityAlerts.wizard.step1.generate')}
        </button>

        {keyGenerated && publicKeyTestUrl && (
          <div className="space-y-1 pt-2">
            <div className={sectionTitleClass}>{t('securityAlerts.wizard.step1.publicKeyUrl')}</div>
            <div className={codeBlockClass}>{publicKeyTestUrl}</div>
            <p className={subTextClass}>{t('securityAlerts.wizard.step1.publicKeyTestHint')}</p>
            <a className="text-[#e31937] text-xs underline" href={publicKeyTestUrl} target="_blank" rel="noreferrer">
              {t('securityAlerts.wizard.step1.publicKeyTestLink')}
            </a>
          </div>
        )}
      </div>

      {/* Step 2 — partner registration */}
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-[#e0e0e0]">{t('securityAlerts.wizard.step2.title')}</div>
          <StatusPill ok={partnerRegistered} label={partnerRegistered ? labelDone : labelTodo} />
        </div>
        <p className={subTextClass}>{t('securityAlerts.wizard.step2.intro')}</p>
        <button
          className={buttonPrimary}
          disabled={registerMutation.isPending || !keyGenerated}
          onClick={() => registerMutation.mutate()}
        >
          {registerMutation.isPending
            ? t('securityAlerts.wizard.step2.registering')
            : partnerRegistered
              ? t('securityAlerts.wizard.step2.reregister')
              : t('securityAlerts.wizard.step2.register')}
        </button>
        {status?.partnerRegistrationError && (
          <div className="text-xs px-3 py-2 rounded bg-[#3d1a1a] text-[#f0a7a7] break-all">
            {status.partnerRegistrationError}
          </div>
        )}
      </div>

      {/* Step 3 — vehicles + pairing QR */}
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-[#e0e0e0]">{t('securityAlerts.wizard.step3.title')}</div>
          <button
            className={buttonSecondary}
            disabled={syncMutation.isPending || !partnerRegistered}
            onClick={() => syncMutation.mutate()}
          >
            {syncMutation.isPending ? t('securityAlerts.wizard.step3.syncing') : t('securityAlerts.wizard.step3.sync')}
          </button>
        </div>

        {status?.pairingUrl && (
          <div className="grid sm:grid-cols-[auto_1fr] gap-3 items-start">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="Tesla pairing QR code"
                className="w-[160px] h-[160px] rounded bg-[#0a0a0a] border border-[#2a2a2a]"
              />
            )}
            <div className="space-y-1">
              <p className="text-xs text-[#e0e0e0]">{t('securityAlerts.wizard.step3.qrIntro')}</p>
              <a
                className="text-[#e31937] text-xs underline break-all"
                href={status.pairingUrl}
                target="_blank"
                rel="noreferrer"
              >
                {status.pairingUrl}
              </a>
              <p className={subTextClass}>{t('securityAlerts.wizard.step3.qrHint')}</p>
            </div>
          </div>
        )}

        {vehicles.length === 0 && (
          <p className={subTextClass}>{t('securityAlerts.wizard.step3.noVehicles')}</p>
        )}

        {vehicles.length > 0 && (
          <ul className="space-y-2">
            {vehicles.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 bg-[#141414] border border-[#2a2a2a] rounded p-2"
              >
                <div className="min-w-0">
                  <div className="text-sm text-[#e0e0e0] truncate">{v.displayName || v.vin}</div>
                  <div className={`${subTextClass} truncate`}>
                    {v.vin}
                    {v.model ? ` · ${v.model}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill
                    ok={v.keyPaired}
                    label={v.keyPaired ? t('securityAlerts.wizard.step3.paired') : t('securityAlerts.wizard.step3.notPaired')}
                  />
                  <button
                    className={buttonSecondary}
                    onClick={() => markPairedMutation.mutate({ id: v.id, paired: !v.keyPaired })}
                    disabled={markPairedMutation.isPending}
                  >
                    {v.keyPaired ? t('securityAlerts.wizard.step3.unmark') : t('securityAlerts.wizard.step3.approve')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Step 4 — telemetry configuration */}
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-[#e0e0e0]">{t('securityAlerts.wizard.step4.title')}</div>
          <StatusPill
            ok={vehicles.some((v) => v.telemetryConfigured)}
            label={vehicles.some((v) => v.telemetryConfigured) ? t('securityAlerts.wizard.step4.configured') : labelTodo}
          />
        </div>
        <p className={subTextClass}>{t('securityAlerts.wizard.step4.intro')}</p>
        <button
          className={buttonPrimary}
          disabled={
            configureTelemetryMutation.isPending ||
            vehicles.filter((v) => v.keyPaired).length === 0
          }
          onClick={() =>
            configureTelemetryMutation.mutate(vehicles.filter((v) => v.keyPaired).map((v) => v.id))
          }
        >
          {configureTelemetryMutation.isPending
            ? t('securityAlerts.wizard.step4.configuring')
            : t('securityAlerts.wizard.step4.configure')}
        </button>
        {vehicles.filter((v) => v.keyPaired).length === 0 && (
          <p className={subTextClass}>{t('securityAlerts.wizard.step4.needPaired')}</p>
        )}
      </div>

      <SecurityAlertRecipients vehicles={vehicles} />

      <canvas ref={qrCanvasRef} hidden />
    </div>
  );
}
