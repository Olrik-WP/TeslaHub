import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ControlCard from './ControlCard';
import ControlButton from './ControlButton';
import { useControlMutation, type VehicleStateSnapshot } from '../../hooks/useVehicleControl';
import { readVehicle } from './stateParsers';

interface Props {
  vehicleId: number;
  snapshot: VehicleStateSnapshot | undefined;
  online: boolean;
}

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4M8 12l4 4 4-4" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </svg>
);

/**
 * Software update controls. The "Schedule update" Fleet command takes an
 * offset in seconds — we expose three sane presets to avoid asking the
 * user to type a number. The "Cancel" button has a confirmation dialog.
 *
 * Hidden when the car has no pending update (status != "available" /
 * "scheduled" / "downloading_wifi_wait" etc.).
 */
export default function SoftwareCard({ vehicleId, snapshot, online }: Props) {
  const { t } = useTranslation();
  const v = readVehicle(snapshot);
  const update = v.software_update;
  const status = update?.status?.toLowerCase() ?? '';

  const schedule = useControlMutation<{ offsetSec: number }>(vehicleId, 'software/schedule-update');
  const cancel = useControlMutation(vehicleId, 'software/cancel-update');

  const [confirmCancel, setConfirmCancel] = useState(false);

  // Tesla statuses worth surfacing.
  const hasPending = ['available', 'scheduled', 'downloading_wifi_wait', 'downloading'].includes(status);
  if (!hasPending && !update?.version) return null;

  const stateBadge = (
    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-[#f59e0b]/40 text-[#f59e0b] bg-[#f59e0b]/10">
      {t(`control.software.status.${status || 'unknown'}`, status)}
    </span>
  );

  return (
    <>
      <ControlCard title={t('control.software.title')} icon={ICON} badge={hasPending ? stateBadge : undefined}>
        {update?.version && (
          <p className="text-xs text-[#9ca3af] mb-3">
            {t('control.software.version')}: <span className="text-[#e0e0e0]">{update.version}</span>
          </p>
        )}

        {hasPending && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[
                { label: t('control.software.schedule.now'), offset: 60 },
                { label: t('control.software.schedule.in1h'), offset: 3600 },
                { label: t('control.software.schedule.in6h'), offset: 21600 },
              ].map((opt) => (
                <ControlButton
                  key={opt.offset}
                  label={opt.label}
                  onClick={() => schedule.mutate({ offsetSec: opt.offset })}
                  state="warning"
                  loading={schedule.isPending && (schedule.variables as { offsetSec?: number } | undefined)?.offsetSec === opt.offset}
                  wakingHint={schedule.wakingHint}
                  disabled={!online}
                />
              ))}
            </div>
            <ControlButton
              label={t('control.software.cancel')}
              onClick={() => setConfirmCancel(true)}
              state="danger"
              disabled={!online}
              fullWidth
              size="sm"
            />
          </>
        )}
      </ControlCard>

      {confirmCancel && (
        <ConfirmDialog
          title={t('control.software.cancelConfirm.title')}
          body={t('control.software.cancelConfirm.body')}
          confirmLabel={t('control.software.cancelConfirm.confirm')}
          cancelLabel={t('control.software.cancelConfirm.cancel')}
          loading={cancel.isPending}
          onConfirm={() => {
            cancel.mutate(undefined as never, { onSuccess: () => setConfirmCancel(false) });
          }}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
    </>
  );
}

function ConfirmDialog({ title, body, confirmLabel, cancelLabel, loading, onConfirm, onCancel }: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="w-full max-w-sm bg-[#141414] border border-[#2a2a2a] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-[#e0e0e0] mb-2">{title}</h3>
        <p className="text-sm text-[#9ca3af] mb-4">{body}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] text-sm"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg bg-[#e31937] text-white text-sm font-medium disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
