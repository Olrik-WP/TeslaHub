import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getUpdatesList } from '../api/queries';
import StatCard from '../components/StatCard';

function fmtDuration(min: number | null) {
  if (min == null) return '—';
  if (min < 60) return `${Math.round(min)}m`;
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
}

function fmtInterval(days: number | null) {
  if (days == null) return '—';
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  return `${(days / 30).toFixed(1)} mo`;
}

export default function Updates({ carId }: { carId?: number }) {
  const { t } = useTranslation();

  const { data } = useQuery({
    queryKey: ['updates', carId],
    queryFn: () => getUpdatesList(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  if (!carId) return null;

  const items = data?.items ?? [];
  const stats = data?.stats;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">{t('updatesPage.title')}</h1>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label={t('updatesPage.totalUpdates')} value={stats.totalCount} color="#3b82f6" />
          <StatCard label={t('updatesPage.medianInterval')} value={fmtInterval(stats.medianIntervalDays)} color="#f97316" />
          <StatCard label={t('updatesPage.currentVersion')} value={stats.currentVersion ?? '—'} color="#22c55e" />
        </div>
      )}

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white truncate">💾 {item.version}</div>
                <div className="text-xs text-[#9ca3af] mt-0.5">
                  {new Date(item.startDate).toLocaleDateString()} — {fmtDuration(item.durationMin)}
                </div>
              </div>
              {item.sinceLastDays != null && (
                <div className="text-xs text-[#9ca3af] ml-2 text-right whitespace-nowrap">
                  +{fmtInterval(item.sinceLastDays)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center text-[#9ca3af] py-12">{t('updatesPage.noData')}</div>
      )}
    </div>
  );
}
