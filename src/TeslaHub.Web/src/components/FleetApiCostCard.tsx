import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getFleetApiUsage, type FleetApiUsageCategory } from '../api/queries';

interface Props {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}

/**
 * Settings card showing the locally-estimated Tesla Fleet API monthly
 * cost. Off by default — the user opts in with the toggle.
 *
 * Important: this is an estimate. Tesla doesn't publish a billing API,
 * so the only authoritative source remains
 * https://developer.tesla.com/dashboard/usage. The estimate counts every
 * billable request emitted by TeslaHub (HTTP status &lt; 500) and applies
 * the published per-category prices + the $10 small-developer credit.
 */
export default function FleetApiCostCard({ enabled, onToggle }: Props) {
  const { t } = useTranslation();

  // Refresh every 60s while the section is visible. The backend flushes
  // pending counts immediately on read, so the values shown are always
  // up-to-date with what TeslaHub has emitted.
  const { data } = useQuery({
    queryKey: ['fleetApiUsage'],
    queryFn: getFleetApiUsage,
    enabled,
    refetchInterval: enabled ? 60_000 : false,
    staleTime: 30_000,
  });

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-4">
      <div className="text-xs text-[#9ca3af] uppercase tracking-wider">
        {t('settings.fleetApiCost.title')}
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1 w-4 h-4 accent-[#e31937]"
        />
        <span className="flex-1">
          <span className="block text-sm font-medium text-white">
            {t('settings.fleetApiCost.toggle')}
          </span>
          <span className="block text-xs text-[#6b7280] mt-0.5">
            {t('settings.fleetApiCost.toggleHint')}
          </span>
        </span>
      </label>

      {enabled && data && (
        <div className="space-y-3">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-2">
            <Tile
              label={t('settings.fleetApiCost.gross')}
              value={`$${data.grossUsd.toFixed(2)}`}
              hint={data.yearMonth}
            />
            <Tile
              label={t('settings.fleetApiCost.net')}
              value={`$${data.netUsd.toFixed(2)}`}
              hint={t('settings.fleetApiCost.creditApplied', { credit: data.creditUsd.toFixed(0) })}
              highlight
            />
          </div>

          {/* Per-category breakdown */}
          <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[#141414] text-[#6b7280]">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">
                    {t('settings.fleetApiCost.category')}
                  </th>
                  <th className="text-right py-2 px-3 font-medium">
                    {t('settings.fleetApiCost.requests')}
                  </th>
                  <th className="text-right py-2 px-3 font-medium">
                    {t('settings.fleetApiCost.unitPrice')}
                  </th>
                  <th className="text-right py-2 px-3 font-medium">
                    {t('settings.fleetApiCost.subtotal')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c) => (
                  <CategoryRow key={c.category} c={c} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Previous month (optional) */}
          {data.previousMonth && (
            <div className="text-xs text-[#9ca3af]">
              {t('settings.fleetApiCost.previousMonth', {
                month: data.previousMonth.yearMonth,
                gross: data.previousMonth.grossUsd.toFixed(2),
                net: data.previousMonth.netUsd.toFixed(2),
              })}
            </div>
          )}

          {/* Disclaimer + link to Tesla portal */}
          <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 text-xs text-[#9ca3af] space-y-2">
            <p>{t('settings.fleetApiCost.disclaimer')}</p>
            <p>
              <a
                href="https://developer.tesla.com/dashboard/usage"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#e31937] hover:underline"
              >
                {t('settings.fleetApiCost.openDashboard')}
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={[
        'bg-[#0a0a0a] border rounded-lg p-3',
        highlight ? 'border-[#e31937]/40' : 'border-[#2a2a2a]',
      ].join(' ')}
    >
      <div className="text-[10px] uppercase tracking-wide text-[#6b7280] mb-1">{label}</div>
      <div className={`text-lg font-semibold ${highlight ? 'text-[#e31937]' : 'text-white'}`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-[#6b7280] mt-1">{hint}</div>}
    </div>
  );
}

function CategoryRow({ c }: { c: FleetApiUsageCategory }) {
  const { t } = useTranslation();
  const labelKey = `settings.fleetApiCost.categories.${c.category}`;
  return (
    <tr className="border-t border-[#2a2a2a]">
      <td className="py-2 px-3 text-white">{t(labelKey, c.category)}</td>
      <td className="py-2 px-3 text-right text-[#9ca3af]">
        {c.requestCount.toLocaleString()}
      </td>
      <td className="py-2 px-3 text-right text-[#6b7280]">
        ${c.unitPriceUsd.toFixed(4)}
      </td>
      <td className="py-2 px-3 text-right text-white">
        ${c.subtotalUsd.toFixed(2)}
      </td>
    </tr>
  );
}
