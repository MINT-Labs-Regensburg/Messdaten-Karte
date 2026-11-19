import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api, fetchAllMeasurements } from '../api/client'
import type { Heatmap, Measurement, ProjectDetail } from '../api/types'

export function useProject(ref: string | undefined) {
  return useQuery({
    queryKey: ['project', ref],
    queryFn: () => api.get<ProjectDetail>(`/projects/${ref}`),
    enabled: !!ref,
    retry: false,
  })
}

export function useMeasurements(
  projectId: string | undefined,
  from: string | undefined,
  to: string | undefined,
  includeHidden: boolean,
) {
  return useQuery<Measurement[]>({
    queryKey: ['measurements', projectId ?? '', from, to, includeHidden],
    queryFn: () => fetchAllMeasurements(projectId as string, { from, to, includeHidden }),
    enabled: !!projectId,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

export function useHeatmap(
  projectId: string | undefined,
  metricId: string | undefined,
  from: string | undefined,
  to: string | undefined,
  resolution: number,
) {
  return useQuery({
    queryKey: ['heatmap', projectId ?? '', metricId, from, to, resolution],
    queryFn: () =>
      api.get<Heatmap>(`/projects/${projectId}/heatmap`, {
        metric: metricId,
        from,
        to,
        resolution,
        bounds: 'metric',
      }),
    enabled: !!projectId && !!metricId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
