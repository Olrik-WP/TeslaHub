import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import { isAuthenticated, tryInitialRefresh } from './api/client';
import { useCars } from './hooks/useVehicle';
import { getSettings } from './api/queries';
import BottomNav from './components/BottomNav';
import CarSelector from './components/CarSelector';

const Login = lazy(() => import('./pages/Login'));
const Home = lazy(() => import('./pages/Home'));
const Charging = lazy(() => import('./pages/Charging'));
const Trips = lazy(() => import('./pages/Trips'));
const MapPage = lazy(() => import('./pages/Map'));
const Costs = lazy(() => import('./pages/Costs'));
const ChargingStats = lazy(() => import('./pages/ChargingStats'));
const Settings = lazy(() => import('./pages/Settings'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      gcTime: 10 * 60 * 1000,
      staleTime: 30_000,
    },
  },
});

function ProtectedRoute() {
  const { t } = useTranslation();
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>(
    isAuthenticated() ? 'ok' : 'checking'
  );

  useEffect(() => {
    if (authState !== 'checking') return;
    let cancelled = false;

    tryInitialRefresh().then((success) => {
      if (!cancelled) setAuthState(success ? 'ok' : 'denied');
    });

    return () => { cancelled = true; };
  }, [authState]);

  if (authState === 'checking') {
    return <div className="flex items-center justify-center h-dvh text-[#9ca3af]">{t('app.connecting')}</div>;
  }

  if (authState === 'denied') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

const CAR_STORAGE_KEY = 'teslahub_selected_car';

function AppLayout() {
  const { t } = useTranslation();
  const { data: cars } = useCars();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 5 * 60_000 });
  const [selectedCarId, setSelectedCarId] = useState<number | undefined>();

  useEffect(() => {
    if (!cars || cars.length === 0 || selectedCarId) return;

    const stored = localStorage.getItem(CAR_STORAGE_KEY);
    if (stored) {
      const id = Number(stored);
      if (cars.some(c => c.id === id)) { setSelectedCarId(id); return; }
    }

    if (settings?.defaultCarId && cars.some(c => c.id === settings.defaultCarId)) {
      setSelectedCarId(settings.defaultCarId); return;
    }

    setSelectedCarId(cars[0].id);
  }, [cars, settings, selectedCarId]);

  const handleCarChange = useCallback((id: number) => {
    setSelectedCarId(id);
    localStorage.setItem(CAR_STORAGE_KEY, String(id));
  }, []);

  return (
    <div className="min-h-dvh bg-[#0a0a0a] flex flex-col">
      {cars && cars.length > 1 && (
        <CarSelector
          cars={cars}
          selectedId={selectedCarId}
          onChange={handleCarChange}
        />
      )}
      <div className="flex-1 overflow-y-auto pb-20">
        <Suspense fallback={<div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">{t('app.loading')}</div>}>
          <Routes>
            <Route path="/" element={<Home carId={selectedCarId} />} />
            <Route path="/charging" element={<Charging carId={selectedCarId} />} />
            <Route path="/trips" element={<Trips carId={selectedCarId} />} />
            <Route path="/map" element={<MapPage carId={selectedCarId} />} />
            <Route path="/costs" element={<Costs carId={selectedCarId} />} />
            <Route path="/charging-stats" element={<ChargingStats carId={selectedCarId} />} />
            <Route path="/settings" element={<Settings carId={selectedCarId} />} />
          </Routes>
        </Suspense>
      </div>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div className="flex items-center justify-center h-dvh text-[#9ca3af]">{i18n.t('app.loading')}</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/*" element={<AppLayout />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
