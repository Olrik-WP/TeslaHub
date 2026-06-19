import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import type { VehicleStatus } from '../api/queries';
import {
  useResolvedModelConfig,
  useSaveShowroom,
} from './useResolvedModelConfig';
import {
  buildSavedBlob,
  modelSlot,
  normalizeBlob,
  resolveActiveModelKey,
} from './showroomOverrides';

interface Props {
  vehicle: VehicleStatus;
}

// The 4 callout keys controlled by the "hide 3D TPMS" toggle. These mirror
// the keys defined in `VehicleCallouts.tsx` / `vehicleModelConfig.ts` so
// flipping the toggle is equivalent to ticking all 4 TPMS visibility
// checkboxes in the Showroom calibration panel.
const TPMS_CALLOUT_KEYS = ['tpmsFL', 'tpmsFR', 'tpmsRL', 'tpmsRR'] as const;

/**
 * Compact 1-row TPMS summary rendered above the `HomeBatteryBar`.
 *
 * Why this exists: the 3D viewer surfaces TPMS pills directly on each
 * wheel (great for "spotting WHICH tyre is low") but the user can hide
 * those pills via the Showroom — and even when they're shown, the
 * pressure numbers can be hard to read while orbiting the camera.
 *
 * This row is the always-on fallback: 4 compact chips arranged
 * front-left / front-right / rear-left / rear-right, colour-coded by
 * Tesla's own `tpmsSoftWarningXX` flag (green = OK, red = warning,
 * grey = no data). It sits between the car and the battery bar so
 * it's visible at a glance even when the 3D pills are hidden.
 *
 * Rendered ONLY when at least one pressure or warning signal is fresh —
 * older cars without TPMS publish nothing so the row stays hidden.
 *
 * The eye-toggle button next to the title hides/shows the 3D TPMS pills
 * on top of each wheel. The preference is persisted server-side as part
 * of the showroom override blob (same place the Showroom UI writes to),
 * keyed per-car. We deliberately AVOID localStorage so the toggle
 * follows the user across browsers / devices.
 */
export default function TpmsSummaryRow({ vehicle }: Props) {
  const { t } = useTranslation();
  const u = useUnits();

  // Pull the resolved showroom config so we know whether the 4 TPMS
  // callouts are currently hidden in the 3D viewer. We persist via
  // `useSaveShowroom` on toggle — same backend the Showroom uses.
  const { config: cfg, savedOverrides } = useResolvedModelConfig(
    vehicle.carId,
    vehicle.vin,
  );
  const saveShowroom = useSaveShowroom(vehicle.carId);

  const hasAnyPressure =
    vehicle.tpmsPressureFl != null ||
    vehicle.tpmsPressureFr != null ||
    vehicle.tpmsPressureRl != null ||
    vehicle.tpmsPressureRr != null;
  const hasAnyWarning =
    vehicle.tpmsSoftWarningFl != null ||
    vehicle.tpmsSoftWarningFr != null ||
    vehicle.tpmsSoftWarningRl != null ||
    vehicle.tpmsSoftWarningRr != null;
  if (!hasAnyPressure && !hasAnyWarning) return null;

  const slots: Array<{
    labelKey: string;
    pressure: number | null;
    warning: boolean | null;
  }> = [
    {
      labelKey: 'home.tpms.fl',
      pressure: vehicle.tpmsPressureFl,
      warning: vehicle.tpmsSoftWarningFl,
    },
    {
      labelKey: 'home.tpms.fr',
      pressure: vehicle.tpmsPressureFr,
      warning: vehicle.tpmsSoftWarningFr,
    },
    {
      labelKey: 'home.tpms.rl',
      pressure: vehicle.tpmsPressureRl,
      warning: vehicle.tpmsSoftWarningRl,
    },
    {
      labelKey: 'home.tpms.rr',
      pressure: vehicle.tpmsPressureRr,
      warning: vehicle.tpmsSoftWarningRr,
    },
  ];

  const anyWarning = slots.some((s) => s.warning === true);

  // "3D pills hidden" is true when ALL 4 TPMS keys are flagged hidden.
  // We treat partial states (3 hidden / 1 visible) as "visible" so the
  // single button always converges to a clear binary on next click.
  const tpms3dHidden = TPMS_CALLOUT_KEYS.every(
    (k) => cfg.calloutsHidden?.[k] === true,
  );

  const toggle3dTpms = () => {
    if (!vehicle.carId || saveShowroom.isPending) return;
    // Operate on the ACTIVE model's per-car slot (v2 blob). We edit only
    // that slot's calloutsHidden and rebuild the namespaced blob so the
    // other models' calibration is preserved.
    const vin = vehicle.vin;
    const activeKey = resolveActiveModelKey(vin, savedOverrides);
    const slot = modelSlot(savedOverrides, vin, activeKey);
    const prevHidden = { ...(slot.calloutsHidden ?? {}) };
    if (tpms3dHidden) {
      // Currently all 4 hidden → reveal them: drop the 4 keys.
      for (const k of TPMS_CALLOUT_KEYS) delete prevHidden[k];
    } else {
      // Hide all 4 in one go.
      for (const k of TPMS_CALLOUT_KEYS) prevHidden[k] = true;
    }
    const nextSlot = {
      ...slot,
      calloutsHidden:
        Object.keys(prevHidden).length > 0 ? prevHidden : undefined,
    };
    const blob = buildSavedBlob(
      savedOverrides,
      vin,
      activeKey,
      nextSlot,
      normalizeBlob(savedOverrides, vin).activeModelKey,
    );
    saveShowroom.mutate(blob);
  };

  const toggleLabel = tpms3dHidden
    ? t('home.tpms.show3d')
    : t('home.tpms.hide3d');

  return (
    <div className="px-3 sm:px-4 pt-2 pb-1">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="flex items-center gap-1.5 uppercase tracking-wider text-[#9ca3af] font-semibold">
          <span
            className={
              'w-1.5 h-1.5 rounded-full ' +
              (anyWarning ? 'bg-[#ef4444]' : 'bg-[#22c55e]')
            }
          />
          {t('home.tpms.title')}
          <button
            type="button"
            onClick={toggle3dTpms}
            disabled={!vehicle.carId || saveShowroom.isPending}
            title={toggleLabel}
            aria-label={toggleLabel}
            aria-pressed={tpms3dHidden}
            className={
              'ml-1 inline-flex items-center justify-center w-4 h-4 rounded ' +
              'border transition-colors ' +
              (tpms3dHidden
                ? 'border-[#374151] bg-[#1f2937] text-[#6b7280] hover:text-[#9ca3af] hover:border-[#4b5563]'
                : 'border-[#22c55e]/40 bg-[#0a1f0a] text-[#22c55e] hover:bg-[#0f2a0f] hover:border-[#22c55e]/70') +
              ' disabled:opacity-50 disabled:cursor-not-allowed'
            }
          >
            {tpms3dHidden ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </span>
        <div className="flex items-center gap-1 sm:gap-1.5 flex-1 justify-end">
          {slots.map(({ labelKey, pressure, warning }) => {
            // Colour vocabulary mirrors the in-3D TPMS callouts so the
            // user reads the same green / red language in both places.
            const noData = pressure == null && warning == null;
            const colorClass = noData
              ? 'text-[#6b7280] bg-[#0f0f0f] border-[#222]'
              : warning === true
                ? 'text-white bg-[#7f1d1d]/70 border-[#ef4444]/60'
                : 'text-white bg-[#0a1f0a] border-[#22c55e]/45';
            return (
              <div
                key={labelKey}
                className={
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ' +
                  'border font-mono tabular-nums text-[10px] ' +
                  colorClass
                }
              >
                <span className="opacity-60 uppercase">{t(labelKey)}</span>
                <span className="font-semibold">
                  {pressure != null ? u.fmtPressure(pressure) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Inline SVG icons — kept tiny (10×10) so the button stays the same
// visual weight as the title text it sits next to.
function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 12s4-7.5 10.5-7.5S22.5 12 22.5 12s-4 7.5-10.5 7.5S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.5 6.5A10.6 10.6 0 0 1 12 4.5c6.5 0 10.5 7.5 10.5 7.5a17.7 17.7 0 0 1-3.2 4.1" />
      <path d="M6.6 6.6A17.4 17.4 0 0 0 1.5 12s4 7.5 10.5 7.5a10.4 10.4 0 0 0 4.4-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
