import type { ChannelLinkAvailability, ChannelLinkWorkHour } from '@oneworks/types'

const DEFAULT_TIMEZONE = 'UTC'

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
}

let nowProvider = () => new Date()

export const clearAvailabilityGateStateForTests = () => {
  nowProvider = () => new Date()
}

export const getAvailabilityNow = () => nowProvider()

export const setAvailabilityNowProviderForTests = (provider: () => Date) => {
  nowProvider = provider
}

const parseTimeToMinutes = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(value.trim())
  if (match == null) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return hour * 60 + minute
}

const resolveZonedTimeParts = (date: Date, timezone: string) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      timeZone: timezone,
      weekday: 'short'
    }).formatToParts(date)
    const getPart = (type: string) => parts.find(part => part.type === type)?.value
    const weekday = WEEKDAY_TO_ISO[getPart('weekday') ?? '']
    const hour = Number(getPart('hour'))
    const minute = Number(getPart('minute'))
    if (weekday == null || !Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
    return {
      isoWeekday: weekday,
      minutes: hour * 60 + minute
    }
  } catch {
    return undefined
  }
}

const previousIsoWeekday = (weekday: number) => (weekday === 1 ? 7 : weekday - 1)

const workHourMatches = (
  workHour: ChannelLinkWorkHour,
  zoned: { isoWeekday: number; minutes: number }
) => {
  const start = parseTimeToMinutes(workHour.start)
  const end = parseTimeToMinutes(workHour.end)
  if (start == null || end == null) return false

  const days = Array.isArray(workHour.days) && workHour.days.length > 0
    ? workHour.days
    : [1, 2, 3, 4, 5, 6, 7]

  if (start === end) return days.includes(zoned.isoWeekday)
  if (start < end) {
    return days.includes(zoned.isoWeekday) && zoned.minutes >= start && zoned.minutes < end
  }
  return (
    (days.includes(zoned.isoWeekday) && zoned.minutes >= start) ||
    (days.includes(previousIsoWeekday(zoned.isoWeekday)) && zoned.minutes < end)
  )
}

export const isWithinAvailabilityWorkHours = (
  availability: ChannelLinkAvailability | undefined,
  date: Date = getAvailabilityNow()
) => {
  if (availability == null || availability.enabled === false) return true
  const workHours = availability.workHours
  if (!Array.isArray(workHours) || workHours.length === 0) return true

  const zoned = resolveZonedTimeParts(date, availability.timezone?.trim() || DEFAULT_TIMEZONE)
  if (zoned == null) return true
  return workHours.some(workHour => workHourMatches(workHour, zoned))
}
