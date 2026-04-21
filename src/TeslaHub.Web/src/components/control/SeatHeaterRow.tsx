import { useTranslation } from 'react-i18next';
import { useControlMutation } from '../../hooks/useVehicleControl';

interface Props {
  vehicleId: number;
  /** Current level (0..3) we read from climate_state.seat_heater_<seat>. */
  currentLevel?: number;
  /** Tesla seat code per pkg/proxy/command.go: 0..8. */
  position: number;
  label: string;
}

/**
 * Single seat heater row: label + 4 segmented buttons (0/1/2/3).
 * Tap a level to set it; backend handles the wake-and-retry. We
 * locally optimistically highlight the chosen level for snappy UX
 * and rely on the next state refresh to confirm.
 */
export default function SeatHeaterRow({ vehicleId, currentLevel, position, label }: Props) {
  const { t } = useTranslation();
  const mutation = useControlMutation<{ position: number; level: number }>(vehicleId, 'climate/seat-heater', { silent: true });

  const setLevel = (level: number) => mutation.mutate({ position, level });
  const active = (mutation.variables as { level?: number } | undefined)?.level ?? currentLevel ?? 0;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#9ca3af] flex-1 truncate">{label}</span>
      <div className="flex gap-1" role="group" aria-label={t('control.climate.seatHeaterLevel')}>
        {[0, 1, 2, 3].map((lvl) => {
          const isActive = active === lvl;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevel(lvl)}
              disabled={mutation.isPending}
              className={[
                'w-9 h-9 rounded-lg text-xs font-medium border transition-colors',
                isActive
                  ? 'bg-[#e31937] border-[#e31937] text-white'
                  : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] active:bg-[#222]',
                mutation.isPending ? 'opacity-60' : '',
              ].join(' ')}
              style={{ touchAction: 'manipulation' }}
              aria-pressed={isActive}
            >
              {lvl}
            </button>
          );
        })}
      </div>
    </div>
  );
}
