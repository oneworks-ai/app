import type { UsageReport } from '@oneworks/types'

export const USAGE_ACTIVITY_DAYS = 365
export const USAGE_MAX_SELECTION_DAYS = 31

export interface UsageHeatmapDay {
  date: Date
  total: number
}

export interface UsageHeatmapWeek {
  days: Array<UsageHeatmapDay | undefined>
  monthLabel?: string
}

export interface UsageDateRange {
  from: number
  to: number
}

export const getUsageHeatmapLatestScrollLeft = ({
  clientWidth,
  scrollWidth
}: {
  clientWidth: number
  scrollWidth: number
}) => Math.max(0, scrollWidth - clientWidth)

const getDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const createLocalDayStart = (date: Date) => {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

export const createUsageRangeStart = (
  rangeDays = USAGE_ACTIVITY_DAYS,
  now = new Date()
) => {
  const first = createLocalDayStart(now)
  first.setDate(first.getDate() - (rangeDays - 1))
  return first.getTime()
}

export const createUsageHeatmapDays = (
  report: UsageReport,
  rangeDays = USAGE_ACTIVITY_DAYS,
  now = new Date()
): UsageHeatmapDay[] => {
  const values = new Map(report.activity.map(bucket => [bucket.key, bucket]))
  const last = createLocalDayStart(now)
  const first = new Date(last)
  first.setDate(last.getDate() - (rangeDays - 1))
  return Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(first)
    date.setDate(first.getDate() + index)
    const bucket = values.get(getDateKey(date))
    return { date, total: bucket?.total ?? 0 }
  })
}

export const createUsageHeatmapWeeks = (
  days: UsageHeatmapDay[],
  locale: string
): UsageHeatmapWeek[] => {
  if (days.length === 0) return []
  const leadingDays = days[0]!.date.getDay()
  const weeks = Array.from(
    { length: Math.ceil((leadingDays + days.length) / 7) },
    (): UsageHeatmapWeek => ({ days: Array.from({ length: 7 }) })
  )
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short' })

  days.forEach((day, index) => {
    const offset = leadingDays + index
    const week = weeks[Math.floor(offset / 7)]!
    week.days[offset % 7] = day
    if (day.date.getDate() === 1) {
      week.monthLabel = monthFormatter.format(day.date)
    }
  })
  return weeks
}

export const createUsageDateRange = (
  first: UsageHeatmapDay,
  last: UsageHeatmapDay
): UsageDateRange => {
  const from = createLocalDayStart(first.date)
  const after = createLocalDayStart(last.date)
  after.setDate(after.getDate() + 1)
  return {
    from: from.getTime(),
    to: after.getTime() - 1
  }
}

export const resolveUsageHeatmapSelection = (input: {
  anchorIndex?: number
  current?: UsageDateRange
  days: UsageHeatmapDay[]
  index: number
  shiftKey: boolean
}) => {
  const { days, index, shiftKey } = input
  const selectedDay = days[index]
  if (selectedDay == null) return { anchorIndex: input.anchorIndex }

  if (!shiftKey || input.anchorIndex == null) {
    const range = createUsageDateRange(selectedDay, selectedDay)
    const shouldClear = input.current?.from === range.from &&
      input.current?.to === range.to
    return {
      anchorIndex: index,
      range: shouldClear ? undefined : range
    }
  }

  const direction = index >= input.anchorIndex ? 1 : -1
  const boundedIndex = input.anchorIndex +
    direction * Math.min(
        Math.abs(index - input.anchorIndex),
        USAGE_MAX_SELECTION_DAYS - 1
      )
  const firstIndex = Math.min(input.anchorIndex, boundedIndex)
  const lastIndex = Math.max(input.anchorIndex, boundedIndex)
  return {
    anchorIndex: input.anchorIndex,
    range: createUsageDateRange(days[firstIndex]!, days[lastIndex]!)
  }
}

export const getUsageHeatLevel = (
  total: number,
  totals: number[]
) => {
  if (total <= 0) return 0
  const positive = totals.filter(value => value > 0).sort((left, right) => left - right)
  if (positive.length === 0) return 0
  const rank = positive.filter(value => value <= total).length
  return Math.max(1, Math.min(4, Math.ceil(rank / positive.length * 4)))
}
