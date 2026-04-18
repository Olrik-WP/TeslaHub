import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVehicleStatus } from '../hooks/useVehicle';
import { useLiveStream } from '../hooks/useLiveStream';
import { useUnits } from '../hooks/useUnits';
import { getSettings } from '../api/queries';
import { api } from '../api/client';
import SpeedGaugeAnalog, { type GaugeColorZone } from '../components/SpeedGaugeAnalog';
import SpeedGaugeDigital from '../components/SpeedGaugeDigital';
import PowerGauge from '../components/PowerGauge';
import CompassGauge from '../components/CompassGauge';
import StatCard from '../components/StatCard';
import BatteryGauge from '../components/BatteryGauge';

interface Props {
  carId: number | undefined;
}

const STORAGE_KEY = 'teslahub_dashboard_prefs';

interface DashPrefs {
  gaugeMode: 'analog' | 'digital';
  colorPreset: string;
  maxScale: number;
}

const COLOR_PRESETS: Record<string, { label: string; accent: string; zones: GaugeColorZone[] }> = {
  teslaRed: {
    label: 'Tesla Red',
    accent: '#e31937',
    zones: [
      { from: 0, to: 80, color: '#22c55e' },
      { from: 80, to: 120, color: '#eab308' },
      { from: 120, to: 300, color: '#ef4444' },
    ],
  },
  blueNeon: {
    label: 'Blue Neon',
    accent: '#3b82f6',
    zones: [
      { from: 0, to: 80, color: '#06b6d4' },
      { from: 80, to: 120, color: '#3b82f6' },
      { from: 120, to: 300, color: '#8b5cf6' },
    ],
  },
  greenTech: {
    label: 'Green Tech',
    accent: '#22c55e',
    zones: [
      { from: 0, to: 80, color: '#22c55e' },
      { from: 80, to: 120, color: '#84cc16' },
      { from: 120, to: 300, color: '#eab308' },
    ],
  },
  purpleWave: {
    label: 'Purple Wave',
    accent: '#8b5cf6',
    zones: [
      { from: 0, to: 80, color: '#6366f1' },
      { from: 80, to: 120, color: '#a855f7' },
      { from: 120, to: 300, color: '#ec4899' },
    ],
  },
  orangeFlame: {
    label: 'Orange Flame',
    accent: '#f97316',
    zones: [
      { from: 0, to: 80, color: '#eab308' },
      { from: 80, to: 120, color: '#f97316' },
      { from: 120, to: 300, color: '#ef4444' },
    ],
  },
};

const MAX_SCALE_OPTIONS = [160, 200, 260, 300];

function loadPrefsFromCache(): DashPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultPrefs, ...JSON.parse(raw) };
  } catch {}
  return defaultPrefs;
}

const defaultPrefs: DashPrefs = {
  gaugeMode: 'analog',
  colorPreset: 'teslaRed',
  maxScale: 200,
};

function cachePrefs(prefs: DashPrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export default function Dashboard({ carId }: Props) {
  const { t } = useTranslation();
  const u = useUnits();
  const queryClient = useQueryClient();
  const { data: vehicle } = useVehicleStatus(carId);
  const { data: live, connected: sseConnected } = useLiveStream(carId);
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 5 * 60_000 });
  const settingsSynced = useRef(false);

  const [prefs, setPrefsRaw] = useState<DashPrefs>(loadPrefsFromCache);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!settings || settingsSynced.current) return;
    settingsSynced.current = true;
    const next: DashPrefs = {
      ...loadPrefsFromCache(),
      gaugeMode: (settings.dashboardGaugeMode as 'analog' | 'digital') || 'analog',
      colorPreset: settings.dashboardColorPreset || 'teslaRed',
      maxScale: settings.dashboardMaxScale || 200,
    };
    cachePrefs(next);
    setPrefsRaw(next);
  }, [settings]);

  const setPrefs = useCallback((updater: (prev: DashPrefs) => DashPrefs) => {
    setPrefsRaw((prev) => updater(prev));
  }, []);

  useEffect(() => {
    cachePrefs(prefs);

    if (!settings) return;
    if (
      prefs.gaugeMode === (settings.dashboardGaugeMode || 'analog') &&
      prefs.colorPreset === (settings.dashboardColorPreset || 'teslaRed') &&
      prefs.maxScale === (settings.dashboardMaxScale || 200)
    ) return;

    const updated = {
      ...settings,
      dashboardGaugeMode: prefs.gaugeMode,
      dashboardColorPreset: prefs.colorPreset,
      dashboardMaxScale: prefs.maxScale,
    };
    api('/costs/settings', { method: 'PUT', body: JSON.stringify(updated) })
      .then(() => queryClient.invalidateQueries({ queryKey: ['settings'] }))
      .catch(() => {});
  }, [prefs.gaugeMode, prefs.colorPreset, prefs.maxScale]);

  const preset = COLOR_PRESETS[prefs.colorPreset] ?? COLOR_PRESETS.teslaRed;

  const speed = live?.speed ?? vehicle?.speed ?? 0;
  const power = live?.power ?? vehicle?.power ?? 0;
  const shiftState = live?.shiftState ?? vehicle?.shiftState ?? null;
  const heading = live?.heading ?? vehicle?.heading ?? 0;
  const elevation = live?.elevation ?? vehicle?.elevation ?? null;
  const geofence = live?.geofence ?? vehicle?.geofence ?? null;
  const odometer = live?.odometer ?? vehicle?.odometer ?? null;
  const batteryLevel = live?.batteryLevel ?? vehicle?.batteryLevel ?? 0;
  const estRange = live?.estBatteryRangeKm ?? vehicle?.estBatteryRangeKm ?? vehicle?.ratedBatteryRangeKm ?? null;
  const state = live?.state ?? vehicle?.state ?? null;

  const convertedSpeed = u.convertSpeed(speed) ?? 0;
  const convertedMaxScale = u.convertSpeed(prefs.maxScale) ?? prefs.maxScale;

  if (!vehicle) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-[#9ca3af] text-lg">{t('home.loadingVehicle')}</div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-3 max-w-2xl mx-auto">
      {/* Header: toggle + settings */}
      <div className="flex items-center justify-between">
        <div className="flex bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
          <button
            onClick={() => setPrefs((p) => ({ ...p, gaugeMode: 'analog' }))}
            className={`px-4 py-2 text-sm font-medium transition-colors min-h-[40px] ${
              prefs.gaugeMode === 'analog'
                ? 'text-white' : 'text-[#6b7280]'
            }`}
            style={prefs.gaugeMode === 'analog' ? { backgroundColor: preset.accent + '30', color: preset.accent } : undefined}
          >
            {t('dashboard.analog')}
          </button>
          <button
            onClick={() => setPrefs((p) => ({ ...p, gaugeMode: 'digital' }))}
            className={`px-4 py-2 text-sm font-medium transition-colors min-h-[40px] ${
              prefs.gaugeMode === 'digital'
                ? 'text-white' : 'text-[#6b7280]'
            }`}
            style={prefs.gaugeMode === 'digital' ? { backgroundColor: preset.accent + '30', color: preset.accent } : undefined}
          >
            {t('dashboard.digital')}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {sseConnected && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
              <span className="text-[10px] text-[#22c55e]">LIVE</span>
            </div>
          )}
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#9ca3af] active:bg-[#2a2a2a]"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-4">
          <div>
            <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-2">{t('dashboard.colorPreset')}</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(COLOR_PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => setPrefs((prev) => ({ ...prev, colorPreset: key }))}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm min-h-[40px] transition-colors ${
                    prefs.colorPreset === key
                      ? 'border-2 text-white'
                      : 'border border-[#2a2a2a] text-[#9ca3af]'
                  }`}
                  style={prefs.colorPreset === key ? { borderColor: p.accent, backgroundColor: p.accent + '15' } : undefined}
                >
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.accent }} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-2">{t('dashboard.maxScale')}</label>
            <div className="flex gap-2">
              {MAX_SCALE_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setPrefs((prev) => ({ ...prev, maxScale: s }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium min-h-[40px] transition-colors ${
                    prefs.maxScale === s
                      ? 'text-white'
                      : 'bg-[#1a1a1a] text-[#9ca3af]'
                  }`}
                  style={prefs.maxScale === s ? { backgroundColor: preset.accent + '30', color: preset.accent } : undefined}
                >
                  {Math.round(u.convertSpeed(s) ?? s)} {u.speedUnit}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch">
        {/* Speed gauge */}
        <div className="flex-1 min-w-0 bg-[#141414] border border-[#2a2a2a] rounded-xl p-2 sm:p-3 flex items-center justify-center">
          <div className="w-full max-w-[360px] sm:max-w-[400px] mx-auto">
            {prefs.gaugeMode === 'analog' ? (
              <SpeedGaugeAnalog
                speed={convertedSpeed}
                maxSpeed={convertedMaxScale}
                unit={u.speedUnit}
                shiftState={shiftState}
                colorZones={preset.zones.map((z) => ({
                  from: u.convertSpeed(z.from) ?? z.from,
                  to: u.convertSpeed(z.to) ?? z.to,
                  color: z.color,
                }))}
                accentColor={preset.accent}
              />
            ) : (
              <SpeedGaugeDigital
                speed={convertedSpeed}
                maxSpeed={convertedMaxScale}
                unit={u.speedUnit}
                shiftState={shiftState}
                accentColor={preset.accent}
              />
            )}
          </div>
        </div>

        {/* Compass + info (desktop: side panel) */}
        <div className="hidden sm:flex flex-col gap-3 w-[180px] lg:w-[200px] shrink-0">
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 flex items-center justify-center">
            <CompassGauge heading={heading} elevation={elevation} accentColor={preset.accent} />
          </div>
          {geofence && (
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl px-3 py-2">
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('dashboard.geofence')}</div>
              <div className="text-sm font-medium mt-0.5 truncate">{geofence}</div>
            </div>
          )}
          {state && (
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl px-3 py-2">
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider">{t('home.state')}</div>
              <div className="text-sm font-medium mt-0.5 truncate">{state}</div>
            </div>
          )}
        </div>
      </div>

      {/* Power gauge */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
        <PowerGauge power={power} accentColor={preset.accent} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label={t('dashboard.odometer')}
          value={odometer ? Math.round(u.convertDistance(odometer)!).toLocaleString() : '—'}
          unit={u.distanceUnit}
        />
        <StatCard
          label={t('dashboard.estRange')}
          value={estRange ? Math.round(u.convertDistance(estRange)!) : '—'}
          unit={u.distanceUnit}
          color="#22c55e"
        />
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-1 flex items-center justify-center">
          <BatteryGauge
            level={batteryLevel}
            rangeKm={estRange ? u.convertDistance(estRange) : null}
            rangeUnit={u.distanceUnit}
          />
        </div>
      </div>

      {/* Mobile: Compass + Geofence */}
      <div className="grid grid-cols-2 gap-3 sm:hidden">
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 flex items-center justify-center">
          <CompassGauge heading={heading} elevation={elevation} accentColor={preset.accent} />
        </div>
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 flex flex-col justify-center">
          {geofence && (
            <div className="mb-2">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('dashboard.geofence')}</div>
              <div className="text-sm font-medium mt-1 truncate">{geofence}</div>
            </div>
          )}
          {state && (
            <div>
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('home.state')}</div>
              <div className="text-sm font-medium mt-1">{state}</div>
            </div>
          )}
          {elevation != null && !geofence && !state && (
            <div>
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('dashboard.elevation')}</div>
              <div className="text-sm font-bold mt-1">{elevation} m</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
