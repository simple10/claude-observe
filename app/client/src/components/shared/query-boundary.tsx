import type { ReactNode } from 'react'
import { Spinner, EmptyState, ErrorState } from './loading-states'

/**
 * Minimal query state shape that QueryBoundary consumes. Compatible with
 * react-query's UseQueryResult (which has these fields plus many others),
 * and also with synthetic states like `useEffectiveEvents` which bypasses
 * the live query when in rewind mode.
 */
export interface QueryState<T> {
  data: T | undefined
  isLoading: boolean
  isError: boolean
  error?: Error | null
}

interface QueryBoundaryProps<T> {
  query: QueryState<T>
  /** Element to render while the query is loading and has no data yet. */
  loading?: ReactNode
  /** Element to render when `isEmpty(data)` returns true. Omit to skip the empty check. */
  empty?: ReactNode
  /** Custom emptiness predicate. Defaults to checking for null/undefined only. */
  isEmpty?: (data: T) => boolean
  /** Element or render function for errors. */
  error?: ReactNode | ((error: Error) => ReactNode)
  /** Render function receiving the resolved data. */
  children: (data: T) => ReactNode
}

/**
 * Renders the appropriate state (loading, error, empty, or content) for a
 * react-query result. Keeps loading/empty/error UX consistent across the app.
 *
 * Example:
 *   <QueryBoundary
 *     query={useEvents(sessionId)}
 *     empty={<EmptyState text="No events" />}
 *     isEmpty={(events) => events.length === 0}
 *   >
 *     {(events) => <EventList events={events} />}
 *   </QueryBoundary>
 */
export function QueryBoundary<T>({
  query,
  loading,
  empty,
  isEmpty,
  error,
  children,
}: QueryBoundaryProps<T>) {
  // Loading: first fetch, no data yet
  if (query.isLoading && query.data === undefined) {
    return <>{loading ?? <Spinner label="Loading..." />}</>
  }

  // Error: query failed with no cached data to show
  if (query.isError && query.data === undefined) {
    const err = query.error as Error
    if (typeof error === 'function') return <>{error(err)}</>
    return <>{error ?? <ErrorState message={err?.message} />}</>
  }

  // No data (shouldn't happen in practice but narrow the type)
  if (query.data === undefined) {
    return <>{loading ?? <Spinner label="Loading..." />}</>
  }

  // Empty: data loaded but caller considers it empty
  if (empty !== undefined && isEmpty && isEmpty(query.data)) {
    return <>{empty ?? <EmptyState text="No data" />}</>
  }

  return <>{children(query.data)}</>
}
