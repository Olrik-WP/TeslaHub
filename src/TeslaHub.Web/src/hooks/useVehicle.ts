import { useQuery } from '@tanstack/react-query';
import { getCars, getVehicleStatus } from '../api/queries';

export function useCars() {
  return useQuery({
    queryKey: ['cars'],
    queryFn: getCars,
    staleTime: 60_000,
  });
}

export function useVehicleStatus(carId: number | undefined) {
  return useQuery({
    queryKey: ['vehicle', carId],
    queryFn: () => getVehicleStatus(carId!),
    enabled: !!carId,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
