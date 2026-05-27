import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import type { VehicleStatus } from '../api/queries';

interface Props {
  vehicle: VehicleStatus;
}

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
 */
export default function TpmsSummaryRow({ vehicle }: Props) {
  const { t } = useTranslation();
  const u = useUnits();

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
