import type { RelayAdminDiagnosticSeriesPoint } from '../../diagnostics/diagnosticsApi'

export const DAILY_ACTIVITY_HEATMAP_DAYS = 365
export const DAILY_ACTIVITY_MAX_SELECTION_DAYS = 31

export interface DailyActivityHeatmapDay {
  available: boolean
  date: string
  total: number
}

export interface DailyActivityHeatmapWeek {
  days: Array<DailyActivityHeatmapDay | undefined>
  monthLabel?: string
}

export interface DailyActivityDateRange {
  from: string
  to: string
}

const createUtcDayStart = (date: Date) => {
  const start = new Date(date)
  start.setUTCHours(0, 0, 0, 0)
  return start
}

const getUtcDateKey = (date: Date) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseUtcDateKey = (date: string) => new Date(`${date}T00:00:00.000Z`)

export const createDailyActivityHeatmapDays = (
  series: RelayAdminDiagnosticSeriesPoint[],
  through: Date,
  availableDays: number,
  rangeDays = DAILY_ACTIVITY_HEATMAP_DAYS
): DailyActivityHeatmapDay[] => {
  const values = new Map(series.map(item => [item.date, item.activeUsers]))
  const last = createUtcDayStart(through)
  const first = new Date(last)
  first.setUTCDate(first.getUTCDate() - (rangeDays - 1))
  const availableFrom = new Date(last)
  availableFrom.setUTCDate(availableFrom.getUTCDate() - (Math.max(1, availableDays) - 1))

  return Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(first)
    date.setUTCDate(first.getUTCDate() + index)
    const key = getUtcDateKey(date)
    return {
      available: date >= availableFrom,
      date: key,
      total: values.get(key) ?? 0
    }
  })
}

export const createDailyActivityHeatmapWeeks = (
  days: DailyActivityHeatmapDay[],
  locale: string
): DailyActivityHeatmapWeek[] => {
  if (days.length === 0) return []
  const leadingDays = parseUtcDateKey(days[0]!.date).getUTCDay()
  const weeks = Array.from(
    { length: Math.ceil((leadingDays + days.length) / 7) },
    (): DailyActivityHeatmapWeek => ({ days: Array.from({ length: 7 }) })
  )
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })

  days.forEach((day, index) => {
    const offset = leadingDays + index
    const week = weeks[Math.floor(offset / 7)]!
    week.days[offset % 7] = day
    if (day.date.endsWith('-01')) {
      week.monthLabel = monthFormatter.format(parseUtcDateKey(day.date))
    }
  })
  return weeks
}

export const resolveDailyActivityHeatmapSelection = (input: {
  anchorIndex?: number
  current?: DailyActivityDateRange
  days: DailyActivityHeatmapDay[]
  index: number
  shiftKey: boolean
}) => {
  const { days, index, shiftKey } = input
  const selectedDay = days[index]
  if (selectedDay == null || !selectedDay.available) return { anchorIndex: input.anchorIndex }

  if (!shiftKey || input.anchorIndex == null) {
    const range = { from: selectedDay.date, to: selectedDay.date }
    const shouldClear = input.current?.from === range.from && input.current?.to === range.to
    return {
      anchorIndex: index,
      range: shouldClear ? undefined : range
    }
  }

  const direction = index >= input.anchorIndex ? 1 : -1
  const boundedIndex = input.anchorIndex + direction * Math.min(
        Math.abs(index - input.anchorIndex),
        DAILY_ACTIVITY_MAX_SELECTION_DAYS - 1
      )
  const firstIndex = Math.min(input.anchorIndex, boundedIndex)
  const lastIndex = Math.max(input.anchorIndex, boundedIndex)
  return {
    anchorIndex: input.anchorIndex,
    range: {
      from: days[firstIndex]!.date,
      to: days[lastIndex]!.date
    }
  }
}

export const getDailyActivityHeatLevel = (total: number, totals: number[]) => {
  if (total <= 0) return 0
  const positive = totals.filter(value => value > 0).sort((left, right) => left - right)
  if (positive.length === 0) return 0
  const rank = positive.filter(value => value <= total).length
  return Math.max(1, Math.min(4, Math.ceil(rank / positive.length * 4)))
}
