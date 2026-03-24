import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPriceRules, getCostOverrides } from '../api/queries';
import { api } from '../api/client';
import StatCard from '../components/StatCard';
import type { PriceRule, CostOverride } from '../api/queries';

interface Props {
  carId: number | undefined;
}

export default function Costs({ carId }: Props) {
  const queryClient = useQueryClient();
  const [showAddRule, setShowAddRule] = useState(false);

  const { data: rules } = useQuery({
    queryKey: ['priceRules', carId],
    queryFn: () => getPriceRules(carId),
    enabled: !!carId,
  });

  const { data: overrides } = useQuery({
    queryKey: ['costOverrides', carId],
    queryFn: () => getCostOverrides(carId!),
    enabled: !!carId,
  });

  const deleteRule = useMutation({
    mutationFn: (id: number) => api(`/costs/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['priceRules'] }),
  });

  const totalCost = overrides?.reduce((sum, o) => sum + o.cost, 0) ?? 0;
  const sessionCount = overrides?.length ?? 0;
  const freeSessions = overrides?.filter((o) => o.isFree).length ?? 0;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Costs</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total cost" value={totalCost.toFixed(2)} unit="€" accent />
        <StatCard label="Sessions" value={sessionCount} />
        <StatCard label="Free sessions" value={freeSessions} color="#22c55e" />
        <StatCard
          label="Avg cost"
          value={sessionCount > 0 ? (totalCost / sessionCount).toFixed(2) : '—'}
          unit="€/session"
        />
      </div>

      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#9ca3af] uppercase tracking-wider">Price rules</span>
          <button
            onClick={() => setShowAddRule(!showAddRule)}
            className="bg-[#e31937] text-white text-sm px-4 py-2 rounded-lg min-h-[40px] active:bg-[#c0152f] transition-colors duration-150"
          >
            + Add rule
          </button>
        </div>

        {showAddRule && <AddRuleForm carId={carId} onDone={() => {
          setShowAddRule(false);
          queryClient.invalidateQueries({ queryKey: ['priceRules'] });
        }} />}

        <div className="space-y-2 mt-2">
          {(rules ?? []).map((rule) => (
            <div key={rule.id} className="flex items-center justify-between bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3">
              <div>
                <div className="text-sm font-medium">{rule.label}</div>
                <div className="text-xs text-[#9ca3af] mt-0.5">
                  {rule.pricePerKwh === 0 ? 'Free' : `${rule.pricePerKwh} €/kWh`}
                  {rule.timeStart && ` · ${rule.timeStart}–${rule.timeEnd}`}
                  {rule.locationName && ` · ${rule.locationName}`}
                  {rule.validFrom && ` · from ${new Date(rule.validFrom).toLocaleDateString()}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#6b7280]">P{rule.priority}</span>
                <button
                  onClick={() => deleteRule.mutate(rule.id)}
                  className="text-[#ef4444] text-xs px-2 py-1 rounded min-h-[32px] active:bg-[#ef4444]/10"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {(!rules || rules.length === 0) && (
            <p className="text-[#6b7280] text-sm text-center py-4">No price rules configured</p>
          )}
        </div>
      </div>

      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
        <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">Recent sessions cost</div>
        <div className="space-y-2">
          {(overrides ?? []).slice(0, 10).map((o) => (
            <div key={o.id} className="flex items-center justify-between bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3">
              <div className="text-sm">
                Session #{o.chargingProcessId}
                {o.isManualOverride && <span className="text-[#f59e0b] text-xs ml-2">Manual</span>}
                {o.isFree && <span className="text-[#22c55e] text-xs ml-2">Free</span>}
              </div>
              <span className="font-medium">{o.isFree ? 'Free' : `${o.cost.toFixed(2)} €`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddRuleForm({ carId, onDone }: { carId: number | undefined; onDone: () => void }) {
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');
  const [sourceType, setSourceType] = useState('home');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [locationName, setLocationName] = useState('');
  const [priority, setPriority] = useState('10');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api('/costs/rules', {
      method: 'POST',
      body: JSON.stringify({
        carId: carId ?? null,
        label,
        pricePerKwh: parseFloat(price) || 0,
        sourceType,
        locationName: locationName || null,
        timeStart: timeStart || null,
        timeEnd: timeEnd || null,
        priority: parseInt(priority) || 10,
      }),
    });
    onDone();
  };

  const inputClass =
    'bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px]';

  return (
    <form onSubmit={handleSubmit} className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input className={inputClass} placeholder="Label (e.g. Home night)" value={label} onChange={(e) => setLabel(e.target.value)} required />
        <input className={inputClass} placeholder="€/kWh (0 = free)" type="number" step="0.0001" value={price} onChange={(e) => setPrice(e.target.value)} required />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <select className={inputClass} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
          <option value="home">Home</option>
          <option value="supercharger">Supercharger</option>
          <option value="public">Public</option>
          <option value="free">Free</option>
          <option value="other">Other</option>
        </select>
        <input className={inputClass} placeholder="Start (22:00)" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
        <input className={inputClass} placeholder="End (06:00)" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input className={inputClass} placeholder="Location name (optional)" value={locationName} onChange={(e) => setLocationName(e.target.value)} />
        <input className={inputClass} placeholder="Priority (1=highest)" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="bg-[#e31937] text-white px-4 py-2 rounded-lg text-sm min-h-[40px] active:bg-[#c0152f]">
          Save rule
        </button>
        <button type="button" onClick={onDone} className="bg-[#2a2a2a] text-[#9ca3af] px-4 py-2 rounded-lg text-sm min-h-[40px]">
          Cancel
        </button>
      </div>
    </form>
  );
}
