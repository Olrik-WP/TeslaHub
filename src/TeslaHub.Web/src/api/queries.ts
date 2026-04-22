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
  kmSinceLastCharge: number;
  maxCapacityKwh: number | null;

  // TPMS pressures (from DB)
  tpmsPressureFl: number | null;
  tpmsPressureFr: number | null;
  tpmsPressureRl: number | null;
  tpmsPressureRr: number | null;

  // Climate (from DB)
  isClimateOn: boolean | null;
  driverTempSetting: number | null;
  passengerTempSetting: number | null;
  isFrontDefrosterOn: boolean | null;
  isRearDefrosterOn: boolean | null;

  // TPMS warnings (MQTT live)
  tpmsSoftWarningFl: boolean | null;
  tpmsSoftWarningFr: boolean | null;
  tpmsSoftWarningRl: boolean | null;
  tpmsSoftWarningRr: boolean | null;

  // Body / Security (MQTT live)
  isLocked: boolean | null;
  doorsOpen: boolean | null;
  driverFrontDoorOpen: boolean | null;
  driverRearDoorOpen: boolean | null;
  passengerFrontDoorOpen: boolean | null;
  passengerRearDoorOpen: boolean | null;
  trunkOpen: boolean | null;
  frunkOpen: boolean | null;
  windowsOpen: boolean | null;
  sentryMode: boolean | null;
  isUserPresent: boolean | null;

  // Climate extras (MQTT live)
  climateKeeperMode: string | null;
  isPreconditioning: boolean | null;
  chargePortDoorOpen: boolean | null;
  pluggedIn: boolean | null;

  // Charging live (MQTT live)
  chargingState: string | null;
  chargeEnergyAdded: number | null;
  chargerPower: number | null;
  chargerVoltage: number | null;
  chargerActualCurrent: number | null;
  chargeLimitSoc: number | null;
  timeToFullCharge: number | null;
  estBatteryRangeKm: number | null;

  // Driving live (MQTT live)
  shiftState: string | null;
  heading: number | null;
  elevation: number | null;
  geofence: string | null;

  // MQTT connectivity
  mqttConnected: boolean;
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
  odometer: number | null;
  distanceSinceLastCharge: number | null;
  maxCurrent: number | null;
  maxVoltage: number | null;
  connChargeCable: string | null;
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
  chargerActualCurrent: number | null;
  chargerVoltage: number | null;
  connChargeCable: string | null;
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
  unitOfPressure: string;
  defaultCarId: number | null;
  mapTileUrl: string;
  costSource: string;
  language: string;
  dashboardGaugeMode: string;
  dashboardColorPreset: string;
  dashboardMaxScale: number;
  mapStyle: string;
  securityAlertsTeaserDismissed: boolean;
  chargersEnabled: boolean;
  chargersNetworkFilter: 'all' | 'tesla' | 'custom';
  chargersCustomNetworks: string | null;
  chargersMinPowerKw: number;
  chargersOcmApiKey: string | null;
  showFleetApiCost: boolean;
}

// ─── Tesla Fleet API usage (locally-estimated monthly cost) ──────
export interface FleetApiUsageCategory {
  category: string;
  requestCount: number;
  unitPriceUsd: number;
  subtotalUsd: number;
}

export interface FleetApiUsagePreviousMonth {
  yearMonth: string;
  grossUsd: number;
  netUsd: number;
}

export interface FleetApiUsage {
  enabled: boolean;
  yearMonth: string;
  periodStartUtc: string;
  generatedAtUtc: string;
  categories: FleetApiUsageCategory[];
  grossUsd: number;
  creditUsd: number;
  netUsd: number;
  previousMonth: FleetApiUsagePreviousMonth | null;
}

export const getFleetApiUsage = () => api<FleetApiUsage>('/fleet-usage');

// ─── Public chargers (Open Charge Map) ──────────────────────────
export interface ChargerConnection {
  type: string;
  powerKw: number | null;
  currentType: string | null;
  quantity: number;
}

export interface PublicCharger {
  id: number;
  latitude: number;
  longitude: number;
  title: string;
  network: string;
  operatorWebsite: string | null;
  /** "tesla-supercharger" | "tesla-destination" | "third-party" */
  category: 'tesla-supercharger' | 'tesla-destination' | 'third-party';
  powerKw: number | null;
  connectorCount: number;
  connections: ChargerConnection[];
  address: string | null;
  city: string | null;
  usageType: string | null;
  operationalStatus: string | null;
  isOperational: boolean;
}

/**
 * Wrapped chargers response. `warning` is non-null when OCM blocked or
 * throttled the upstream call. The frontend uses it to display an
 * actionable banner (e.g. "add an API key in Settings") instead of an
 * empty map layer that looks like a silent failure.
 */
export interface ChargersResponse {
  items: PublicCharger[];
  /** "missing-key" | "rate-limited" | "error" | null */
  warning: string | null;
}

export const getChargers = (
  bbox: { south: number; west: number; north: number; east: number },
) =>
  api<ChargersResponse>(
    `/chargers/?south=${bbox.south}&west=${bbox.west}&north=${bbox.north}&east=${bbox.east}`,
  );

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
export const getDrives = (carId: number, limit = 20, offset = 0, days?: number) =>
  api<Drive[]>(`/drives/${carId}?limit=${limit}&offset=${offset}${days ? `&days=${days}` : ''}`);
export const getDrivePositions = (driveId: number) => api<Position[]>(`/drives/positions/${driveId}`);

// ─── Charging ───────────────────────────────────────────────────
export const getChargingSessions = (carId: number, limit = 20, offset = 0, chargeType?: string, days?: number) =>
  api<ChargingSession[]>(`/charging/${carId}?limit=${limit}&offset=${offset}${chargeType ? `&chargeType=${chargeType}` : ''}${days ? `&days=${days}` : ''}`);
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

function buildCostSummaryParams(period?: string, year?: number, month?: number, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (period) params.set('period', period);
  if (year) params.set('year', String(year));
  if (month) params.set('month', String(month));
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return params;
}

export const getCostSummary = (carId: number, period?: string, year?: number, month?: number, from?: string, to?: string) =>
  api<CostSummary>(`/costs/summary/${carId}?${buildCostSummaryParams(period, year, month, from, to)}`);
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
export const getTeslaMateCostSummary = (carId: number, period?: string, year?: number, month?: number, from?: string, to?: string) =>
  api<CostSummary>(`/costs/teslamate-summary/${carId}?${buildCostSummaryParams(period, year, month, from, to)}`);
export const getTeslaMateMonthlyTrend = (carId: number) =>
  api<MonthlyTrend[]>(`/costs/teslamate-trend/${carId}`);

// ─── Battery ─────────────────────────────────────────────────────
export interface BatteryHealthData {
  currentCapacityKwh: number | null;
  maxCapacityKwh: number | null;
  degradationPct: number | null;
  healthPct: number | null;
  storedEnergyKwh: number | null;
  chargeCount: number | null;
  chargeCycles: number | null;
  totalEnergyAddedKwh: number | null;
  totalEnergyUsedKwh: number | null;
  chargingEfficiencyPct: number | null;
  medianCapacity: number | null;
  capacityByMileage: { odometerKm: number; capacityKwh: number; date: string }[];
}

export interface ChargeLevelPoint {
  date: string;
  batteryLevel: number | null;
  usableBatteryLevel: number | null;
}

export interface ProjectedRangePoint {
  date: string;
  projectedRangeKm: number | null;
  batteryLevel: number | null;
}

export const getBatteryHealth = (carId: number) =>
  api<BatteryHealthData>(`/battery/${carId}/health`);
export const getChargeLevelTimeSeries = (carId: number, days: number) =>
  api<ChargeLevelPoint[]>(`/battery/${carId}/charge-level?days=${days}`);
export const getProjectedRange = (carId: number, days: number) =>
  api<ProjectedRangePoint[]>(`/battery/${carId}/projected-range?days=${days}`);

// ─── Efficiency ──────────────────────────────────────────────────
export interface EfficiencySummary {
  avgConsumptionNetKwhPer100Km: number | null;
  avgConsumptionGrossKwhPer100Km: number | null;
  totalDistanceKm: number | null;
  currentEfficiencyWhPerKm: number | null;
  derivedEfficiencies: { efficiencyKwhPer100Km: number; count: number }[];
  temperatureEfficiency: { temperatureC: number; consumptionKwhPer100Km: number; totalDistanceKm: number }[];
}

export const getEfficiencySummary = (carId: number) =>
  api<EfficiencySummary>(`/efficiency/${carId}`);

// ─── Mileage ─────────────────────────────────────────────────────
export interface MileagePoint {
  date: string;
  odometerKm: number;
}

export const getMileageTimeSeries = (carId: number, days: number) =>
  api<MileagePoint[]>(`/mileage/${carId}?days=${days}`);

// ─── Updates ─────────────────────────────────────────────────────
export interface UpdateItem {
  startDate: string;
  endDate: string | null;
  durationMin: number | null;
  version: string;
  sinceLastDays: number | null;
}

export interface UpdatesStats {
  totalCount: number;
  medianIntervalDays: number | null;
  currentVersion: string | null;
}

export interface UpdatesResponse {
  items: UpdateItem[];
  stats: UpdatesStats;
}

export const getUpdatesList = (carId: number) =>
  api<UpdatesResponse>(`/updates/${carId}`);

// ─── States ──────────────────────────────────────────────────────
export interface StatesTimelineData {
  currentState: string | null;
  parkedPct: number | null;
  drivingPct: number | null;
  segments: { state: string; pct: number }[];
}

export interface TimelineEntry {
  action: string;
  startDate: string;
  endDate: string | null;
  durationMin: number | null;
  startAddress: string | null;
  endAddress: string | null;
  distanceKm: number | null;
  energyKwh: number | null;
  socEnd: number | null;
}

export const getStatesTimeline = (carId: number, days: number) =>
  api<StatesTimelineData>(`/states/${carId}/summary?days=${days}`);
export const getTimeline = (carId: number, days: number) =>
  api<TimelineEntry[]>(`/states/${carId}/timeline?days=${days}`);

// ─── Statistics ──────────────────────────────────────────────────
export interface PeriodStats {
  label: string;
  distanceKm: number | null;
  driveCount: number;
  driveDurationMin: number | null;
  avgTempC: number | null;
  energyAddedKwh: number | null;
  chargeCount: number;
  chargeCost: number | null;
  consumptionNetKwhPer100Km: number | null;
}

export const getPeriodicStats = (carId: number, period: string) =>
  api<PeriodStats[]>(`/statistics/${carId}?period=${period}`);

// ─── Car Config (per-vehicle) ────────────────────────────────
export interface CarConfig {
  id: number;
  carId: number;
  displayName: string | null;
  colorOverride: string | null;
  isActive: boolean;
  gasPricePerLiter: number | null;
  gasConsumptionLPer100Km: number | null;
  gasVehicleName: string | null;
}

export const getCarConfig = (carId: number) =>
  api<CarConfig>(`/costs/car-config/${carId}`);
export const updateCarConfig = (carId: number, data: Partial<CarConfig>) =>
  api<CarConfig>(`/costs/car-config/${carId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

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

// ─── Database Info ──────────────────────────────────────────────
export interface DatabaseInfo {
  postgresVersion: string;
  timezone: string;
  sharedBuffersBytes: number | null;
  totalSizeBytes: number | null;
}

export interface TableSize {
  tableName: string;
  dataBytes: number;
  indexBytes: number;
  totalBytes: number;
}

export interface TableRowCount {
  tableName: string;
  rowCount: number;
}

export interface IndexStat {
  tableName: string;
  indexName: string;
  indexScans: number;
  tuplesRead: number;
  tuplesFetched: number;
  indexSizeBytes: number;
}

export interface DataStats {
  driveCount: number;
  chargeCount: number;
  updateCount: number;
  totalDistanceKm: number | null;
  odometerKm: number | null;
  currentFirmware: string | null;
  unclosedDrives: number;
  unclosedCharges: number;
}

export const getDatabaseInfo = () => api<DatabaseInfo>('/database/info');
export const getTableSizes = () => api<TableSize[]>('/database/tables');
export const getTableRowCounts = () => api<TableRowCount[]>('/database/row-counts');
export const getIndexStats = () => api<IndexStat[]>('/database/indexes');
export const getDataStats = (carId: number) => api<DataStats>(`/database/${carId}/stats`);

// ─── Locations ──────────────────────────────────────────────────
export interface LocationStats {
  addressCount: number;
  cityCount: number;
  stateCount: number;
  countryCount: number;
}

export interface VisitedLocation {
  address: string;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  visitCount: number;
  lastVisited: string;
}

export interface TopCity {
  city: string;
  count: number;
}

export const getLocationStats = (carId: number) => api<LocationStats>(`/locations/${carId}/stats`);
export const getVisitedLocations = (carId: number) => api<VisitedLocation[]>(`/locations/${carId}/visited`);
export const getTopCities = (carId: number) => api<TopCity[]>(`/locations/${carId}/top-cities`);

// ─── Trip ───────────────────────────────────────────────────────
export interface TripSummary {
  driveCount: number;
  chargeCount: number;
  totalDistanceKm: number;
  totalDriveMin: number;
  totalChargeMin: number;
  totalEnergyUsedKwh: number;
  totalEnergyAddedKwh: number;
  avgConsumption: number | null;
  avgSpeedKmh: number | null;
  avgOutsideTemp: number | null;
}

export interface TripSegment {
  type: 'drive' | 'charge';
  id: number;
  startDate: string;
  endDate: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  energyKwh: number | null;
  startAddress: string | null;
  endAddress: string | null;
  startBattery: number | null;
  endBattery: number | null;
  avgSpeedKmh: number | null;
  consumption: number | null;
}

export const getTripSummary = (carId: number, from: string, to: string) =>
  api<TripSummary>(`/trip/${carId}/summary?from=${from}&to=${to}`);
export const getTripSegments = (carId: number, from: string, to: string) =>
  api<TripSegment[]>(`/trip/${carId}/segments?from=${from}&to=${to}`);
