import { useQuery } from '@tanstack/react-query';
import { getSettings } from '../api/queries';

const KM_TO_MI = 0.621371;

export function useUnits() {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: 5 * 60_000,
  });

  const isMi = settings?.unitOfLength === 'mi';
  const isF = settings?.unitOfTemperature === 'F';
  const isPsi = settings?.unitOfPressure === 'psi';
  const currency = settings?.currency ?? 'EUR';

  const CURRENCY_SYMBOLS: Record<string, string> = {
    EUR: '€', USD: '$', GBP: '£', CHF: 'CHF',
    NOK: 'kr', SEK: 'kr', DKK: 'kr',
    CAD: 'CA$', AUD: 'A$', NZD: 'NZ$',
    PLN: 'zł', CZK: 'Kč', HUF: 'Ft',
    CNY: '¥', JPY: '¥', KRW: '₩',
    ILS: '₪', AED: 'AED', SGD: 'S$', HKD: 'HK$',
    TWD: 'NT$', THB: '฿', MXN: 'MX$', BRL: 'R$',
    INR: '₹', TRY: '₺', ZAR: 'R',
  };
  const currencySymbol = CURRENCY_SYMBOLS[currency] ?? currency;

  const distanceUnit = isMi ? 'mi' : 'km';
  const speedUnit = isMi ? 'mph' : 'km/h';
  const tempUnit = isF ? '°F' : '°C';
  const pressureUnit = isPsi ? 'psi' : 'bar';
  const consumptionUnit = isMi ? 'kWh/100mi' : 'kWh/100km';

  const convertDistance = (km: number | null | undefined): number | null => {
    if (km == null) return null;
    return isMi ? km * KM_TO_MI : km;
  };

  const convertSpeed = (kmh: number | null | undefined): number | null => {
    if (kmh == null) return null;
    return isMi ? kmh * KM_TO_MI : kmh;
  };

  const convertTemp = (celsius: number | null | undefined): number | null => {
    if (celsius == null) return null;
    return isF ? celsius * 9 / 5 + 32 : celsius;
  };

  const BAR_TO_PSI = 14.5038;
  const convertPressure = (bar: number | null | undefined): number | null => {
    if (bar == null) return null;
    return isPsi ? bar * BAR_TO_PSI : bar;
  };

  const fmtPressure = (bar: number | null | undefined, decimals = 1): string => {
    const v = convertPressure(bar);
    return v != null ? v.toFixed(decimals) : '—';
  };

  const convertConsumption = (kwhPer100km: number | null | undefined): number | null => {
    if (kwhPer100km == null) return null;
    return isMi ? kwhPer100km * 1.60934 : kwhPer100km;
  };

  const fmtDist = (km: number | null | undefined, decimals = 1): string => {
    const v = convertDistance(km);
    return v != null ? v.toFixed(decimals) : '—';
  };

  const fmtSpeed = (kmh: number | null | undefined, decimals = 0): string => {
    const v = convertSpeed(kmh);
    return v != null ? Math.round(v).toString() : '—';
  };

  const fmtTemp = (celsius: number | null | undefined): string => {
    const v = convertTemp(celsius);
    return v != null ? Math.round(v).toString() : '—';
  };

  const fmtConsumption = (kwhPer100km: number | null | undefined, decimals = 1): string => {
    const v = convertConsumption(kwhPer100km);
    return v != null ? v.toFixed(decimals) : '—';
  };

  return {
    distanceUnit,
    speedUnit,
    tempUnit,
    pressureUnit,
    consumptionUnit,
    currency,
    currencySymbol,
    convertDistance,
    convertSpeed,
    convertTemp,
    convertPressure,
    convertConsumption,
    fmtDist,
    fmtSpeed,
    fmtTemp,
    fmtPressure,
    fmtConsumption,
  };
}
