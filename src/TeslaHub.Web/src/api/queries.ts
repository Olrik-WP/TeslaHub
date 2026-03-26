import { api } from './client';

export interface Car {
  id: number;
  name: string | null;
  model: string | null;
  marketingName: string | null;
  vin: string | null;
}

export interface VehicleStatus {
  carId: number;
  name: string | null;
  model: string | null;
  marketingName: string | null;
  trimBadging: string | null;
  exteriorColor: string | null;
  wheelType: string | null;
  vin: string | null;
  efficiency: number | null;
  batteryLevel: number | null;
  usableBatteryLevel: number | null;
  ratedBatteryRangeKm: number | null;
  idealBatteryRangeKm: number | null;
  odometer: number | null;
  latitude: number | null;
  longitude: number | null;
  insideTemp: number | null;
  outsideTemp: number | null;
  speed: number | null;
  power: number | null;
  positionDate: string | null;
  state: string | null;
  firmwareVersion: string | null;
  currentCapacityKwh: number | null;
  maxCapacityKwh: number | null;
}

export interface Drive {
  id: number;
  carId: number;
  startDate: string;
  endDate: string | null;
  startKm: number | null;
  endKm: number | null;
  distance: number | null;
  durationMin: number | null;
  speedMax: number | null;
  powerMax: number | null;
  outsideTempAvg: number | null;
  insideTempAvg: number | null;
  ascent: number | null;
  descent: number | null;
  startAddress: string | null;
  endAddress: string | null;
  consumptionKWhPer100Km: number | null;
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  speedAvg: number | null;
  netEnergyKwh: number | null;
  efficiency: number | null;
  hasReducedRange: boolean;
}

export interface Position {
  id: number;
  date: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  power: number | null;
  batteryLevel: number | null;
  elevation: number | null;
}

export interface ChargingSession {
  id: number;
  carId: number;
  startDate: string;
  endDate: string | null;
  chargeEnergyAdded: number | null;
  chargeEnergyUsed: number | null;
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  durationMin: number | null;
  outsideTempAvg: number | null;
  cost: number | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geofenceId: number | null;
  geofenceName: string | null;
  fastChargerPresent: boolean | null;
  fastChargerType: string | null;
  chargeType: string | null;
  efficiency: number | null;
  avgPowerKw: number | null;
  chargeRateKmPerHour: number | null;
  rangeAddedKm: number | null;
  costPerKwh: number | null;
}

export interface ChargingSummary {
  chargeCount: number;
  totalEnergyAdded: number;
  totalEnergyUsed: number;
  totalCost: number;
  avgDurationMin: number;
  avgEfficiency: number;
}

export interface ChargePoint {
  date: string;
  batteryLevel: number | null;
  chargeEnergyAdded: number | null;
  chargerPower: number | null;
}

export interface ChargingLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  pricingType: string;
  peakPricePerKwh: number | null;
  offPeakPricePerKwh: number | null;
  offPeakStart: string | null;
  offPeakEnd: string | null;
  monthlySubscription: number | null;
  carId: number | null;
}

export interface CostOverride {
  id: number;
  chargingProcessId: number;
  carId: number;
  pricePerKwh: number | null;
  totalCost: number;
  isFree: boolean;
  isManualOverride: boolean;
  locationId: number | null;
  location: ChargingLocation | null;
  notes: string | null;
}

export interface CostSummary {
  period: string;
  totalCost: number;
  totalKwh: number;
  avgPricePerKwh: number;
  costPerKm: number;
  totalDistanceKm: number;
  sessionCount: number;
  freeSessionCount: number;
  costByLocation: Record<string, number>;
}

export interface GlobalSettings {
  id: number;
  currency: string;
  unitOfLength: string;
  unitOfTemperature: string;
  defaultCarId: number | null;
  mapTileUrl: string;
  costSource: string;
}

export interface MonthlyTrend {
  month: string;
  cost: number;
}

export interface Stats {
  period: string;
  totalDistanceKm: number;
  totalEnergyAddedKWh: number;
  driveCount: number;
  chargeCount: number;
  avgConsumptionKWhPer100Km: number;
}

// ─── Vehicle ────────────────────────────────────────────────────
export const getCars = () => api<Car[]>('/vehicle/cars');
export const getVehicleStatus = (carId: number) => api<VehicleStatus>(`/vehicle/${carId}/status`);

// ─── Drives ─────────────────────────────────────────────────────
export const getDrives = (carId: number, limit = 20, offset = 0) =>
  api<Drive[]>(`/drives/${carId}?limit=${limit}&offset=${offset}`);
export const getDrivePositions = (driveId: number) => api<Position[]>(`/drives/positions/${driveId}`);

// ─── Charging ───────────────────────────────────────────────────
export const getChargingSessions = (carId: number, limit = 20, offset = 0, chargeType?: string) =>
  api<ChargingSession[]>(`/charging/${carId}?limit=${limit}&offset=${offset}${chargeType ? `&chargeType=${chargeType}` : ''}`);
export const getChargePoints = (carId: number, processId: number) =>
  api<ChargePoint[]>(`/charging/${carId}/${processId}/points`);

// ─── Map ────────────────────────────────────────────────────────
export const getRecentPositions = (carId: number, hours = 24) =>
  api<Position[]>(`/map/recent/${carId}?hours=${hours}`);
export const getPositionsInRange = (carId: number, from: string, to: string) =>
  api<Position[]>(`/map/recent/${carId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
export const getStats = (carId: number, from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return api<Stats>(`/map/stats/${carId}?${params}`);
};

// ─── Costs & Locations ──────────────────────────────────────────
export const getChargingLocations = (carId?: number) =>
  api<ChargingLocation[]>(`/costs/locations${carId ? `?carId=${carId}` : ''}`);
export const getCostOverrides = (carId: number) =>
  api<CostOverride[]>(`/costs/overrides/${carId}`);
export const getCostSummary = (carId: number, period?: string, year?: number, month?: number) => {
  const params = new URLSearchParams();
  if (period) params.set('period', period);
  if (year) params.set('year', String(year));
  if (month) params.set('month', String(month));
  return api<CostSummary>(`/costs/summary/${carId}?${params}`);
};
export const getSuggestedPrice = (lat: number, lng: number, carId: number) =>
  api<{ suggestedPrice: number | null }>(`/costs/suggest-price?lat=${lat}&lng=${lng}&carId=${carId}`);
export const getMatchingLocation = (lat: number, lng: number, carId?: number) =>
  api<ChargingLocation | null>(`/costs/match-location?lat=${lat}&lng=${lng}${carId ? `&carId=${carId}` : ''}`);

export interface DriveStats {
  driveCount: number;
  maxSpeedKmh: number | null;
  medianDistanceKm: number | null;
  totalDistanceKm: number;
  totalNetEnergyKwh: number;
  totalDays: number;
  totalMileageKm: number;
}

export const getDriveStats = (carId: number) => api<DriveStats>(`/drives/${carId}/stats`);

export interface ChargingStats {
  chargeCount: number;
  totalEnergyAdded: number;
  totalEnergyUsed: number;
  chargingEfficiency: number;
}

export const getChargingStats = (carId: number) => api<ChargingStats>(`/charging/${carId}/stats`);

export const getChargingSummary = (carId: number, days?: number) =>
  api<ChargingSummary>(`/charging/${carId}/summary${days != null ? `?days=${days}` : ''}`);

// ─── Charging Curve ─────────────────────────────────────────────
export interface ChargingCurvePoint {
  soC: number;
  power: number;
  chargingProcessId: number;
  label: string | null;
}

export interface ChargingCurveMedian {
  soC: number;
  power: number;
}

export interface ChargingCurveData {
  points: ChargingCurvePoint[];
  median: ChargingCurveMedian[];
}

export const getChargingCurve = (carId: number) =>
  api<ChargingCurveData>(`/charging/${carId}/curve`);

// ─── Vehicle Image ──────────────────────────────────────────────
export interface CarImageInfo {
  paintCode: string | null;
  wheelCode: string | null;
  isCustomUpload: boolean;
  hasImage: boolean;
}

export const getCarImageInfo = (carId: number) => api<CarImageInfo>(`/vehicle/${carId}/image/info`);

// ─── TeslaMate cost analytics ────────────────────────────────────
export const getTeslaMateCostSummary = (carId: number, period?: string, year?: number, month?: number) => {
  const params = new URLSearchParams();
  if (period) params.set('period', period);
  if (year) params.set('year', String(year));
  if (month) params.set('month', String(month));
  return api<CostSummary>(`/costs/teslamate-summary/${carId}?${params}`);
};
export const getTeslaMateMonthlyTrend = (carId: number) =>
  api<MonthlyTrend[]>(`/costs/teslamate-trend/${carId}`);

// ─── Settings ───────────────────────────────────────────────────
export const getSettings = () => api<GlobalSettings>('/costs/settings');

// ─── Vampire Drain ──────────────────────────────────────────────
export interface VampireDrainItem {
  startDate: string;
  endDate: string;
  durationSec: number;
  standby: number | null;
  socDiff: number | null;
  hasReducedRange: boolean;
  rangeDiffKm: number | null;
  consumptionKwh: number | null;
  avgPowerW: number | null;
  rangeLostPerHourKm: number | null;
}

export interface VampireSummary {
  sessionCount: number;
  totalKwh: number;
  avgWh: number;
  avgPowerW: number;
}

export interface VampireDrainResponse {
  items: VampireDrainItem[];
  summary: VampireSummary;
}

export const getVampireDrain = (
  carId: number,
  minIdleHours: number,
  days: number | null,
  page: number
) => {
  const params = new URLSearchParams();
  params.set('minIdleHours', String(minIdleHours));
  if (days != null) params.set('days', String(days));
  params.set('page', String(page));
  return api<VampireDrainResponse>(`/vampire/${carId}?${params}`);
};
