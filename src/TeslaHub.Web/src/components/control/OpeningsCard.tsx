import { useTranslation } from 'react-i18next';
import ControlCard from './ControlCard';
import ControlButton from './ControlButton';
import { useControlMutation, type VehicleCapabilities, type VehicleStateSnapshot } from '../../hooks/useVehicleControl';
import type { VehicleStatus } from '../../api/queries';
import { readVehicle } from './stateParsers';

interface Props {
  vehicleId: number;
  snapshot: VehicleStateSnapshot | undefined;
  vehicleStatus?: VehicleStatus;
  capabilities: VehicleCapabilities;
  online: boolean;
}

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h18M5 12V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M7 16v3M17 16v3" />
    <rect x="2" y="12" width="20" height="6" rx="2" />
  </svg>
);

/**
 * Trunks + windows. Capability-gated: hidden buttons when the car
 * does not have a motorised frunk / can't actuate trunks at all.
 */
export default function OpeningsCard({ vehicleId, snapshot, vehicleStatus, capabilities, online }: Props) {
  const { t } = useTranslation();
  const v = readVehicle(snapshot, vehicleStatus);

  const trunk = useControlMutation<{ which: string }>(vehicleId, 'access/trunk');
  const window = useControlMutation<{ command: string }>(vehicleId, 'access/window');

  const frunkOpen = (v.ft ?? 0) > 0;
  const trunkOpen = (v.rt ?? 0) > 0;
  const windowsOpen = [v.fd_window, v.fp_window, v.rd_window, v.rp_window].some((w) => (w ?? 0) > 0);

  if (!capabilities.canActuateTrunks) {
    return null;
  }

  return (
    <ControlCard title={t('control.openings.title')} icon={ICON}>
      <div className="grid grid-cols-2 gap-2">
        <ControlButton
          label={frunkOpen ? t('control.openings.frunkClose') : t('control.openings.frunkOpen')}
          onClick={() => trunk.mutate({ which: 'front' })}
          state={frunkOpen ? 'warning' : 'neutral'}
          loading={trunk.isPending && (trunk.variables as { which?: string } | undefined)?.which === 'front'}
          wakingHint={trunk.wakingHint}
          disabled={!online}
          icon={<TrunkIcon front />}
        />
        <ControlButton
          label={trunkOpen ? t('control.openings.trunkClose') : t('control.openings.trunkOpen')}
          onClick={() => trunk.mutate({ which: 'rear' })}
          state={trunkOpen ? 'warning' : 'neutral'}
          loading={trunk.isPending && (trunk.variables as { which?: string } | undefined)?.which === 'rear'}
          wakingHint={trunk.wakingHint}
          disabled={!online}
          icon={<TrunkIcon />}
        />
        <ControlButton
          label={t('control.openings.vent')}
          onClick={() => window.mutate({ command: 'vent' })}
          state={windowsOpen ? 'warning' : 'neutral'}
          loading={window.isPending && (window.variables as { command?: string } | undefined)?.command === 'vent'}
          wakingHint={window.wakingHint}
          disabled={!online}
          icon={<WindowIcon />}
        />
        <ControlButton
          label={t('control.openings.close')}
          onClick={() => window.mutate({ command: 'close' })}
          loading={window.isPending && (window.variables as { command?: string } | undefined)?.command === 'close'}
          wakingHint={window.wakingHint}
          disabled={!online}
          icon={<WindowIcon closed />}
        />
      </div>
    </ControlCard>
  );
}

function TrunkIcon({ front }: { front?: boolean } = {}) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13l2-6h14l2 6" />
      <rect x="2" y="13" width="20" height="6" rx="2" />
      {front ? <path d="M9 7l-1-2" /> : <path d="M15 7l1-2" />}
    </svg>
  );
}

function WindowIcon({ closed }: { closed?: boolean } = {}) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      {!closed && <path d="M4 12h16" />}
    </svg>
  );
}
