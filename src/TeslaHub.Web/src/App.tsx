import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAuthenticated, tryInitialRefresh } from './api/client';
import { useCars } from './hooks/useVehicle';
import BottomNav from './components/BottomNav';
import CarSelector from './components/CarSelector';

const Login = lazy(() => import('./pages/Login'));
const Home = lazy(() => import('./pages/Home'));
const Vehicle = lazy(() => import('./pages/Vehicle'));
const Charging = lazy(() => import('./pages/Charging'));
const Trips = lazy(() => import('./pages/Trips'));
const MapPage = lazy(() => import('./pages/Map'));
const Costs = lazy(() => import('./pages/Costs'));
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
    return <div className="flex items-center justify-center h-dvh text-[#9ca3af]">Connecting...</div>;
  }

  if (authState === 'denied') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function AppLayout() {
  const { data: cars } = useCars();
  const [selectedCarId, setSelectedCarId] = useState<number | undefined>();

  useEffect(() => {
    if (cars && cars.length > 0 && !selectedCarId) {
      setSelectedCarId(cars[0].id);
    }
  }, [cars, selectedCarId]);

  return (
    <div className="min-h-dvh bg-[#0a0a0a] flex flex-col">
      {cars && cars.length > 1 && (
        <CarSelector
          cars={cars}
          selectedId={selectedCarId}
          onChange={setSelectedCarId}
        />
      )}
      <div className="flex-1 overflow-y-auto pb-20">
        <Suspense fallback={<div className="flex items-center justify-center h-[60vh] text-[#9ca3af]">Loading...</div>}>
          <Routes>
            <Route path="/" element={<Home carId={selectedCarId} />} />
            <Route path="/vehicle" element={<Vehicle carId={selectedCarId} />} />
            <Route path="/charging" element={<Charging carId={selectedCarId} />} />
            <Route path="/trips" element={<Trips carId={selectedCarId} />} />
            <Route path="/map" element={<MapPage carId={selectedCarId} />} />
            <Route path="/costs" element={<Costs carId={selectedCarId} />} />
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
        <Suspense fallback={<div className="flex items-center justify-center h-dvh text-[#9ca3af]">Loading...</div>}>
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
