import { isNativeHistoryAdapter } from '#~/api'
import type { NativeHistoryAdapter } from '#~/api'

export const externalSessionsAdapterQueryKey = 'adapter'
export const externalSessionsTimeQueryKey = 'time'
export const externalSessionsRouteQueryKeys = [
  externalSessionsAdapterQueryKey,
  externalSessionsTimeQueryKey
]

export const buildExternalSessionsRoute = (adapter: NativeHistoryAdapter) => (
  `/config/externalSessions?${
    new URLSearchParams({
      [externalSessionsAdapterQueryKey]: adapter,
      [externalSessionsTimeQueryKey]: 'all'
    }).toString()
  }`
)

export const parseExternalSessionsAdapter = (
  searchParams: Pick<URLSearchParams, 'get'>
): NativeHistoryAdapter | undefined => {
  const value = searchParams.get(externalSessionsAdapterQueryKey)?.trim()
  return isNativeHistoryAdapter(value) ? value : undefined
}

export const parseExternalSessionsShowAllTime = (
  searchParams: Pick<URLSearchParams, 'get'>
) => searchParams.get(externalSessionsTimeQueryKey)?.trim() === 'all'
