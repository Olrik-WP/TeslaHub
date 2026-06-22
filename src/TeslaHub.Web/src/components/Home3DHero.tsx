import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HomeBatteryBar from './HomeBatteryBar';
import HomeLoadSheddingStrip from './HomeLoadSheddingStrip';
import TpmsSummaryRow from './TpmsSummaryRow';
import type { VehicleStatus } from '../api/queries';

const VehicleTopView3D = lazy(() => import('./VehicleTopView3D'));

interface Props {
  vehicle: VehicleStatus;
}

/**
 * The premium 3D vehicle hero for Home, replacing the legacy PNG card
 * when the 3D viewer is available. Two visual blocks stacked:
 *
 *   1. The full interactive 3D viewer — large (340px mobile / 440px
 *      desktop), with the existing live callouts, animated cable, and
 *      lock/sentry badges all still active.
 *   2. A minimal battery bar — percentage, range, optional live kW,
 *      and a 1.5px progress track with chargeLimit tick.
 *
 * Everything else that used to live as overlays on the legacy hero
 * (vehicle name, VIN, max-speed, last-charge cost, drive stats) is
 * intentionally NOT here — it now sits in cards rendered below by the
 * Home page, so the hero stays focused on "the car" and "its energy".
 */
export default function Home3DHero({ vehicle }: Props) {
  const { t } = useTranslation();
  // Responsive height: smaller for narrow screens, larger for desktop.
  // We watch innerWidth instead of using Tailwind responsive classes
  // because the height value is a number passed as a prop to the 3D
  // viewer (Canvas needs a fixed pixel size).
  const [height, setHeight] = useState<number>(getResponsiveHeight());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setHeight(getResponsiveHeight());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isCharging =
    vehicle.chargingState === 'Charging' || vehicle.chargingState === 'Starting';

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
      <Suspense
        fallback={
          <div
            className="flex items-center justify-center text-[#6b7280] text-xs"
            style={{ height }}
          >
            {t('vehicleView.loading3d', 'Loading 3D model...')}
          </div>
        }
      >
        <VehicleTopView3D vehicle={vehicle} height={height} />
      </Suspense>
      {/* TPMS resumé strip — always-on chip-style fallback for users
          who hide the 3D wheel pills (or who simply prefer reading
          numbers in one place). Renders nothing for cars without TPMS. */}
      <TpmsSummaryRow vehicle={vehicle} />
      <HomeBatteryBar vehicle={vehicle} isCharging={isCharging} />
      {/* Live house power + last load-shedding decisions. Self-hides when
          load shedding isn't configured/reachable. */}
      <HomeLoadSheddingStrip vehicle={vehicle} />
    </div>
  );
}

function getResponsiveHeight(): number {
  if (typeof window === 'undefined') return 340;
  // Mobile/portrait: 340px keeps the car as the focal block while
  // letting the meta strip + drive stats sit above the fold on most
  // 6"+ phones AND giving the HomeQuickActions row a fighting chance
  // to stay visible without scrolling. Desktop bumps to 440px —
  // vitrine territory but slightly tighter than the original 480.
  return window.innerWidth >= 1024 ? 440 : 340;
}
