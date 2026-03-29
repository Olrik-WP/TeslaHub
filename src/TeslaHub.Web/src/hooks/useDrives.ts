import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getDrives, getDrivePositions } from '../api/queries';

export function useDrives(carId: number | undefined, limit = 20, days?: number) {
  return useQuery({
    queryKey: ['drives', carId, limit, days],
    queryFn: () => getDrives(carId!, limit, 0, days),
    enabled: !!carId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useDrivePositions(driveId: number | undefined) {
  return useQuery({
    queryKey: ['drivePositions', driveId],
    queryFn: () => getDrivePositions(driveId!),
    enabled: !!driveId,
    placeholderData: keepPreviousData,
  });
}
