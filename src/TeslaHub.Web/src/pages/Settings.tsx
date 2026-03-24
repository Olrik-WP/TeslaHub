import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings } from '../api/queries';
import { api, logout } from '../api/client';
import { useNavigate } from 'react-router-dom';
import type { GlobalSettings } from '../api/queries';

export default function Settings() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  const [form, setForm] = useState<Partial<GlobalSettings>>({});

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = useMutation({
    mutationFn: () =>
      api('/costs/settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const inputClass =
    'bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px] w-full';

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>

      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-4">
        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">Currency</label>
          <select
            className={inputClass}
            value={form.currency ?? 'EUR'}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          >
            <option value="EUR">EUR (€)</option>
            <option value="USD">USD ($)</option>
            <option value="GBP">GBP (£)</option>
            <option value="CHF">CHF</option>
            <option value="NOK">NOK</option>
            <option value="SEK">SEK</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">Unit of length</label>
          <select
            className={inputClass}
            value={form.unitOfLength ?? 'km'}
            onChange={(e) => setForm({ ...form, unitOfLength: e.target.value })}
          >
            <option value="km">Kilometers (km)</option>
            <option value="mi">Miles (mi)</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">Temperature</label>
          <select
            className={inputClass}
            value={form.unitOfTemperature ?? 'C'}
            onChange={(e) => setForm({ ...form, unitOfTemperature: e.target.value })}
          >
            <option value="C">Celsius (°C)</option>
            <option value="F">Fahrenheit (°F)</option>
          </select>
        </div>

        <button
          onClick={() => save.mutate()}
          className="bg-[#e31937] text-white px-6 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f] transition-colors duration-150"
        >
          {save.isPending ? 'Saving...' : 'Save settings'}
        </button>
      </div>

      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
        <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">About</div>
        <p className="text-sm text-[#9ca3af]">TeslaHub — TeslaMate companion app</p>
        <p className="text-xs text-[#6b7280] mt-1">Self-hosted, privacy-first</p>
      </div>

      <button
        onClick={handleLogout}
        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#ef4444] py-3 rounded-xl text-sm font-medium min-h-[48px] active:bg-[#2a2a2a] transition-colors duration-150"
      >
        Logout
      </button>
    </div>
  );
}
