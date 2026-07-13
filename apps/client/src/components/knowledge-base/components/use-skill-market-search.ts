import React from 'react'
import useSWR from 'swr'

import { searchSkillHub } from '#~/api.js'
import type { SkillHubInstallFilter, SkillHubSortKey } from './skill-hub-utils'

export const SKILL_MARKET_PAGE_SIZE = 20
export const SKILL_MARKET_SWR_OPTIONS = { keepPreviousData: false } as const

export const resolveSkillMarketOffset = (page: number, pageSize = SKILL_MARKET_PAGE_SIZE) => (
  Math.max(Math.trunc(page) - 1, 0) * pageSize
)

export const resolveSkillMarketPage = (page: number, total: number, pageSize = SKILL_MARKET_PAGE_SIZE) => (
  Math.min(Math.max(Math.trunc(page), 1), Math.max(Math.ceil(total / pageSize), 1))
)

export const resolveSkillMarketPageForTotal = (
  page: number,
  total: number | undefined,
  pageSize = SKILL_MARKET_PAGE_SIZE
) => total == null ? page : resolveSkillMarketPage(page, total, pageSize)

export function useSkillMarketSearch(params: {
  installFilter: SkillHubInstallFilter
  marketQuery: string
  registry: string
  sortKey: SkillHubSortKey
  sourceFilter: string
  viewMode: 'project' | 'market'
}) {
  const [page, setPage] = React.useState(1)
  const offset = resolveSkillMarketOffset(page)
  const { data, isLoading, isValidating, mutate } = useSWR(
    params.viewMode === 'market'
      ? [
        'skill-hub-search',
        params.registry,
        params.marketQuery,
        params.sourceFilter,
        params.installFilter,
        params.sortKey,
        page
      ]
      : null,
    () =>
      searchSkillHub({
        installFilter: params.installFilter,
        limit: SKILL_MARKET_PAGE_SIZE,
        offset,
        query: params.marketQuery,
        registry: params.registry,
        sort: params.sortKey,
        source: params.sourceFilter
      }),
    SKILL_MARKET_SWR_OPTIONS
  )
  const resetKey = [
    params.marketQuery,
    params.registry,
    params.sourceFilter,
    params.installFilter,
    params.sortKey,
    String(page)
  ].join('\0')

  React.useEffect(() => {
    setPage(1)
  }, [params.installFilter, params.marketQuery, params.registry, params.sortKey, params.sourceFilter])
  React.useEffect(() => {
    setPage(current => resolveSkillMarketPageForTotal(current, data?.total))
  }, [data?.total])

  return {
    data,
    isLoading,
    isValidating,
    mutate,
    page,
    pageSize: SKILL_MARKET_PAGE_SIZE,
    resetKey,
    setPage
  }
}
