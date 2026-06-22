import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { utcDate } from '../utils/date';

// Compact "day/month + time" used by the decisions timeline. The hour
// alone is ambiguous once events span more than one day, so we always
// show the date too. utcDate() normalises the backend timestamp (which
// may or may not carry a trailing 'Z') before converting to local time.
function formatEventDateTime(iso: string): { date: string; time: string } {
  const d = utcDate(iso);
  return {
    date: d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }),
    time: d.toLocaleTimeString(),
  };
}

type LoadSheddingProfile = {
  id: number;
  enabled: boolean;
  dryRun: boolean;
  maxAmps: number;
  minAmps: number;
  targetReducedAmps: number;
  highThresholdVa: number;
  lowThresholdVa: number;
  highWindowSeconds: number;
  lowWindowSeconds: number;
  cooldownSeconds: number;
  minAmpsDelta: number;
  hourlyCommandQuota: number;
  dailyCommandQuota: number;
  minSamplesInWindow: number;
  mqttTopic: string;
  powerJsonField: string;
  powerUnit: string;
  powerScale: number;
};

type LoadSheddingRuntime = {
  state: string;
  chargingState?: string | null;
  currentAmps?: number | null;
  teslaVa?: number | null;
  lastCommandAt?: string | null;
  commandsLastHour: number;
  commandsLastDay: number;
};

type LoadSheddingVehicle = {
  vehicleId: number;
  vin: string;
  displayName?: string | null;
  profile: LoadSheddingProfile | null;
  runtime: LoadSheddingRuntime;
};

type LoadSheddingHouse = {
  currentVa?: number | null;
  lastSampleAt?: string | null;
  samplesInLast60s: number;
  unit: string;
};

type LoadSheddingStatus = {
  house: LoadSheddingHouse;
  vehicles: LoadSheddingVehicle[];
  mqttConnected: boolean;
  mqttTopic?: string | null;
};

type LoadSheddingEvent = {
  id: number;
  teslaVehicleId: number;
  at: string;
  kind: string;
  fromAmps?: number | null;
  toAmps?: number | null;
  houseVa?: number | null;
  detail?: string | null;
};

const inputClass =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#e31937]';
const sectionTitleClass = 'text-xs text-[#9ca3af] uppercase tracking-wider';
const subTextClass = 'text-xs text-[#6b7280]';
const buttonPrimary =
  'bg-[#e31937] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f] disabled:opacity-50 disabled:cursor-not-allowed';
const buttonDanger =
  'bg-[#1a1a1a] border border-[#2a2a2a] text-[#ef4444] px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#2a2a2a] disabled:opacity-50';

const DEFAULT_PROFILE: LoadSheddingProfile = {
  id: 0,
  enabled: false,
  dryRun: true,
  maxAmps: 32,
  minAmps: 6,
  targetReducedAmps: 20,
  highThresholdVa: 9500,
  lowThresholdVa: 7000,
  highWindowSeconds: 30,
  lowWindowSeconds: 900,
  cooldownSeconds: 60,
  minAmpsDelta: 2,
  hourlyCommandQuota: 30,
  dailyCommandQuota: 200,
  minSamplesInWindow: 2,
  mqttTopic: 'zigbee2mqtt/Lixee',
  powerJsonField: 'apparent_power',
  powerUnit: 'VA',
  powerScale: 1,
};

// Common smart-meter / power-monitor presets, country-neutral.
// `unit` is what the UI displays as a suffix (VA / W). `scale` is the
// multiplier the backend applies before storing the raw payload value
// as an integer — so a P1 reader publishing kW is converted to W on
// ingestion (scale=1000) and the user works in W everywhere, keeping
// integer thresholds and avoiding lost precision.
type SourcePreset = {
  id: string;
  topic: string;
  field: string;
  unit: string;
  scale: number;
};
const SOURCE_PRESETS: SourcePreset[] = [
  { id: 'zlinky',    topic: 'zigbee2mqtt/Lixee',                       field: 'apparent_power',   unit: 'VA', scale: 1 },
  { id: 'shellyEm',  topic: 'shellies/shellyem-XXXX/emeter/0/power',   field: '',                 unit: 'W',  scale: 1 },
  { id: 'shellyPro', topic: 'shellypro3em-XXXX/status/em:0',           field: 'total_act_power',  unit: 'W',  scale: 1 },
  { id: 'tasmota',   topic: 'tele/tasmota_XXXX/SENSOR',                field: 'ENERGY.Power',     unit: 'W',  scale: 1 },
  { id: 'p1Reader',  topic: 'p1reader/sensor/power_consumed/state',    field: '',                 unit: 'W',  scale: 1000 },
  { id: 'iotawatt',  topic: 'iotawatt/Mains',                           field: '',                 unit: 'W',  scale: 1 },
  { id: 'emporia',   topic: 'emporia/vue/mains',                        field: 'usage_w',          unit: 'W',  scale: 1 },
  { id: 'custom',    topic: '',                                         field: '',                 unit: 'VA', scale: 1 },
];

/** Which row in SOURCE_PRESETS matches the current form (topic/field/unit/scale exactly). */
function matchSourcePreset(form: Pick<LoadSheddingProfile, 'mqttTopic' | 'powerJsonField' | 'powerUnit' | 'powerScale'>): string {
  const topic = form.mqttTopic.trim();
  const field = form.powerJsonField.trim();
  const unit = form.powerUnit.trim();
  const scale = Number(form.powerScale);
  for (const p of SOURCE_PRESETS) {
    if (p.id === 'custom') continue;
    if (
      p.topic.trim() === topic &&
      p.field.trim() === field &&
      p.unit.trim() === unit &&
      Math.abs(p.scale - scale) < 1e-6
    ) {
      return p.id;
    }
  }
  return 'custom';
}

function NumberField({
  label,
  value,
  onChange,
  hint,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  min?: number;
}) {
  return (
    <div className="space-y-1">
      <label className={sectionTitleClass}>{label}</label>
      <input
        type="number"
        className={inputClass}
        value={value}
        min={min}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      />
      {hint && <p className={subTextClass}>{hint}</p>}
    </div>
  );
}

function StatePill({ kind }: { kind: string }) {
  const palette: Record<string, { bg: string; text: string }> = {
    Reduce: { bg: 'bg-[#3a2a1a]', text: 'text-[#f0a47e]' },
    Raise: { bg: 'bg-[#1a3d1a]', text: 'text-[#a7e9a7]' },
    DryRunReduce: { bg: 'bg-[#1a2a3a]', text: 'text-[#7eb8f0]' },
    DryRunRaise: { bg: 'bg-[#1a2a3a]', text: 'text-[#7eb8f0]' },
    Skip: { bg: 'bg-[#1a1a1a]', text: 'text-[#9ca3af]' },
    QuotaHit: { bg: 'bg-[#3d1a1a]', text: 'text-[#f0a7a7]' },
    ProxyError: { bg: 'bg-[#3d1a1a]', text: 'text-[#f0a7a7]' },
    NoData: { bg: 'bg-[#1a1a1a]', text: 'text-[#9ca3af]' },
  };
  const palette_ = palette[kind] ?? { bg: 'bg-[#1a1a1a]', text: 'text-[#9ca3af]' };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider ${palette_.bg} ${palette_.text}`}>
      {kind}
    </span>
  );
}

export default function LoadSheddingPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [form, setForm] = useState<LoadSheddingProfile>(DEFAULT_PROFILE);

  // Live status: short-poll every 3s. SSE would be cheaper but the
  // app's existing EventSource-with-token plumbing is scoped to the
  // /vehicle live-stream endpoint only and we don't want to extend it
  // for what is essentially a low-cardinality status payload.
  const { data: status } = useQuery<LoadSheddingStatus>({
    queryKey: ['loadShedding', 'status'],
    queryFn: () => api<LoadSheddingStatus>('/load-shedding/status'),
    refetchInterval: 3000,
  });

  const { data: events } = useQuery<LoadSheddingEvent[]>({
    queryKey: ['loadShedding', 'events', selectedVehicleId],
    queryFn: () =>
      api<LoadSheddingEvent[]>(
        selectedVehicleId
          ? `/load-shedding/events?vehicleId=${selectedVehicleId}&take=50`
          : '/load-shedding/events?take=50',
      ),
    refetchInterval: 5000,
  });

  const vehicles = status?.vehicles ?? [];

  // Auto-select the first vehicle on first render so the form is not
  // dangling. Re-select if the chosen vehicle disappears (rare, but
  // happens when the user removes a Tesla from their account).
  useEffect(() => {
    if (vehicles.length === 0) return;
    if (selectedVehicleId === null || !vehicles.some((v) => v.vehicleId === selectedVehicleId)) {
      setSelectedVehicleId(vehicles[0].vehicleId);
    }
  }, [vehicles, selectedVehicleId]);

  const selected = useMemo(
    () => vehicles.find((v) => v.vehicleId === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId],
  );

  // Push the server profile (or defaults) into the local form whenever
  // the selection changes, so editing one vehicle never bleeds into
  // another.
  useEffect(() => {
    if (!selected) return;
    setForm(selected.profile ?? { ...DEFAULT_PROFILE });
  }, [selected?.vehicleId, selected?.profile?.id]);

  const saveMutation = useMutation({
    mutationFn: (vehicleId: number) =>
      api<LoadSheddingProfile>(`/load-shedding/profiles/${vehicleId}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      setFeedback({ ok: true, text: t('loadShedding.feedback.saved') });
      queryClient.invalidateQueries({ queryKey: ['loadShedding'] });
    },
    onError: (err: Error) =>
      setFeedback({ ok: false, text: err.message || t('loadShedding.feedback.saveError') }),
  });

  const deleteMutation = useMutation({
    mutationFn: (vehicleId: number) =>
      api(`/load-shedding/profiles/${vehicleId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setFeedback({ ok: true, text: t('loadShedding.buttons.deleted') });
      setForm({ ...DEFAULT_PROFILE });
      queryClient.invalidateQueries({ queryKey: ['loadShedding'] });
    },
  });

  // ALL hooks must run on every render. The previous version of this
  // component had `useMemo(matchSourcePreset)` after an early return
  // for `vehicles.length === 0`, which violated the Rules of Hooks:
  // on the first render `/status` hasn't replied yet so vehicles is
  // empty and the hook is skipped; once the query resolves, the hook
  // IS called and React throws #310 ("rendered more hooks than during
  // the previous render"). Keep all hook calls above any conditional
  // early return.
  const matchedSourcePresetId = useMemo(
    () => matchSourcePreset(form),
    [form.mqttTopic, form.powerJsonField, form.powerUnit, form.powerScale],
  );

  if (vehicles.length === 0) {
    return (
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-2">
        <div className={sectionTitleClass}>{t('loadShedding.title')}</div>
        <p className={subTextClass}>{t('loadShedding.noVehicles')}</p>
      </div>
    );
  }

  // Server-truth unit (echoed from the active profile in /status). Falls
  // back to the form's local edit so the suffix updates immediately when
  // the user picks a preset, before the next status poll lands.
  const displayUnit = status?.house?.unit || form.powerUnit || 'VA';

  const renderHouse = () => {
    const house = status?.house;
    const va = house?.currentVa;
    const staleSeconds = house?.lastSampleAt
      ? Math.max(0, Math.round((Date.now() - new Date(house.lastSampleAt).getTime()) / 1000))
      : null;
    const isStale = staleSeconds !== null && staleSeconds > 60;
    const colour = isStale ? 'text-[#f0a47e]' : status?.mqttConnected ? 'text-[#a7e9a7]' : 'text-[#9ca3af]';

    return (
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 flex items-center justify-between gap-3">
        <div>
          <div className={sectionTitleClass}>{t('loadShedding.status.house')}</div>
          <div className="text-xl font-semibold text-[#e0e0e0]">
            {va !== null && va !== undefined ? `${va.toLocaleString()} ${displayUnit}` : '—'}
          </div>
          <div className={`text-xs ${colour}`}>
            {!status?.mqttConnected
              ? t('loadShedding.status.mqttDisconnected')
              : house?.currentVa === null || house?.currentVa === undefined
                ? t('loadShedding.status.noData')
                : t('loadShedding.status.samples', { count: house.samplesInLast60s })}
          </div>
        </div>
        <div className="text-right">
          <div className={subTextClass}>{status?.mqttTopic ? t('loadShedding.status.topic', { topic: status.mqttTopic }) : ''}</div>
        </div>
      </div>
    );
  };

  const renderRuntime = () => {
    if (!selected) return null;
    const r = selected.runtime;
    const lastCmd = r.lastCommandAt
      ? `${formatEventDateTime(r.lastCommandAt).date} ${formatEventDateTime(r.lastCommandAt).time}`
      : '—';

    return (
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-2">
        <div className={sectionTitleClass}>{t('loadShedding.runtime.title')}</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className={subTextClass}>{t('loadShedding.runtime.state')}</div>
            <div className="text-[#e0e0e0]">{r.state}</div>
          </div>
          <div>
            <div className={subTextClass}>{t('loadShedding.runtime.chargingState')}</div>
            <div className="text-[#e0e0e0]">{r.chargingState ?? '—'}</div>
          </div>
          <div>
            <div className={subTextClass}>{t('loadShedding.runtime.currentAmps')}</div>
            <div className="text-[#e0e0e0]">{r.currentAmps !== null && r.currentAmps !== undefined ? `${r.currentAmps} A` : '—'}</div>
          </div>
          <div>
            <div className={subTextClass}>{t('loadShedding.runtime.teslaVa')}</div>
            <div className="text-[#e0e0e0]">{r.teslaVa !== null && r.teslaVa !== undefined ? `${r.teslaVa.toLocaleString()} ${displayUnit}` : '—'}</div>
          </div>
          <div>
            <div className={subTextClass}>{t('loadShedding.runtime.lastCommand')}</div>
            <div className="text-[#e0e0e0]">{lastCmd}</div>
          </div>
          <div>
            <div className={subTextClass}>
              {t('loadShedding.runtime.quotaHour', {
                count: r.commandsLastHour,
                max: form.hourlyCommandQuota,
              })}
            </div>
            <div className="text-[#e0e0e0]">
              {t('loadShedding.runtime.quotaDay', {
                count: r.commandsLastDay,
                max: form.dailyCommandQuota,
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTimeline = () => {
    if (!events || events.length === 0) {
      return (
        <p className={subTextClass}>{t('loadShedding.events.empty')}</p>
      );
    }
    return (
      <ul className="space-y-1">
        {events.map((e) => (
          <li key={e.id} className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-md p-2 text-xs flex items-start gap-2">
            <span className="text-[#6b7280] tabular-nums shrink-0 flex flex-col leading-tight w-[3.5rem]">
              <span>{formatEventDateTime(e.at).date}</span>
              <span>{formatEventDateTime(e.at).time}</span>
            </span>
            <StatePill kind={e.kind} />
            <span className="text-[#9ca3af] flex-1 break-words">
              {e.fromAmps !== null && e.fromAmps !== undefined && e.toAmps !== null && e.toAmps !== undefined
                ? `${t('loadShedding.events.arrowAmps', { from: e.fromAmps, to: e.toAmps })}`
                : ''}
              {e.houseVa !== null && e.houseVa !== undefined ? ` · ${e.houseVa} ${displayUnit}` : ''}
              {e.detail ? ` · ${e.detail}` : ''}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-4">
      <div>
        <div className={sectionTitleClass}>{t('loadShedding.title')}</div>
        <p className={subTextClass}>{t('loadShedding.intro')}</p>
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

      {renderHouse()}

      {/* Vehicle selector */}
      {vehicles.length > 1 && (
        <div className="space-y-1">
          <label className={sectionTitleClass}>{t('loadShedding.vehicle.selectPlaceholder')}</label>
          <select
            className={inputClass}
            value={selectedVehicleId ?? ''}
            onChange={(e) => setSelectedVehicleId(parseInt(e.target.value, 10))}
          >
            {vehicles.map((v) => (
              <option key={v.vehicleId} value={v.vehicleId}>
                {v.displayName ?? v.vin}
              </option>
            ))}
          </select>
        </div>
      )}

      {selected && (
        <>
          {/* MQTT source — moved to the top so users without a French
              Linky meter see immediately that the source is configurable
              and what to put. The form stays in dot-notation format so
              both flat (ZLinky / Tasmota) and nested (Shelly Gen2 / EM)
              payloads work without any backend change. */}
          <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
            <div className={sectionTitleClass}>{t('loadShedding.source.title')}</div>
            <p className={subTextClass}>{t('loadShedding.source.intro')}</p>

            <div className="space-y-1">
              <label className={sectionTitleClass}>{t('loadShedding.source.preset')}</label>
              <select
                className={inputClass}
                value={matchedSourcePresetId}
                onChange={(e) => {
                  const preset = SOURCE_PRESETS.find((p) => p.id === e.target.value);
                  if (!preset || preset.id === 'custom') return;
                  setForm({
                    ...form,
                    mqttTopic: preset.topic,
                    powerJsonField: preset.field,
                    powerUnit: preset.unit,
                    powerScale: preset.scale,
                  });
                }}
              >
                {SOURCE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(`loadShedding.source.presets.${p.id}`)}
                  </option>
                ))}
              </select>
              <p className={subTextClass}>{t('loadShedding.source.presetHint')}</p>
            </div>

            <div className="space-y-1">
              <label className={sectionTitleClass}>{t('loadShedding.source.topic')}</label>
              <input
                className={inputClass}
                value={form.mqttTopic}
                onChange={(e) => setForm({ ...form, mqttTopic: e.target.value })}
                placeholder="zigbee2mqtt/Lixee"
              />
              <p className={subTextClass}>{t('loadShedding.source.topicHint')}</p>
            </div>

            <div className="space-y-1">
              <label className={sectionTitleClass}>{t('loadShedding.source.field')}</label>
              <input
                className={inputClass}
                value={form.powerJsonField}
                onChange={(e) => setForm({ ...form, powerJsonField: e.target.value })}
                placeholder="apparent_power"
              />
              <p className={subTextClass}>{t('loadShedding.source.fieldHint')}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={sectionTitleClass}>{t('loadShedding.source.unit')}</label>
                <input
                  className={inputClass}
                  value={form.powerUnit}
                  onChange={(e) => setForm({ ...form, powerUnit: e.target.value.slice(0, 10) })}
                  placeholder="VA"
                  maxLength={10}
                />
                <p className={subTextClass}>{t('loadShedding.source.unitHint')}</p>
              </div>
              <div className="space-y-1">
                <label className={sectionTitleClass}>{t('loadShedding.source.scale')}</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className={inputClass}
                  value={form.powerScale}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    setForm({ ...form, powerScale: Number.isFinite(n) && n > 0 ? n : 1 });
                  }}
                />
                <p className={subTextClass}>{t('loadShedding.source.scaleHint')}</p>
              </div>
            </div>

            {/* Live verification block: shows what we currently receive
                from the broker so the user can confirm topic+field are
                correct WITHOUT having to enable the engine. */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-md p-2 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[#9ca3af]">{t('loadShedding.source.liveCheck')}</span>
                <span className={status?.mqttConnected ? 'text-[#a7e9a7]' : 'text-[#f0a47e]'}>
                  {status?.mqttConnected ? t('loadShedding.source.brokerOk') : t('loadShedding.source.brokerKo')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9ca3af]">{t('loadShedding.source.lastValue')}</span>
                <span className="text-[#e0e0e0] tabular-nums">
                  {status?.house?.currentVa !== null && status?.house?.currentVa !== undefined
                    ? `${status.house.currentVa.toLocaleString()} ${form.powerUnit}`
                    : '—'}
                </span>
              </div>
              <p className={subTextClass}>{t('loadShedding.source.liveHint')}</p>
            </div>
          </div>

          {renderRuntime()}

          {/* Master toggle + dry-run */}
          <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="mt-1 w-4 h-4 accent-[#e31937]"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium text-white">{t('loadShedding.vehicle.enable')}</span>
                <span className="block text-xs text-[#6b7280] mt-0.5">{t('loadShedding.vehicle.enableHint')}</span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.dryRun}
                onChange={(e) => setForm({ ...form, dryRun: e.target.checked })}
                className="mt-1 w-4 h-4 accent-[#3b82f6]"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium text-white">{t('loadShedding.vehicle.dryRun')}</span>
                <span className="block text-xs text-[#6b7280] mt-0.5">{t('loadShedding.vehicle.dryRunHint')}</span>
              </span>
            </label>

            {!selected.profile && (
              <p className={subTextClass}>{t('loadShedding.vehicle.notConfigured')}</p>
            )}
          </div>

          {/* Thresholds */}
          <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
            <div className={sectionTitleClass}>{t('loadShedding.thresholds.title')}</div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label={t('loadShedding.thresholds.high', { unit: displayUnit })}
                value={form.highThresholdVa}
                onChange={(v) => setForm({ ...form, highThresholdVa: v })}
              />
              <NumberField
                label={t('loadShedding.thresholds.highWindow')}
                value={form.highWindowSeconds}
                onChange={(v) => setForm({ ...form, highWindowSeconds: v })}
                min={1}
              />
              <NumberField
                label={t('loadShedding.thresholds.low', { unit: displayUnit })}
                value={form.lowThresholdVa}
                onChange={(v) => setForm({ ...form, lowThresholdVa: v })}
              />
              <NumberField
                label={t('loadShedding.thresholds.lowWindow')}
                value={form.lowWindowSeconds}
                onChange={(v) => setForm({ ...form, lowWindowSeconds: v })}
                min={1}
              />
              <NumberField
                label={t('loadShedding.thresholds.minAmps')}
                value={form.minAmps}
                onChange={(v) => setForm({ ...form, minAmps: v })}
                min={1}
              />
              <NumberField
                label={t('loadShedding.thresholds.maxAmps')}
                value={form.maxAmps}
                onChange={(v) => setForm({ ...form, maxAmps: v })}
                min={1}
              />
              <NumberField
                label={t('loadShedding.thresholds.targetReduced')}
                value={form.targetReducedAmps}
                onChange={(v) => setForm({ ...form, targetReducedAmps: v })}
                min={1}
              />
            </div>
          </div>

          {/* Guard rails */}
          <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
            <div className={sectionTitleClass}>{t('loadShedding.guards.title')}</div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label={t('loadShedding.guards.cooldown')}
                value={form.cooldownSeconds}
                onChange={(v) => setForm({ ...form, cooldownSeconds: v })}
              />
              <NumberField
                label={t('loadShedding.guards.minDelta')}
                value={form.minAmpsDelta}
                onChange={(v) => setForm({ ...form, minAmpsDelta: v })}
                min={1}
              />
              <NumberField
                label={t('loadShedding.guards.hourQuota')}
                value={form.hourlyCommandQuota}
                onChange={(v) => setForm({ ...form, hourlyCommandQuota: v })}
                min={1}
              />
              <NumberField
                label={t('loadShedding.guards.dayQuota')}
                value={form.dailyCommandQuota}
                onChange={(v) => setForm({ ...form, dailyCommandQuota: v })}
                min={1}
              />
              <NumberField
                label={t('loadShedding.guards.minSamples')}
                value={form.minSamplesInWindow}
                onChange={(v) => setForm({ ...form, minSamplesInWindow: v })}
                min={1}
              />
            </div>
          </div>

          {/* Save / delete */}
          <div className="flex gap-2">
            <button
              className={buttonPrimary}
              disabled={saveMutation.isPending}
              onClick={() => selected && saveMutation.mutate(selected.vehicleId)}
            >
              {saveMutation.isPending ? t('loadShedding.buttons.saving') : t('loadShedding.buttons.save')}
            </button>
            {selected.profile && (
              <button
                className={buttonDanger}
                disabled={deleteMutation.isPending}
                onClick={() => selected && deleteMutation.mutate(selected.vehicleId)}
              >
                {t('loadShedding.buttons.delete')}
              </button>
            )}
          </div>

          {/* Timeline */}
          <div className="space-y-2">
            <div className={sectionTitleClass}>{t('loadShedding.events.title')}</div>
            {renderTimeline()}
          </div>
        </>
      )}
    </div>
  );
}
