import { Tooltip } from 'antd'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  createUsageHeatmapWeeks,
  getUsageHeatLevel,
  getUsageHeatmapLatestScrollLeft,
  resolveUsageHeatmapSelection
} from '../@core/usage-heatmap'
import type { UsageDateRange, UsageHeatmapDay } from '../@core/usage-heatmap'

const createWeekdayLabels = (locale: string) => {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const sunday = new Date(2026, 7, 2)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(sunday)
    day.setDate(sunday.getDate() + index)
    return formatter.format(day)
  })
}

export function UsageHeatmap({
  days,
  formatTotal,
  locale,
  selection,
  onSelectionChange
}: {
  days: UsageHeatmapDay[]
  formatTotal: (total: number) => string
  locale: string
  selection?: UsageDateRange
  onSelectionChange: (selection?: UsageDateRange) => void
}) {
  const { t } = useTranslation()
  const [anchorIndex, setAnchorIndex] = useState<number>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const weeks = useMemo(() => createUsageHeatmapWeeks(days, locale), [days, locale])
  const totals = useMemo(() => days.map(day => day.total), [days])
  const weekdayLabels = useMemo(() => createWeekdayLabels(locale), [locale])
  const dateWindowKey = days.length === 0
    ? ''
    : `${days[0]!.date.getTime()}:${days.at(-1)!.date.getTime()}`
  const selectedDays = selection == null
    ? []
    : days.filter(day => {
      const timestamp = day.date.getTime()
      return timestamp >= selection.from && timestamp <= selection.to
    })
  const selectedTotal = selectedDays.reduce((total, day) => total + day.total, 0)

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (scroll == null || dateWindowKey.length === 0) return
    scroll.scrollLeft = getUsageHeatmapLatestScrollLeft({
      clientWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth
    })
  }, [dateWindowKey])

  const selectDay = (index: number, shiftKey: boolean) => {
    const next = resolveUsageHeatmapSelection({
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
    <div className='usage-panel__heatmap'>
      <div className='usage-panel__heatmap-scroll' ref={scrollRef}>
        <div
          aria-label={t('usage.activity.label')}
          className='usage-panel__heatmap-chart'
          role='grid'
          onKeyDown={event => {
            if (event.key !== 'Escape' || selection == null) return
            event.preventDefault()
            onSelectionChange()
          }}
        >
          <div className='usage-panel__heatmap-months' aria-hidden='true'>
            <span className='usage-panel__heatmap-month-spacer' />
            {weeks.map((week, index) => (
              <span className='usage-panel__heatmap-month' key={index}>
                {week.monthLabel}
              </span>
            ))}
          </div>
          <div className='usage-panel__heatmap-rows' role='rowgroup'>
            {weekdayLabels.map((weekday, weekdayIndex) => (
              <div className='usage-panel__heatmap-row' key={weekday} role='row'>
                <span
                  className={`usage-panel__heatmap-weekday${weekdayIndex % 2 === 1 ? ' is-visible' : ''}`}
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
                        className='usage-panel__heatmap-day is-empty'
                        key={weekIndex}
                      />
                    )
                  }
                  const index = days.indexOf(day)
                  const timestamp = day.date.getTime()
                  const selected = selection != null &&
                    timestamp >= selection.from &&
                    timestamp <= selection.to
                  const label = day.total === 0
                    ? t('usage.activity.noUsageDayLabel', {
                      date: day.date.toLocaleDateString(locale)
                    })
                    : t('usage.activity.dayLabel', {
                      date: day.date.toLocaleDateString(locale),
                      tokens: formatTotal(day.total)
                    })
                  return (
                    <Tooltip key={day.date.toISOString()} title={label}>
                      <button
                        aria-label={label}
                        aria-pressed={selected}
                        className={[
                          'usage-panel__heatmap-day',
                          `is-level-${getUsageHeatLevel(day.total, totals)}`,
                          selected ? 'is-selected' : '',
                          selection?.from === timestamp ? 'is-range-start' : ''
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
      <div className='usage-panel__heatmap-footer'>
        <span className='usage-panel__heatmap-selection' aria-live='polite'>
          {selection == null
            ? null
            : t('usage.activity.selectionSummary', {
              count: selectedDays.length,
              tokens: formatTotal(selectedTotal)
            })}
        </span>
        <span className='usage-panel__heat-legend' aria-label={t('usage.activity.legendLabel')}>
          <span>{t('usage.activity.less')}</span>
          {Array.from({ length: 5 }, (_, level) => (
            <i className={`is-level-${level}`} key={level} />
          ))}
          <span>{t('usage.activity.more')}</span>
        </span>
      </div>
    </div>
  )
}
