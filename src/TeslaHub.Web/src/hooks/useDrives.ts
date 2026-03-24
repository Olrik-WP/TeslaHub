import { useQuery } from '@tanstack/react-query';
import { getDrives, getDrivePositions } from '../api/queries';

export function useDrives(carId: number | undefined, limit = 20) {
  return useQuery({
    queryKey: ['drives', carId, limit],
    queryFn: () => getDrives(carId!, limit),
    enabled: !!carId,
    staleTime: 30_000,
  });
}

export function useDrivePositions(driveId: number | undefined) {
  return useQuery({
    queryKey: ['drivePositions', driveId],
    queryFn: () => getDrivePositions(driveId!),
    enabled: !!driveId,
  });
}
