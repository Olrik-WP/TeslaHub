import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import StatCard from '../components/StatCard';
import {
  getDatabaseInfo,
  getTableSizes,
  getTableRowCounts,
  getIndexStats,
  getDataStats,
} from '../api/queries';

type Tab = 'overview' | 'tables' | 'indexes';

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

export default function DatabaseInfo({ carId }: { carId?: number }) {
  const { t } = useTranslation();
  const u = useUnits();
  const [tab, setTab] = useState<Tab>('overview');

  const { data: dbInfo } = useQuery({
    queryKey: ['db-info'],
    queryFn: getDatabaseInfo,
    staleTime: 30 * 60_000,
  });

  const { data: tableSizes } = useQuery({
    queryKey: ['db-tables'],
    queryFn: getTableSizes,
    staleTime: 30 * 60_000,
    enabled: tab === 'overview' || tab === 'tables',
  });

  const { data: rowCounts } = useQuery({
    queryKey: ['db-rowcounts'],
    queryFn: getTableRowCounts,
    staleTime: 30 * 60_000,
    enabled: tab === 'tables',
  });

  const { data: indexStats } = useQuery({
    queryKey: ['db-indexes'],
    queryFn: getIndexStats,
    staleTime: 30 * 60_000,
    enabled: tab === 'indexes',
  });

  const { data: dataStats } = useQuery({
    queryKey: ['db-stats', carId],
    queryFn: () => getDataStats(carId!),
    enabled: !!carId,
    staleTime: 5 * 60_000,
  });

  const tabs: { key: Tab; labelKey: string }[] = [
    { key: 'overview', labelKey: 'databasePage.overviewTab' },
    { key: 'tables', labelKey: 'databasePage.tablesTab' },
    { key: 'indexes', labelKey: 'databasePage.indexesTab' },
  ];

  const hasIncomplete = dataStats && (dataStats.unclosedDrives > 0 || dataStats.unclosedCharges > 0);

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">{t('databasePage.title')}</h1>

      <div className="flex gap-1 bg-[#141414] rounded-xl p-1">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex-1 py-2 text-xs rounded-lg transition-colors ${
              tab === tb.key ? 'bg-[#2a2a2a] text-white' : 'text-[#9ca3af]'
            }`}
          >
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {/* Server Info Cards */}
      {dbInfo && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="PostgreSQL" value={dbInfo.postgresVersion} />
          <StatCard label={t('databasePage.totalSize')} value={fmtBytes(dbInfo.totalSizeBytes)} color="#3b82f6" />
          <StatCard label={t('databasePage.sharedBuffers')} value={fmtBytes(dbInfo.sharedBuffersBytes)} />
          <StatCard label={t('databasePage.timezone')} value={dbInfo.timezone} />
        </div>
      )}

      {/* Vehicle Data Stats */}
      {dataStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={t('databasePage.drives')} value={fmtNum(dataStats.driveCount)} color="#3b82f6" />
          <StatCard label={t('databasePage.charges')} value={fmtNum(dataStats.chargeCount)} color="#22c55e" />
          <StatCard label={t('databasePage.updates')} value={fmtNum(dataStats.updateCount)} color="#f59e0b" />
          <StatCard
            label={t('databasePage.odometer')}
            value={dataStats.odometerKm != null ? Math.round(u.convertDistance(dataStats.odometerKm)!).toLocaleString() : '—'}
            unit={u.distanceUnit}
          />
          <StatCard
            label={t('databasePage.totalLogged')}
            value={dataStats.totalDistanceKm != null ? Math.round(u.convertDistance(dataStats.totalDistanceKm)!).toLocaleString() : '—'}
            unit={u.distanceUnit}
          />
          <StatCard label={t('databasePage.firmware')} value={dataStats.currentFirmware ?? '—'} />
        </div>
      )}

      {/* Incomplete Data Warning */}
      {hasIncomplete && (
        <div className="bg-[#141414] border border-[#f59e0b]/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[#f59e0b] text-lg">⚠</span>
            <span className="font-medium text-[#f59e0b]">{t('databasePage.incompleteData')}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label={t('databasePage.unclosedDrives')}
              value={dataStats!.unclosedDrives}
              color={dataStats!.unclosedDrives > 0 ? '#ef4444' : '#22c55e'}
            />
            <StatCard
              label={t('databasePage.unclosedCharges')}
              value={dataStats!.unclosedCharges}
              color={dataStats!.unclosedCharges > 0 ? '#ef4444' : '#22c55e'}
            />
          </div>
        </div>
      )}

      {/* Tab: Overview - Table sizes */}
      {tab === 'overview' && tableSizes && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2a2a2a]">
            <h3 className="text-sm font-semibold text-white">{t('databasePage.tableSizes')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#9ca3af] border-b border-[#2a2a2a]">
                  <th className="text-left px-4 py-2 font-medium">{t('databasePage.table')}</th>
                  <th className="text-right px-4 py-2 font-medium">{t('databasePage.data')}</th>
                  <th className="text-right px-4 py-2 font-medium">{t('databasePage.indexesCol')}</th>
                  <th className="text-right px-4 py-2 font-medium">{t('databasePage.total')}</th>
                </tr>
              </thead>
              <tbody>
                {tableSizes.map((row) => (
                  <tr key={row.tableName} className="border-b border-[#1f1f1f] hover:bg-[#1a1a1a]">
                    <td className="px-4 py-2 text-white font-mono">{row.tableName}</td>
                    <td className="px-4 py-2 text-right text-[#9ca3af] tabular-nums">{fmtBytes(row.dataBytes)}</td>
                    <td className="px-4 py-2 text-right text-[#9ca3af] tabular-nums">{fmtBytes(row.indexBytes)}</td>
                    <td className="px-4 py-2 text-right text-white tabular-nums font-medium">{fmtBytes(row.totalBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Tables - Row counts */}
      {tab === 'tables' && rowCounts && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2a2a2a]">
            <h3 className="text-sm font-semibold text-white">{t('databasePage.rowCounts')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#9ca3af] border-b border-[#2a2a2a]">
                  <th className="text-left px-4 py-2 font-medium">{t('databasePage.table')}</th>
                  <th className="text-right px-4 py-2 font-medium">{t('databasePage.rows')}</th>
                </tr>
              </thead>
              <tbody>
                {rowCounts.map((row) => (
                  <tr key={row.tableName} className="border-b border-[#1f1f1f] hover:bg-[#1a1a1a]">
                    <td className="px-4 py-2 text-white font-mono">{row.tableName}</td>
                    <td className="px-4 py-2 text-right text-[#9ca3af] tabular-nums">{fmtNum(row.rowCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Indexes */}
      {tab === 'indexes' && indexStats && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2a2a2a]">
            <h3 className="text-sm font-semibold text-white">{t('databasePage.indexStats')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#9ca3af] border-b border-[#2a2a2a]">
                  <th className="text-left px-4 py-2 font-medium">{t('databasePage.table')}</th>
                  <th className="text-left px-4 py-2 font-medium">{t('databasePage.index')}</th>
                  <th className="text-right px-4 py-2 font-medium">{t('databasePage.scans')}</th>
                  <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">{t('databasePage.tuplesRead')}</th>
                  <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">{t('databasePage.tuplesFetched')}</th>
                  <th className="text-right px-4 py-2 font-medium">{t('databasePage.size')}</th>
                </tr>
              </thead>
              <tbody>
                {indexStats.map((row, i) => (
                  <tr key={i} className="border-b border-[#1f1f1f] hover:bg-[#1a1a1a]">
                    <td className="px-4 py-2 text-[#9ca3af] font-mono">{row.tableName}</td>
                    <td className="px-4 py-2 text-white font-mono text-[11px]">{row.indexName}</td>
                    <td className="px-4 py-2 text-right text-[#9ca3af] tabular-nums">{fmtNum(row.indexScans)}</td>
                    <td className="px-4 py-2 text-right text-[#9ca3af] tabular-nums hidden sm:table-cell">{fmtNum(row.tuplesRead)}</td>
                    <td className="px-4 py-2 text-right text-[#9ca3af] tabular-nums hidden sm:table-cell">{fmtNum(row.tuplesFetched)}</td>
                    <td className="px-4 py-2 text-right text-white tabular-nums">{fmtBytes(row.indexSizeBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
