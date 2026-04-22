import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import { isAuthenticated, tryInitialRefresh, setAuthExpiredHandler } from './api/client';
import { useCars } from './hooks/useVehicle';
import { getSettings } from './api/queries';
import BottomNav from './components/BottomNav';
import CarSelector from './components/CarSelector';
import ErrorBoundary from './components/ErrorBoundary';
import { ControlFeedbackProvider } from './components/ControlFeedback';
import { STALE_TIME } from './constants/theme';

const Login = lazy(() => import('./pages/Login'));
const Home = lazy(() => import('./pages/Home'));
const Charging = lazy(() => import('./pages/Charging'));
const Trips = lazy(() => import('./pages/Trips'));
const MapPage = lazy(() => import('./pages/Map'));
const Costs = lazy(() => import('./pages/Costs'));
const ChargingStats = lazy(() => import('./pages/ChargingStats'));
const VampireDrain = lazy(() => import('./pages/VampireDrain'));
const Settings = lazy(() => import('./pages/Settings'));
const Battery = lazy(() => import('./pages/Battery'));
const Efficiency = lazy(() => import('./pages/Efficiency'));
const Mileage = lazy(() => import('./pages/Mileage'));
const Updates = lazy(() => import('./pages/Updates'));
const States = lazy(() => import('./pages/States'));
const Statistics = lazy(() => import('./pages/Statistics'));
const DatabaseInfo = lazy(() => import('./pages/DatabaseInfo'));
const Locations = lazy(() => import('./pages/Locations'));
const Trip = lazy(() => import('./pages/Trip'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Control = lazy(() => import('./pages/Control'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      gcTime: 10 * 60 * 1000,
      staleTime: STALE_TIME.live,
    },
  },
});

function AuthExpiredBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setAuthExpiredHandler(() => navigate('/login', { replace: true }));
    return () => setAuthExpiredHandler(() => {});
  }, [navigate]);
  return null;
}

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
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset BOTH the inner scroll container AND the window/body scroll on every
  // route change. The body scroll matters because <body> uses padding-top:
  // env(safe-area-inset-top) (index.css) plus min-height:100dvh on its child,
  // which makes the body overflow vertically by the safe-area amount. If we
  // don't reset window scroll, navigating from a deeply-scrolled page like
  // Home leaves the body scrolled, which pushes fixed-top headers (e.g. the
  // range selector on /map) under the iOS translucent status bar.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
    window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  useEffect(() => {
    if (settings?.language && settings.language !== i18n.language) {
      i18n.changeLanguage(settings.language);
      localStorage.setItem('teslahub_lang', settings.language);
    }
  }, [settings?.language]);

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
    <ControlFeedbackProvider>
      <div className="min-h-[calc(100dvh-env(safe-area-inset-top))] bg-[#0a0a0a] flex flex-col">
        {cars && cars.length > 1 && (
          <CarSelector
            cars={cars}
            selectedId={selectedCarId}
            onChange={handleCarChange}
          />
        )}
        <div ref={scrollRef} className="flex-1 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))]">
          <ErrorBoundary>
            <Suspense fallback={<div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">{t('app.loading')}</div>}>
              <Routes>
                <Route path="/" element={<Home carId={selectedCarId} />} />
                <Route path="/charging" element={<Charging carId={selectedCarId} />} />
                <Route path="/trips" element={<Trips carId={selectedCarId} />} />
                <Route path="/map" element={<MapPage carId={selectedCarId} />} />
                <Route path="/costs" element={<Costs carId={selectedCarId} />} />
                <Route path="/charging-stats" element={<ChargingStats carId={selectedCarId} />} />
                <Route path="/vampire" element={<VampireDrain carId={selectedCarId} />} />
                <Route path="/battery" element={<Battery carId={selectedCarId} />} />
                <Route path="/efficiency" element={<Efficiency carId={selectedCarId} />} />
                <Route path="/mileage" element={<Mileage carId={selectedCarId} />} />
                <Route path="/updates" element={<Updates carId={selectedCarId} />} />
                <Route path="/states" element={<States carId={selectedCarId} />} />
                <Route path="/statistics" element={<Statistics carId={selectedCarId} />} />
                <Route path="/database" element={<DatabaseInfo carId={selectedCarId} />} />
                <Route path="/locations" element={<Locations carId={selectedCarId} />} />
                <Route path="/trip" element={<Trip carId={selectedCarId} />} />
                <Route path="/dashboard" element={<Dashboard carId={selectedCarId} />} />
                <Route path="/control" element={<Control carId={selectedCarId} onCarChange={handleCarChange} />} />
                <Route path="/settings" element={<Settings carId={selectedCarId} />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </div>
        <BottomNav carId={selectedCarId} />
      </div>
    </ControlFeedbackProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthExpiredBridge />
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
    </ErrorBoundary>
  );
}
