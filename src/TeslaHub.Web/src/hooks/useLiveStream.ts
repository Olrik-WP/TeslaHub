import { useState, useEffect, useRef } from 'react';

export interface LiveStreamData {
  speed: number | null;
  power: number | null;
  odometer: number | null;
  batteryLevel: number | null;
  usableBatteryLevel: number | null;
  ratedBatteryRangeKm: number | null;
  idealBatteryRangeKm: number | null;
  estBatteryRangeKm: number | null;
  latitude: number | null;
  longitude: number | null;
  insideTemp: number | null;
  outsideTemp: number | null;
  shiftState: string | null;
  heading: number | null;
  elevation: number | null;
  geofence: string | null;
  state: string | null;
  chargingState: string | null;
  chargeEnergyAdded: number | null;
  chargerPower: number | null;
  chargerVoltage: number | null;
  chargerActualCurrent: number | null;
  chargeLimitSoc: number | null;
  timeToFullCharge: number | null;
  locked: boolean | null;
  pluggedIn: boolean | null;
  chargePortDoorOpen: boolean | null;
  mqttConnected: boolean;
  lastUpdated: string;
}

export function useLiveStream(carId: number | undefined, enabled = true) {
  const [data, setData] = useState<LiveStreamData | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!carId || !enabled) {
      setData(null);
      setConnected(false);
      return;
    }

    const token = localStorage.getItem('teslahub_token');
    const url = `/api/vehicle/${carId}/live-stream${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => setConnected(true);

    source.onmessage = (e) => {
      try {
        setData(JSON.parse(e.data));
      } catch { /* ignore parse errors */ }
    };

    source.onerror = () => {
      setConnected(false);
    };

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [carId, enabled]);

  return { data, connected };
}
