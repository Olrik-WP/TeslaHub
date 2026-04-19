import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../api/client';

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
      setFeedback({ ok: true, text: 'Public key generated.' });
      queryClient.invalidateQueries({ queryKey: ['teslaPairingStatus'] });
    },
    onError: (err: Error) => setFeedback({ ok: false, text: err.message || 'Key generation failed.' }),
  });

  const registerMutation = useMutation({
    mutationFn: () => api('/tesla-pairing/register-partner', { method: 'POST' }),
    onSuccess: () => {
      setFeedback({ ok: true, text: 'Domain registered with Tesla as a partner.' });
      queryClient.invalidateQueries({ queryKey: ['teslaPairingStatus'] });
    },
    onError: (err: Error) => setFeedback({ ok: false, text: err.message || 'Partner registration failed.' }),
  });

  const syncMutation = useMutation({
    mutationFn: () => api<{ count: number }>('/tesla-pairing/sync-vehicles', { method: 'POST' }),
    onSuccess: (data) => {
      setFeedback({ ok: true, text: `Synced ${data.count} vehicle(s).` });
      queryClient.invalidateQueries({ queryKey: ['teslaPairingStatus'] });
    },
    onError: (err: Error) => setFeedback({ ok: false, text: err.message || 'Vehicle sync failed.' }),
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
      setFeedback({ ok: true, text: 'Telemetry configured with Tesla. Streaming will start when the vehicle is awake.' });
      queryClient.invalidateQueries({ queryKey: ['teslaPairingStatus'] });
    },
    onError: (err: Error) => setFeedback({ ok: false, text: err.message || 'Telemetry configuration failed.' }),
  });

  const publicKeyTestUrl = useMemo(() => status?.publicKeyUrl ?? null, [status?.publicKeyUrl]);

  if (isLoading) {
    return <p className={subTextClass}>Loading pairing wizard…</p>;
  }

  const keyGenerated = status?.keyGenerated ?? false;
  const partnerRegistered = status?.partnerRegistered ?? false;
  const vehicles = status?.vehicles ?? [];

  return (
    <div className="space-y-4">
      <div className="border-t border-[#2a2a2a] pt-4 space-y-1">
        <div className={sectionTitleClass}>Vehicle pairing wizard</div>
        <p className={subTextClass}>
          Once your Tesla account is connected, follow these steps to authorize this TeslaHub instance to receive
          telemetry from your vehicles.
        </p>
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
          <div className="text-sm text-[#e0e0e0]">1. Generate the public key for your domain</div>
          <StatusPill ok={keyGenerated} label={keyGenerated ? 'done' : 'todo'} />
        </div>
        <p className={subTextClass}>
          TeslaHub creates an EC P-256 keypair and exposes the public key at a fixed well-known URL on your domain.
          The private key is encrypted at rest with AES-GCM and never leaves the database.
        </p>
        <div className="space-y-2">
          <label className={sectionTitleClass}>Public domain</label>
          <input
            className={inputClass}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="teslahub.yourdomain.com"
          />
          <p className={subTextClass}>
            Use the host TeslaHub is reachable from on the public internet (no <code>http://</code> prefix, no path).
          </p>
        </div>
        <button
          className={buttonPrimary}
          disabled={generateMutation.isPending || !domain.trim()}
          onClick={() => generateMutation.mutate()}
        >
          {generateMutation.isPending
            ? 'Generating…'
            : keyGenerated
              ? 'Regenerate key (resets pairing!)'
              : 'Generate public key'}
        </button>

        {keyGenerated && publicKeyTestUrl && (
          <div className="space-y-1 pt-2">
            <div className={sectionTitleClass}>Public key URL</div>
            <div className={codeBlockClass}>{publicKeyTestUrl}</div>
            <p className={subTextClass}>
              Open this URL in a new tab — it must return your public key in PEM format. If it fails, verify your DNS
              record, your reverse proxy (Caddy/Nginx), and that the path{' '}
              <code className="text-[#e0e0e0]">/.well-known/appspecific/com.tesla.3p.public-key.pem</code> reaches the
              TeslaHub API container.
            </p>
            <a className="text-[#e31937] text-xs underline" href={publicKeyTestUrl} target="_blank" rel="noreferrer">
              Test the public key endpoint
            </a>
          </div>
        )}
      </div>

      {/* Step 2 — partner registration */}
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-[#e0e0e0]">2. Register your domain with Tesla</div>
          <StatusPill ok={partnerRegistered} label={partnerRegistered ? 'done' : 'todo'} />
        </div>
        <p className={subTextClass}>
          Tells Tesla that your domain hosts a partner application. Tesla fetches the public key from your{' '}
          <code className="text-[#e0e0e0]">.well-known</code> endpoint to confirm.
        </p>
        <button
          className={buttonPrimary}
          disabled={registerMutation.isPending || !keyGenerated}
          onClick={() => registerMutation.mutate()}
        >
          {registerMutation.isPending
            ? 'Registering…'
            : partnerRegistered
              ? 'Re-register'
              : 'Register partner domain'}
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
          <div className="text-sm text-[#e0e0e0]">3. Pair each vehicle with TeslaHub</div>
          <button
            className={buttonSecondary}
            disabled={syncMutation.isPending || !partnerRegistered}
            onClick={() => syncMutation.mutate()}
          >
            {syncMutation.isPending ? 'Syncing…' : 'Sync vehicles from Tesla'}
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
              <p className="text-xs text-[#e0e0e0]">
                Scan this QR code with your iPhone (or open the link below in your phone's browser):
              </p>
              <a
                className="text-[#e31937] text-xs underline break-all"
                href={status.pairingUrl}
                target="_blank"
                rel="noreferrer"
              >
                {status.pairingUrl}
              </a>
              <p className={subTextClass}>
                The Tesla mobile app will prompt you to approve TeslaHub's virtual key for the selected vehicle. Repeat
                this for every car you want to monitor. Once approved, click <em>I've approved</em> below the matching
                vehicle.
              </p>
            </div>
          </div>
        )}

        {vehicles.length === 0 && (
          <p className={subTextClass}>No vehicles synced yet. Click <em>Sync vehicles from Tesla</em> above.</p>
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
                  <StatusPill ok={v.keyPaired} label={v.keyPaired ? 'paired' : 'not paired'} />
                  <button
                    className={buttonSecondary}
                    onClick={() => markPairedMutation.mutate({ id: v.id, paired: !v.keyPaired })}
                    disabled={markPairedMutation.isPending}
                  >
                    {v.keyPaired ? 'Unmark' : "I've approved"}
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
          <div className="text-sm text-[#e0e0e0]">4. Tell Tesla to start streaming telemetry</div>
          <StatusPill
            ok={vehicles.some((v) => v.telemetryConfigured)}
            label={vehicles.some((v) => v.telemetryConfigured) ? 'configured' : 'todo'}
          />
        </div>
        <p className={subTextClass}>
          Once your <code className="text-[#e0e0e0]">fleet-telemetry</code> container is running and reachable on{' '}
          <code className="text-[#e0e0e0]">telemetry.yourdomain.com</code> (see README), click below. TeslaHub calls
          Tesla's <code className="text-[#e0e0e0]">/fleet_telemetry_config_create</code> for every paired vehicle.
        </p>
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
          {configureTelemetryMutation.isPending ? 'Configuring…' : 'Configure telemetry for all paired vehicles'}
        </button>
        {vehicles.filter((v) => v.keyPaired).length === 0 && (
          <p className={subTextClass}>Pair at least one vehicle in step 3 first.</p>
        )}
      </div>

      <p className={subTextClass}>
        The Telegram notification matrix (which alerts go to whom) lands in the next release. Telemetry already flowing
        on NATS will be picked up immediately when it ships — no additional setup needed.
      </p>

      <canvas ref={qrCanvasRef} hidden />
    </div>
  );
}
