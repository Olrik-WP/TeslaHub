import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';

interface DriveStats {
  driveCount: number;
  totalDays: number;
  totalMileageKm: number;
  totalDistanceKm: number;
  totalNetEnergyKwh: number;
  medianDistanceKm: number | null;
}

interface MonthlyCost {
  totalCost: number;
}

interface Props {
  driveStats: DriveStats | null | undefined;
  monthlyCost: MonthlyCost | null | undefined;
  currencySymbol: string;
}

/**
 * Drive statistics card extracted from the legacy hero. Two compact
 * rows on a single card, replacing the borders-only embed the old
 * hero used. Lives between the 3D hero and the quick-actions strip
 * when 3D is available; when it's not, the legacy hero still owns
 * these stats (no behaviour change for the PNG fallback path).
 */
export default function HomeDriveStatsCard({
  driveStats,
  monthlyCost,
  currencySymbol,
}: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const u = useUnits();

  if (!driveStats || driveStats.driveCount <= 0) return null;

  const median = driveStats.medianDistanceKm;
  const distPerDay = driveStats.totalDistanceKm / driveStats.totalDays;
  const kwhPerDay = driveStats.totalNetEnergyKwh / driveStats.totalDays;
  const estMonthly = driveStats.totalMileageKm / driveStats.totalDays * (365 / 12);
  const estAnnual = driveStats.totalMileageKm / driveStats.totalDays * 365;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
      <div className="grid grid-cols-3 border-b border-[#2a2a2a]">
        <Stat
          label={t('home.medianDist')}
          value={median != null ? u.fmtDist(median) : '—'}
          unit={u.distanceUnit}
        />
        <Stat
          label={t('home.avgDistDay')}
          value={u.fmtDist(distPerDay)}
          unit={u.distanceUnit}
          bordered
        />
        <Stat
          label={t('home.avgKwhDay')}
          value={kwhPerDay.toFixed(1)}
          unit="kWh"
        />
      </div>
      <div className="grid grid-cols-4">
        <Stat
          label={t('home.estMonthly')}
          value={Math.round(u.convertDistance(estMonthly)!).toLocaleString()}
          unit={u.distanceUnit}
        />
        <Stat
          label={t('home.costThisMonth')}
          value={monthlyCost ? monthlyCost.totalCost.toFixed(2) : '—'}
          unit={currencySymbol}
          color="#eab308"
          bordered
          onClick={() => navigate('/costs')}
        />
        <Stat
          label={`${driveStats.driveCount} ${t('home.trips')}`}
          value={Math.round(driveStats.totalDays)}
          unit={t('home.days')}
          bordered={false}
          rightBordered
        />
        <Stat
          label={t('home.estAnnual')}
          value={Math.round(u.convertDistance(estAnnual)!).toLocaleString()}
          unit={u.distanceUnit}
        />
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string | number;
  unit: string;
  color?: string;
  bordered?: boolean;
  rightBordered?: boolean;
  onClick?: () => void;
}

function Stat({
  label,
  value,
  unit,
  color = '#e31937',
  bordered = false,
  rightBordered = false,
  onClick,
}: StatProps) {
  return (
    <div
      className={[
        'px-2 sm:px-3 py-2 text-center',
        bordered ? 'border-x border-[#2a2a2a]' : '',
        rightBordered ? 'border-r border-[#2a2a2a]' : '',
        onClick ? 'cursor-pointer active:bg-[#1a1a1a]' : '',
      ].join(' ')}
      onClick={onClick}
    >
      <div className="text-[10px] sm:text-xs text-[#9ca3af] uppercase tracking-wider">{label}</div>
      <div className="text-sm sm:text-base font-bold tabular-nums" style={{ color }}>
        {value}{' '}
        <span className="text-[10px] sm:text-[11px] font-normal text-[#9ca3af]">{unit}</span>
      </div>
    </div>
  );
}
