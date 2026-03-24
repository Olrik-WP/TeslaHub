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
  outsideTempAvg: number | null;
  insideTempAvg: number | null;
  ascent: number | null;
  descent: number | null;
  startAddress: string | null;
  endAddress: string | null;
  consumptionKWhPer100Km: number | null;
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
  geofenceId: number | null;
  geofenceName: string | null;
  fastChargerPresent: boolean | null;
  fastChargerType: string | null;
  detectedSourceType: string | null;
}

export interface ChargePoint {
  date: string;
  batteryLevel: number | null;
  chargeEnergyAdded: number | null;
  chargerPower: number | null;
}

export interface PriceRule {
  id: number;
  carId: number | null;
  label: string;
  pricePerKwh: number;
  sourceType: string;
  locationName: string | null;
  geofenceId: number | null;
  timeStart: string | null;
  timeEnd: string | null;
  validFrom: string | null;
  validTo: string | null;
  priority: number;
  isActive: boolean;
}

export interface CostOverride {
  id: number;
  chargingProcessId: number;
  carId: number;
  cost: number;
  isFree: boolean;
  sourceType: string | null;
  appliedRuleId: number | null;
  isManualOverride: boolean;
  notes: string | null;
}

export interface GlobalSettings {
  id: number;
  currency: string;
  unitOfLength: string;
  unitOfTemperature: string;
  defaultCarId: number | null;
  mapTileUrl: string;
}

export interface Stats {
  period: string;
  totalDistanceKm: number;
  totalEnergyAddedKWh: number;
  driveCount: number;
  chargeCount: number;
  avgConsumptionKWhPer100Km: number;
}

export const getCars = () => api<Car[]>('/vehicle/cars');
export const getVehicleStatus = (carId: number) => api<VehicleStatus>(`/vehicle/${carId}/status`);
export const getDrives = (carId: number, limit = 20, offset = 0) =>
  api<Drive[]>(`/drives/${carId}?limit=${limit}&offset=${offset}`);
export const getDrivePositions = (driveId: number) => api<Position[]>(`/drives/positions/${driveId}`);
export const getChargingSessions = (carId: number, limit = 20, offset = 0) =>
  api<ChargingSession[]>(`/charging/${carId}?limit=${limit}&offset=${offset}`);
export const getChargePoints = (carId: number, processId: number) =>
  api<ChargePoint[]>(`/charging/${carId}/${processId}/points`);
export const getRecentPositions = (carId: number, hours = 24) =>
  api<Position[]>(`/map/recent/${carId}?hours=${hours}`);
export const getStats = (carId: number, from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return api<Stats>(`/map/stats/${carId}?${params}`);
};
export const getPriceRules = (carId?: number) =>
  api<PriceRule[]>(`/costs/rules${carId ? `?carId=${carId}` : ''}`);
export const getSettings = () => api<GlobalSettings>('/costs/settings');
export const getCostOverrides = (carId: number) => api<CostOverride[]>(`/costs/overrides/${carId}`);
