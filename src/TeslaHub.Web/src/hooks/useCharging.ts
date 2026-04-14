import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getChargingSessions, getChargePoints } from '../api/queries';

export function useChargingSessions(carId: number | undefined, limit = 20) {
  return useQuery({
    queryKey: ['charging', carId, limit],
    queryFn: () => getChargingSessions(carId!, limit),
    enabled: !!carId,
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useChargePoints(carId: number | undefined, processId: number | undefined) {
  return useQuery({
    queryKey: ['chargePoints', carId, processId],
    queryFn: () => getChargePoints(carId!, processId!),
    enabled: !!carId && !!processId,
    placeholderData: keepPreviousData,
  });
}
