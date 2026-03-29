import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, getChargingLocations, getCarImageInfo } from '../api/queries';
import { useUnits } from '../hooks/useUnits';
import { api, logout } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';
import type { GlobalSettings, ChargingLocation } from '../api/queries';
import CustomSelect from '../components/CustomSelect';

interface Props {
  carId: number | undefined;
}

export default function Settings({ carId }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const u = useUnits();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: latestVersion } = useQuery({
    queryKey: ['latestVersion'],
    queryFn: async () => {
      const res = await fetch('https://api.github.com/repos/Olrik-WP/TeslaHub/releases/latest');
      if (!res.ok) return null;
      const data = await res.json();
      return (data.tag_name as string)?.replace(/^v/, '') ?? null;
    },
    staleTime: 60 * 60_000,
    retry: false,
  });
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
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = useMutation({
    mutationFn: () => api('/costs/settings', { method: 'PUT', body: JSON.stringify(form) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; pricingType: string; peakPrice: string; offPeakPrice: string;
    offPeakStart: string; offPeakEnd: string; monthlyAmount: string; radius: string;
  }>({ name: '', pricingType: 'manual', peakPrice: '', offPeakPrice: '', offPeakStart: '22:00', offPeakEnd: '06:00', monthlyAmount: '', radius: '200' });

  const invalidateLocationCaches = () => {
    queryClient.invalidateQueries({ queryKey: ['chargingLocations'] });
    queryClient.invalidateQueries({ queryKey: ['costOverrides'] });
    queryClient.invalidateQueries({ queryKey: ['chargingSessions'] });
  };

  const deleteLocation = useMutation({
    mutationFn: (id: number) => api(`/costs/locations/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateLocationCaches(),
  });

  const updateLocation = useMutation({
    mutationFn: (loc: ChargingLocation) => api(`/costs/locations/${loc.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: editForm.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        radiusMeters: parseInt(editForm.radius) || 200,
        pricingType: editForm.pricingType,
        peakPricePerKwh: editForm.peakPrice ? parseFloat(editForm.peakPrice) : null,
        offPeakPricePerKwh: editForm.offPeakPrice ? parseFloat(editForm.offPeakPrice) : null,
        offPeakStart: editForm.pricingType === 'home' ? editForm.offPeakStart : null,
        offPeakEnd: editForm.pricingType === 'home' ? editForm.offPeakEnd : null,
        monthlySubscription: editForm.monthlyAmount ? parseFloat(editForm.monthlyAmount) : null,
        carId: loc.carId,
      }),
    }),
    onSuccess: () => {
      invalidateLocationCaches();
      setEditingId(null);
    },
  });

  const startEdit = (loc: ChargingLocation) => {
    setEditingId(loc.id);
    setEditForm({
      name: loc.name,
      pricingType: loc.pricingType,
      peakPrice: loc.peakPricePerKwh?.toString() ?? '',
      offPeakPrice: loc.offPeakPricePerKwh?.toString() ?? '',
      offPeakStart: loc.offPeakStart ?? '22:00',
      offPeakEnd: loc.offPeakEnd ?? '06:00',
      monthlyAmount: loc.monthlySubscription?.toString() ?? '',
      radius: loc.radiusMeters.toString(),
    });
  };

  const handleSaveTeslaUrl = async () => {
    if (!carId || !teslaUrl.trim()) return;

    if (!teslaUrl.includes('static-assets.tesla.com') || !teslaUrl.includes('compositor')) {
      setUrlError(t('settings.invalidUrl'));
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
      setUrlError(t('settings.downloadFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!carId || file.size > 5 * 1024 * 1024) return;
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
    return t('settings.manualEntry');
  };

  const pricingBadge = (type: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      home: { bg: 'bg-[#3b82f6]/20', text: 'text-[#3b82f6]', label: t('settings.home') },
      subscription: { bg: 'bg-[#8b5cf6]/20', text: 'text-[#8b5cf6]', label: t('charging.subscription') },
      manual: { bg: 'bg-[#9ca3af]/20', text: 'text-[#9ca3af]', label: t('charging.manual') },
    };
    const s = map[type] ?? map.manual;
    return <span className={`text-xs px-2 py-0.5 rounded ${s.bg} ${s.text}`}>{s.label}</span>;
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">{t('settings.title')}</h1>

      {/* General settings */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-4">
        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">{t('settings.currency')}</label>
          <CustomSelect
            value={form.currency ?? 'EUR'}
            onChange={(v) => setForm({ ...form, currency: v })}
            options={[
              { value: 'EUR', label: 'EUR (€)' }, { value: 'USD', label: 'USD ($)' },
              { value: 'GBP', label: 'GBP (£)' }, { value: 'CHF', label: 'CHF' },
              { value: 'NOK', label: 'NOK (kr)' }, { value: 'SEK', label: 'SEK (kr)' },
              { value: 'DKK', label: 'DKK (kr)' }, { value: 'CAD', label: 'CAD (CA$)' },
              { value: 'AUD', label: 'AUD (A$)' }, { value: 'NZD', label: 'NZD (NZ$)' },
              { value: 'PLN', label: 'PLN (zł)' }, { value: 'CZK', label: 'CZK (Kč)' },
              { value: 'HUF', label: 'HUF (Ft)' }, { value: 'CNY', label: 'CNY (¥)' },
              { value: 'JPY', label: 'JPY (¥)' }, { value: 'KRW', label: 'KRW (₩)' },
              { value: 'ILS', label: 'ILS (₪)' }, { value: 'AED', label: 'AED' },
              { value: 'SGD', label: 'SGD (S$)' }, { value: 'HKD', label: 'HKD (HK$)' },
              { value: 'TWD', label: 'TWD (NT$)' }, { value: 'THB', label: 'THB (฿)' },
              { value: 'MXN', label: 'MXN (MX$)' }, { value: 'BRL', label: 'BRL (R$)' },
              { value: 'INR', label: 'INR (₹)' }, { value: 'TRY', label: 'TRY (₺)' },
              { value: 'ZAR', label: 'ZAR (R)' },
            ]}
          />
        </div>
        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">{t('settings.unitOfLength')}</label>
          <CustomSelect
            value={form.unitOfLength ?? 'km'}
            onChange={(v) => setForm({ ...form, unitOfLength: v })}
            options={[
              { value: 'km', label: t('settings.km') },
              { value: 'mi', label: t('settings.mi') },
            ]}
          />
        </div>
        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">{t('settings.temperature')}</label>
          <CustomSelect
            value={form.unitOfTemperature ?? 'C'}
            onChange={(v) => setForm({ ...form, unitOfTemperature: v })}
            options={[
              { value: 'C', label: t('settings.celsius') },
              { value: 'F', label: t('settings.fahrenheit') },
            ]}
          />
        </div>
        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">{t('settings.costSource')}</label>
          <CustomSelect
            value={form.costSource ?? 'teslahub'}
            onChange={(v) => setForm({ ...form, costSource: v })}
            options={[
              { value: 'teslahub', label: t('settings.teslahubManual') },
              { value: 'teslamate', label: t('settings.teslaMateGeofence') },
            ]}
          />
          <p className="text-xs text-[#6b7280] mt-1">
            {(form.costSource ?? 'teslahub') === 'teslahub'
              ? t('settings.costSourceTeslahub')
              : t('settings.costSourceTeslamate')}
          </p>
        </div>
        <div>
          <label className="text-xs text-[#9ca3af] uppercase tracking-wider block mb-1">{t('settings.language')}</label>
          <CustomSelect
            value={i18n.language}
            onChange={(v) => {
              i18n.changeLanguage(v);
              localStorage.setItem('teslahub_lang', v);
            }}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          />
        </div>
        <button onClick={() => save.mutate()} className="bg-[#e31937] text-white px-6 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f]">
          {save.isPending ? t('settings.saving') : t('settings.saveSettings')}
        </button>
      </div>

      {/* Vehicle Image Section */}
      {carId && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-4">
          <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('settings.vehicleImage')}</div>

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
            <div className="text-xs text-[#9ca3af] font-medium">{t('settings.importTesla')}</div>
            <div className="text-xs text-[#6b7280] leading-relaxed space-y-1">
              <p>{t('settings.step1')}</p>
              <p>{t('settings.step2')}</p>
              <p>{t('settings.step3')}</p>
              <p>{t('settings.step4')}</p>
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
              {saving ? t('settings.downloading') : t('settings.saveImage')}
            </button>
          </div>

          {/* Upload + Delete buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] text-white py-2 rounded-lg text-sm min-h-[44px] active:bg-[#2a2a2a] disabled:opacity-50"
            >
              {uploading ? t('settings.uploading') : t('settings.uploadPhoto')}
            </button>
            {imageInfo?.hasImage && (
              <button
                onClick={handleDeleteImage}
                className="px-4 bg-[#1a1a1a] border border-[#2a2a2a] text-[#ef4444] py-2 rounded-lg text-sm min-h-[44px] active:bg-[#2a2a2a]"
              >
                {t('settings.remove')}
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
        <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">{t('settings.chargingLocations')}</div>
        <div className="space-y-2">
          {(locations ?? []).map((loc) => (
            <div key={loc.id} className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium truncate">{loc.name}</span>
                    {pricingBadge(loc.pricingType)}
                  </div>
                  <div className="text-xs text-[#6b7280]">{pricingLabel(loc)}</div>
                  <div className="text-xs text-[#4b5563] mt-0.5">{t('settings.radiusLine', { meters: loc.radiusMeters })}</div>
                </div>
                <div className="flex gap-1 ml-2">
                  <button
                    onClick={() => editingId === loc.id ? setEditingId(null) : startEdit(loc)}
                    className="text-[#3b82f6] text-xs px-2 py-1 rounded min-h-[32px] active:bg-[#3b82f6]/10"
                  >
                    {editingId === loc.id ? t('charging.cancel') : t('settings.edit')}
                  </button>
                  <button
                    onClick={() => deleteLocation.mutate(loc.id)}
                    disabled={deleteLocation.isPending}
                    className="text-[#ef4444] text-xs px-2 py-1 rounded min-h-[32px] active:bg-[#ef4444]/10"
                  >
                    {t('settings.delete')}
                  </button>
                </div>
              </div>

              {editingId === loc.id && (
                <div className="mt-3 pt-3 border-t border-[#2a2a2a] space-y-3">
                  <input className={inputClass} placeholder={t('charging.locationName')} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />

                  <div className="flex gap-2">
                    {(['manual', 'home', 'subscription'] as const).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => setEditForm({ ...editForm, pricingType: pt })}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium min-h-[40px] transition-colors ${
                          editForm.pricingType === pt ? 'bg-[#e31937] text-white' : 'bg-[#1a1a1a] text-[#9ca3af]'
                        }`}
                      >
                        {pt === 'manual' ? t('charging.manual') : pt === 'home' ? t('charging.homeHcHp') : t('charging.subscription')}
                      </button>
                    ))}
                  </div>

                  {editForm.pricingType === 'home' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <input className={inputClass} type="number" step="0.0001" placeholder={`${t('charging.peak')} ${u.currencySymbol}/kWh`} value={editForm.peakPrice} onChange={(e) => setEditForm({ ...editForm, peakPrice: e.target.value })} />
                        <input className={inputClass} type="number" step="0.0001" placeholder={`${t('charging.offPeak')} ${u.currencySymbol}/kWh`} value={editForm.offPeakPrice} onChange={(e) => setEditForm({ ...editForm, offPeakPrice: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input className={inputClass} type="time" value={editForm.offPeakStart} onChange={(e) => setEditForm({ ...editForm, offPeakStart: e.target.value })} />
                        <input className={inputClass} type="time" value={editForm.offPeakEnd} onChange={(e) => setEditForm({ ...editForm, offPeakEnd: e.target.value })} />
                      </div>
                    </>
                  )}

                  {editForm.pricingType === 'subscription' && (
                    <input className={inputClass} type="number" step="0.01" placeholder={`${t('charging.monthlyAmount')} (${u.currencySymbol})`} value={editForm.monthlyAmount} onChange={(e) => setEditForm({ ...editForm, monthlyAmount: e.target.value })} />
                  )}

                  <input className={inputClass} type="number" placeholder={t('charging.radius')} value={editForm.radius} onChange={(e) => setEditForm({ ...editForm, radius: e.target.value })} />

                  <div className="flex gap-2">
                    <button
                      onClick={() => updateLocation.mutate(loc)}
                      disabled={updateLocation.isPending}
                      className="bg-[#3b82f6] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[40px] active:bg-[#2563eb] transition-colors"
                    >
                      {updateLocation.isPending ? t('charging.savingLocation') : t('charging.updateLocation')}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="bg-[#2a2a2a] text-[#9ca3af] px-4 py-2 rounded-lg text-sm min-h-[40px]"
                    >
                      {t('charging.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {(!locations || locations.length === 0) && (
            <p className="text-[#6b7280] text-sm text-center py-4">
              {t('settings.noLocations')}
            </p>
          )}
        </div>
      </div>

      {/* Change password */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 space-y-3">
        <div className="text-xs text-[#9ca3af] uppercase tracking-wider">{t('settings.changePassword')}</div>
        <input
          className={inputClass}
          type="password"
          placeholder={t('settings.currentPassword')}
          autoComplete="current-password"
          value={currentPw}
          onChange={(e) => { setCurrentPw(e.target.value); setPwMsg(null); }}
        />
        <input
          className={inputClass}
          type="password"
          placeholder={t('settings.newPassword')}
          autoComplete="new-password"
          value={newPw}
          onChange={(e) => { setNewPw(e.target.value); setPwMsg(null); }}
        />
        <input
          className={inputClass}
          type="password"
          placeholder={t('settings.confirmNewPassword')}
          autoComplete="new-password"
          value={confirmPw}
          onChange={(e) => { setConfirmPw(e.target.value); setPwMsg(null); }}
        />
        {pwMsg && (
          <p className={`text-xs ${pwMsg.ok ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>{pwMsg.text}</p>
        )}
        <button
          disabled={pwSaving || !currentPw || !newPw || !confirmPw}
          onClick={async () => {
            if (newPw.length < 6) { setPwMsg({ text: t('settings.pwMinLength'), ok: false }); return; }
            if (newPw !== confirmPw) { setPwMsg({ text: t('settings.pwMismatch'), ok: false }); return; }
            setPwSaving(true);
            try {
              await api('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
              });
              setPwMsg({ text: t('settings.pwChanged'), ok: true });
              setCurrentPw(''); setNewPw(''); setConfirmPw('');
            } catch {
              setPwMsg({ text: t('settings.pwIncorrect'), ok: false });
            } finally {
              setPwSaving(false);
            }
          }}
          className="bg-[#e31937] text-white px-6 py-2 rounded-lg text-sm font-medium min-h-[44px] active:bg-[#c0152f] disabled:opacity-50 w-full"
        >
          {pwSaving ? t('settings.saving') : t('settings.changePassword')}
        </button>
      </div>

      {/* About */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
        <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">{t('settings.about')}</div>
        <p className="text-sm text-[#9ca3af]">{t('settings.aboutDesc')}</p>
        <p className="text-xs text-[#6b7280] mt-1">{t('settings.aboutSub')}</p>
        <a
          href="https://github.com/teslamate-org/teslamate"
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-[#6b7280] mt-2 hover:text-[#9ca3af] transition-colors"
        >
          {t('settings.poweredBy')}
        </a>
        <div className="mt-3 pt-3 border-t border-[#2a2a2a] flex items-center justify-between text-xs text-[#6b7280]">
          <span>AGPLv3 — © 2026 TeslaHub</span>
          <a
            href="https://github.com/Olrik-WP/TeslaHub"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#3b82f6] hover:underline"
          >
            Source code
          </a>
        </div>
        <div className="mt-2 text-xs text-[#4b5563] flex items-center justify-between">
          <span>v{__APP_VERSION__}</span>
          {latestVersion && latestVersion !== __APP_VERSION__ && __APP_VERSION__ !== 'dev' && (
            <a
              href={`https://github.com/Olrik-WP/TeslaHub/releases/tag/v${latestVersion}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#22c55e] hover:underline"
            >
              {t('settings.newVersionAvailable', { version: latestVersion })}
            </a>
          )}
        </div>
      </div>

      <button onClick={handleLogout} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#ef4444] py-3 rounded-xl text-sm font-medium min-h-[48px] active:bg-[#2a2a2a]">
        {t('auth.logout')}
      </button>
    </div>
  );
}
