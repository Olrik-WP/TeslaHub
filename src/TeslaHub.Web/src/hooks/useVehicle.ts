import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getCars, getVehicleStatus } from '../api/queries';
import { STALE_TIME } from '../constants/theme';
import { usePageVisible } from './usePageVisible';

export function useCars() {
  return useQuery({
    queryKey: ['cars'],
    queryFn: getCars,
    staleTime: 60_000,
  });
}

export function useVehicleStatus(carId: number | undefined) {
  const visible = usePageVisible();

  return useQuery({
    queryKey: ['vehicle', carId],
    queryFn: () => getVehicleStatus(carId!),
    enabled: !!carId,
    refetchInterval: visible ? 60_000 : false,
    staleTime: STALE_TIME.live,
    placeholderData: keepPreviousData,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
  });
}
