import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useSessions(projectId: number | null) {
  return useQuery({
    queryKey: ['sessions', projectId],
    queryFn: () => api.getSessions(projectId!),
    enabled: !!projectId,
  })
}
