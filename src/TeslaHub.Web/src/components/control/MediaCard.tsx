import { useTranslation } from 'react-i18next';
import ControlCard from './ControlCard';
import ControlButton from './ControlButton';
import { useControlMutation } from '../../hooks/useVehicleControl';

interface Props {
  vehicleId: number;
  online: boolean;
}

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

/**
 * Media controls. Volume +/- only — Tesla also exposes adjust_volume
 * with a numeric value but the OS-level volume slider on the car has
 * its own scale and snapping it from a web app is awkward, so we
 * stick to the discrete buttons that mirror what the steering wheel
 * scroller does.
 */
export default function MediaCard({ vehicleId, online }: Props) {
  const { t } = useTranslation();

  const play = useControlMutation(vehicleId, 'media/play');
  const next = useControlMutation(vehicleId, 'media/next');
  const prev = useControlMutation(vehicleId, 'media/prev');
  const nextFav = useControlMutation(vehicleId, 'media/next-fav');
  const prevFav = useControlMutation(vehicleId, 'media/prev-fav');
  const volUp = useControlMutation(vehicleId, 'media/volume-up');
  const volDn = useControlMutation(vehicleId, 'media/volume-down');

  return (
    <ControlCard title={t('control.media.title')} icon={ICON}>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <ControlButton label={t('control.media.prev')} onClick={() => prev.mutate(undefined as never)} loading={prev.isPending} disabled={!online} icon={<SkipIcon back />} />
        <ControlButton label={t('control.media.play')} onClick={() => play.mutate(undefined as never)} loading={play.isPending} disabled={!online} icon={<PlayIcon />} />
        <ControlButton label={t('control.media.next')} onClick={() => next.mutate(undefined as never)} loading={next.isPending} disabled={!online} icon={<SkipIcon />} />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <ControlButton label={t('control.media.volumeDown')} onClick={() => volDn.mutate(undefined as never)} loading={volDn.isPending} disabled={!online} icon={<VolIcon down />} />
        <ControlButton label={t('control.media.volumeUp')} onClick={() => volUp.mutate(undefined as never)} loading={volUp.isPending} disabled={!online} icon={<VolIcon />} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ControlButton label={t('control.media.prevFav')} onClick={() => prevFav.mutate(undefined as never)} loading={prevFav.isPending} disabled={!online} size="sm" icon={<StarIcon />} />
        <ControlButton label={t('control.media.nextFav')} onClick={() => nextFav.mutate(undefined as never)} loading={nextFav.isPending} disabled={!online} size="sm" icon={<StarIcon />} />
      </div>
    </ControlCard>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8V4z" /></svg>
  );
}
function SkipIcon({ back }: { back?: boolean } = {}) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={back ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M5 4l9 8-9 8V4zM18 5h2v14h-2z" />
    </svg>
  );
}
function VolIcon({ down }: { down?: boolean } = {}) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10v4h4l5 4V6L7 10H3z" fill="currentColor" />
      {down ? <path d="M16 12h6" /> : <path d="M16 12h6M19 9v6" />}
    </svg>
  );
}
function StarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.9 7.1.6-5.4 4.9 1.7 7.1L12 17.8 5.7 21.5l1.7-7.1L2 9.5l7.1-.6L12 2z" /></svg>
  );
}
