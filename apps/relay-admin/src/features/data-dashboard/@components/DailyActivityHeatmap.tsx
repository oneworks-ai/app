import './DailyActivityHeatmap.css'

import { Tooltip } from 'antd'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  createDailyActivityHeatmapWeeks,
  getDailyActivityHeatLevel,
  resolveDailyActivityHeatmapSelection
} from '../@core/daily-activity-heatmap'
import type { DailyActivityDateRange, DailyActivityHeatmapDay } from '../@core/daily-activity-heatmap'

const createWeekdayLabels = (locale: string) => {
  const formatter = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' })
  const sunday = new Date('2026-08-02T00:00:00.000Z')
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(sunday)
    day.setUTCDate(sunday.getUTCDate() + index)
    return formatter.format(day)
  })
}

const formatDate = (date: string, locale: string) => (
  new Date(`${date}T00:00:00.000Z`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric'
  })
)

export const DailyActivityHeatmap = ({
  days,
  locale,
  selection,
  onSelectionChange
}: {
  days: DailyActivityHeatmapDay[]
  locale: string
  selection?: DailyActivityDateRange
  onSelectionChange: (selection?: DailyActivityDateRange) => void
}) => {
  const [anchorIndex, setAnchorIndex] = useState<number>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const weeks = useMemo(() => createDailyActivityHeatmapWeeks(days, locale), [days, locale])
  const totals = useMemo(
    () => days.filter(day => day.available).map(day => day.total),
    [days]
  )
  const weekdayLabels = useMemo(() => createWeekdayLabels(locale), [locale])
  const firstAvailableDate = days.find(day => day.available)?.date ?? ''
  const dateWindowKey = days.length === 0
    ? ''
    : `${days[0]!.date}:${firstAvailableDate}:${days.at(-1)!.date}`
  const previousDateWindowKeyRef = useRef(dateWindowKey)
  const selectedDays = selection == null
    ? []
    : days.filter(day => day.available && day.date >= selection.from && day.date <= selection.to)
  const selectedTotal = selectedDays.reduce((total, day) => total + day.total, 0)

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (scroll == null || dateWindowKey === '') return
    scroll.scrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
  }, [dateWindowKey])

  useEffect(() => {
    const previousDateWindowKey = previousDateWindowKeyRef.current
    previousDateWindowKeyRef.current = dateWindowKey
    if (previousDateWindowKey === '' || previousDateWindowKey === dateWindowKey) return
    setAnchorIndex(undefined)
    onSelectionChange()
  }, [dateWindowKey, onSelectionChange])

  const selectDay = (index: number, shiftKey: boolean) => {
    const next = resolveDailyActivityHeatmapSelection({
      anchorIndex,
      current: selection,
      days,
      index,
      shiftKey
    })
    setAnchorIndex(next.anchorIndex)
    onSelectionChange(next.range)
  }

  return (
    <div className='relay-data-dashboard__heatmap'>
      <div className='relay-data-dashboard__heatmap-scroll' ref={scrollRef}>
        <div
          aria-label='每日观测活跃用户热力图'
          className='relay-data-dashboard__heatmap-chart'
          role='grid'
          onKeyDown={event => {
            if (event.key !== 'Escape' || selection == null) return
            event.preventDefault()
            onSelectionChange()
          }}
        >
          <div aria-hidden='true' className='relay-data-dashboard__heatmap-months'>
            <span className='relay-data-dashboard__heatmap-month-spacer' />
            {weeks.map((week, index) => (
              <span className='relay-data-dashboard__heatmap-month' key={index}>
                {week.monthLabel}
              </span>
            ))}
          </div>
          <div className='relay-data-dashboard__heatmap-rows' role='rowgroup'>
            {weekdayLabels.map((weekday, weekdayIndex) => (
              <div className='relay-data-dashboard__heatmap-row' key={weekday} role='row'>
                <span
                  className={`relay-data-dashboard__heatmap-weekday${weekdayIndex % 2 === 1 ? ' is-visible' : ''}`}
                  role='rowheader'
                >
                  {weekday}
                </span>
                {weeks.map((week, weekIndex) => {
                  const day = week.days[weekdayIndex]
                  if (day == null) {
                    return (
                      <span
                        aria-hidden='true'
                        className='relay-data-dashboard__heatmap-day is-empty'
                        key={weekIndex}
                      />
                    )
                  }
                  const index = days.indexOf(day)
                  const selected = selection != null &&
                    day.date >= selection.from && day.date <= selection.to
                  const label = !day.available
                    ? `${formatDate(day.date, locale)} · 超出当前数据保留窗口`
                    : day.total === 0
                    ? `${formatDate(day.date, locale)} · 无观测活跃用户`
                    : `${formatDate(day.date, locale)} · ${day.total} 位观测活跃用户`
                  if (!day.available) {
                    return (
                      <Tooltip key={day.date} title={label}>
                        <span
                          aria-label={label}
                          className='relay-data-dashboard__heatmap-day is-unavailable'
                          role='gridcell'
                        />
                      </Tooltip>
                    )
                  }
                  return (
                    <Tooltip key={day.date} title={label}>
                      <button
                        aria-label={label}
                        aria-pressed={selected}
                        className={[
                          'relay-data-dashboard__heatmap-day',
                          `is-level-${getDailyActivityHeatLevel(day.total, totals)}`,
                          selected ? 'is-selected' : '',
                          selection?.from === day.date ? 'is-range-start' : ''
                        ].filter(Boolean).join(' ')}
                        role='gridcell'
                        type='button'
                        onClick={event => selectDay(index, event.shiftKey)}
                      />
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className='relay-data-dashboard__heatmap-footer'>
        <span aria-live='polite' className='relay-data-dashboard__heatmap-selection'>
          {selection == null
            ? null
            : `已选择 ${selectedDays.length} 天 · ${selectedTotal} 用户日`}
        </span>
        <span aria-label='活跃用户强度：从少到多' className='relay-data-dashboard__heatmap-legend'>
          <span>少</span>
          {Array.from({ length: 5 }, (_, level) => (
            <i className={`is-level-${level}`} key={level} />
          ))}
          <span>多</span>
        </span>
      </div>
    </div>
  )
}
