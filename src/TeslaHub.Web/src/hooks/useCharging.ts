import { useQuery } from '@tanstack/react-query';
import { getChargingSessions, getChargePoints } from '../api/queries';

export function useChargingSessions(carId: number | undefined, limit = 20) {
  return useQuery({
    queryKey: ['charging', carId, limit],
    queryFn: () => getChargingSessions(carId!, limit),
    enabled: !!carId,
    staleTime: 30_000,
  });
}

export function useChargePoints(carId: number | undefined, processId: number | undefined) {
  return useQuery({
    queryKey: ['chargePoints', carId, processId],
    queryFn: () => getChargePoints(carId!, processId!),
    enabled: !!carId && !!processId,
  });
}
