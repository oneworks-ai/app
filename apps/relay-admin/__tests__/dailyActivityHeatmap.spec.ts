import { describe, expect, it } from 'vitest'

import {
  createDailyActivityHeatmapDays,
  createDailyActivityHeatmapWeeks,
  getDailyActivityHeatLevel,
  resolveDailyActivityHeatmapSelection
} from '../src/features/data-dashboard/@core/daily-activity-heatmap'

const point = (date: string, activeUsers: number) => ({
  activeUsers,
  date,
  errorEvents: 0,
  startupAttempts: 0,
  totalEvents: activeUsers
})

describe('relay admin daily activity heatmap', () => {
  it('builds a continuous UTC year and marks only retained days as available', () => {
    const days = createDailyActivityHeatmapDays(
      [point('2026-08-10', 3)],
      new Date('2026-08-10T12:00:00.000Z'),
      30
    )

    expect(days).toHaveLength(365)
    expect(days[0]).toEqual({ available: false, date: '2025-08-11', total: 0 })
    expect(days.at(-30)?.available).toBe(true)
    expect(days.at(-1)).toEqual({ available: true, date: '2026-08-10', total: 3 })
  })

  it('groups UTC days into calendar weeks with localized month labels', () => {
    const days = createDailyActivityHeatmapDays(
      [],
      new Date('2026-08-10T12:00:00.000Z'),
      30,
      14
    )
    const weeks = createDailyActivityHeatmapWeeks(days, 'zh-CN')

    expect(weeks).toHaveLength(3)
    expect(weeks.flatMap(week => week.days).filter(Boolean)).toHaveLength(14)
    expect(weeks.some(week => week.monthLabel === '8月')).toBe(true)
  })

  it('matches the client single-day, toggle, shift-range, and 31-day cap behavior', () => {
    const days = createDailyActivityHeatmapDays(
      [],
      new Date('2026-08-10T12:00:00.000Z'),
      365,
      60
    )
    const first = resolveDailyActivityHeatmapSelection({
      days,
      index: 10,
      shiftKey: false
    })
    const range = resolveDailyActivityHeatmapSelection({
      anchorIndex: first.anchorIndex,
      current: first.range,
      days,
      index: 59,
      shiftKey: true
    })
    const toggled = resolveDailyActivityHeatmapSelection({
      anchorIndex: first.anchorIndex,
      current: first.range,
      days,
      index: 10,
      shiftKey: false
    })

    expect(first.range).toEqual({ from: days[10]!.date, to: days[10]!.date })
    expect(range.range).toEqual({ from: days[10]!.date, to: days[40]!.date })
    expect(toggled.range).toBeUndefined()
  })

  it('uses relative distribution for the four activity levels', () => {
    expect([0, 1, 2, 3, 4].map(total => getDailyActivityHeatLevel(total, [0, 1, 2, 3, 4])))
      .toEqual([0, 1, 2, 3, 4])
  })
})
