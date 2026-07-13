import { describe, expect, it } from 'vitest'

import {
  SKILL_MARKET_PAGE_SIZE,
  SKILL_MARKET_SWR_OPTIONS,
  resolveSkillMarketOffset,
  resolveSkillMarketPage,
  resolveSkillMarketPageForTotal
} from '#~/components/knowledge-base/components/use-skill-market-search'

describe('skill market pagination helpers', () => {
  it('uses a fixed twenty-item page and resolves offsets', () => {
    expect(SKILL_MARKET_PAGE_SIZE).toBe(20)
    expect(resolveSkillMarketOffset(1)).toBe(0)
    expect(resolveSkillMarketOffset(3)).toBe(40)
    expect(resolveSkillMarketOffset(0)).toBe(0)
  })

  it('does not present previous-page items under the next page number while loading', () => {
    expect(SKILL_MARKET_SWR_OPTIONS.keepPreviousData).toBe(false)
  })

  it('clamps the active page when result totals change', () => {
    expect(resolveSkillMarketPage(3, 41)).toBe(3)
    expect(resolveSkillMarketPage(3, 40)).toBe(2)
    expect(resolveSkillMarketPage(2, 0)).toBe(1)
  })

  it('keeps the requested page while a new page has no response yet', () => {
    expect(resolveSkillMarketPageForTotal(2, undefined)).toBe(2)
    expect(resolveSkillMarketPageForTotal(2, 40)).toBe(2)
    expect(resolveSkillMarketPageForTotal(3, 40)).toBe(2)
  })
})
