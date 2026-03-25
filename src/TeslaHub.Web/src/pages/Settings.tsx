import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, getChargingLocations, getCarImageInfo } from '../api/queries';
import { useUnits } from '../hooks/useUnits';
import { api, logout } from '../api/client';
import { useNavigate } from 'react-router-dom';
import type { GlobalSettings, ChargingLocation } from '../api/queries';

interface Props {
  carId: number | undefined;
}

export default function Settings({ carId }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const u = useUnits();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: locations } = useQuery({
    queryKey: ['chargingLocations', carId],
    queryFn: () => getChargingLocations(carId),
  });
  const { data: imageInfo } = useQuery({
    queryKey: ['carImageInfo', carId],
    queryFn: () => getCarImageInfo(carId!),
    enabled: !!carId,
  });

  const [form, setForm] = useState<Partial<GlobalSettings>>({});
  const [teslaUrl, setTeslaUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = useMutation({
    mutationFn: () => api('/costs/settings', { method: 'PUT', body: JSON.stringify(form) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const deleteLocation = useMutation({
    mutationFn: (id: number) => api(`/costs/locations/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chargingLocations'] }),
  });

  const handleSaveTeslaUrl = async () => {
    if (!carId || !teslaUrl.trim()) return;

    if (!teslaUrl.includes('static-assets.tesla.com') || !teslaUrl.includes('compositor')) {
      setUrlError('Invalid URL. Must be a Tesla compositor URL.');
      return;
    }

    setUrlError('');
    setSaving(true);
    try {
      await api(`/vehicle/${carId}/image/compositor`, {
        method: 'PUT',
        body: JSON.stringify({ url: teslaUrl.trim() }),
      });
      queryClient.invalidateQueries({ queryKey: ['carImageInfo', carId] });
      setTeslaUrl('');
    } catch {
      setUrlError('Failed to download image. Check the URL.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!carId || file.size > 2 * 1024 * 1024) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = localStorage.getItem('teslahub_token');
      await fetch(`/api/vehicle/${carId}/image/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      queryClient.invalidateQueries({ queryKey: ['carImageInfo', carId] });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async () => {
    if (!carId) return;
    await api(`/vehicle/${carId}/image`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['carImageInfo', carId] });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const inputClass = 'bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#e31937] focus:outline-none min-h-[40px] w-full';

  const pricingLabel = (loc: ChargingLocation) => {
    if (loc.pricingType === 'home') {
      const parts = [];
      if (loc.peakPricePerKwh != null) parts.push(`HP: ${loc.peakPricePerKwh} ${u.currencySymbol}/kWh`);
      if (loc.offPeakPricePerKwh != null) parts.push(`HC: ${loc.offPeakPricePerKwh} ${u.currencySymbol}/kWh`);
      if (loc.offPeakStart && loc.offPeakEnd) parts.push(`${loc.offPeakStart}–${loc.offPeakEnd}`);
      return parts.join(' · ');
    }
    if (loc.pricingType === 'subscription') {
      return `${loc.monthlySubscription ?? 0} ${u.currencySymbol}/month`;
    }
    return 'Manual entry';
  };

  const pricingBadge = (type: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      home: { bg: 'bg-[#3b82f6]/20', text: 'text-[#3b82f6]', label: 'Home' },
      subscription: { bg: 'bg-[#8b5cf6]/20', text: 'text-[#8b5cf6]', label: 'Subscription' },
      manual: { bg: 'bg-[#9ca3af]/20', text: 'text-[#9ca3af]', label: 'Manual' },
    };
    const s = map[type] ?? map.manual;
    return <span className={`text-xs px-2 py-0.5 rounded ${s.bg} ${s.text}`}>{s.label}</span>;
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>

      {/* General settings */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-4">
        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">Currency</label>
          <select className={inputClass} value={form.currency ?? 'EUR'} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="EUR">EUR (€)</option>
            <option value="USD">USD ($)</option>
            <option value="GBP">GBP (£)</option>
            <option value="CHF">CHF</option>
            <option value="NOK">NOK (kr)</option>
            <option value="SEK">SEK (kr)</option>
            <option value="DKK">DKK (kr)</option>
            <option value="CAD">CAD (CA$)</option>
            <option value="AUD">AUD (A$)</option>
            <option value="NZD">NZD (NZ$)</option>
            <option value="PLN">PLN (zł)</option>
            <option value="CZK">CZK (Kč)</option>
            <option value="HUF">HUF (Ft)</option>
            <option value="CNY">CNY (¥)</option>
            <option value="JPY">JPY (¥)</option>
            <option value="KRW">KRW (₩)</option>
            <option value="ILS">ILS (₪)</option>
            <option value="AED">AED</option>
            <option value="SGD">SGD (S$)</option>
            <option value="HKD">HKD (HK$)</option>
            <option value="TWD">TWD (NT$)</option>
            <option value="THB">THB (฿)</option>
            <option value="MXN">MXN (MX$)</option>
            <option value="BRL">BRL (R$)</option>
            <option value="INR">INR (₹)</option>
            <option value="TRY">TRY (₺)</option>
            <option value="ZAR">ZAR (R)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">Unit of length</label>
          <select className={inputClass} value={form.unitOfLength ?? 'km'} onChange={(e) => setForm({ ...form, unitOfLength: e.target.value })}>
            <option value="km">Kilometers (km)</option>
            <option value="mi">Miles (mi)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">Temperature</label>
          <select className={inputClass} value={form.unitOfTemperature ?? 'C'} onChange={(e) => setForm({ ...form, unitOfTemperature: e.target.value })}>
            <option value="C">Celsius (°C)</option>
            <option value="F">Fahrenheit (°F)</option>
          </select>
        </div>
        <button onClick={() => save.mutate()} className="bg-[#e31937] text-white px-6 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f]">
          {save.isPending ? 'Saving...' : 'Save settings'}
        </button>
      </div>

      {/* Vehicle Image Section */}
      {carId && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider">Vehicle image</div>

          {imageInfo?.hasImage && (
            <div className="flex justify-center bg-[#0a0a0a] rounded-lg p-3">
              <img
                src={`/api/vehicle/${carId}/image?t=${Date.now()}`}
                alt="Vehicle"
                className="h-[120px] object-contain"
              />
            </div>
          )}

          {/* Tesla URL input */}
          <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
            <div className="text-xs text-[#9ca3af] font-medium">Import from Tesla account</div>
            <div className="text-xs text-[#6b7280] leading-relaxed space-y-1">
              <p>1. Go to <span className="text-white">tesla.com</span> and sign in</p>
              <p>2. Right-click on your car image</p>
              <p>3. Select <span className="text-white">"Copy image address"</span></p>
              <p>4. Paste the URL below</p>
            </div>
            <input
              className={inputClass}
              type="url"
              placeholder="https://static-assets.tesla.com/v1/compositor/..."
              value={teslaUrl}
              onChange={(e) => { setTeslaUrl(e.target.value); setUrlError(''); }}
            />
            {urlError && <p className="text-xs text-[#ef4444]">{urlError}</p>}
            <button
              onClick={handleSaveTeslaUrl}
              disabled={saving || !teslaUrl.trim()}
              className="bg-[#e31937] text-white px-6 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f] disabled:opacity-50 w-full"
            >
              {saving ? 'Downloading...' : 'Save image'}
            </button>
          </div>

          {/* Upload + Delete buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] text-white py-2 rounded-lg text-sm min-h-[44px] active:bg-[#2a2a2a] disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : 'Upload my photo'}
            </button>
            {imageInfo?.hasImage && (
              <button
                onClick={handleDeleteImage}
                className="px-4 bg-[#1a1a1a] border border-[#2a2a2a] text-[#ef4444] py-2 rounded-lg text-sm min-h-[44px] active:bg-[#2a2a2a]"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {/* Charging locations */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
        <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">Charging locations</div>
        <div className="space-y-2">
          {(locations ?? []).map((loc) => (
            <div key={loc.id} className="flex items-center justify-between bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium truncate">{loc.name}</span>
                  {pricingBadge(loc.pricingType)}
                </div>
                <div className="text-xs text-[#6b7280]">{pricingLabel(loc)}</div>
                <div className="text-xs text-[#4b5563] mt-0.5">Radius: {loc.radiusMeters}m</div>
              </div>
              <button
                onClick={() => deleteLocation.mutate(loc.id)}
                className="text-[#ef4444] text-xs px-2 py-1 rounded min-h-[32px] ml-2 active:bg-[#ef4444]/10"
              >
                Delete
              </button>
            </div>
          ))}
          {(!locations || locations.length === 0) && (
            <p className="text-[#6b7280] text-sm text-center py-4">
              No locations configured. Tap "Define this location" on a charging session to add one.
            </p>
          )}
        </div>
      </div>

      {/* About */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
        <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">About</div>
        <p className="text-sm text-[#9ca3af]">TeslaHub — TeslaMate companion app</p>
        <p className="text-xs text-[#6b7280] mt-1">Self-hosted, privacy-first</p>
      </div>

      <button onClick={handleLogout} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#ef4444] py-3 rounded-xl text-sm font-medium min-h-[48px] active:bg-[#2a2a2a]">
        Logout
      </button>
    </div>
  );
}
