import React from 'react'

import { getToolInlineValueText } from './tool-display'

export interface ToolRecordView {
  detail?: unknown
  meta?: string
  status?: string
  subtitle?: string
  title: string
}

const recordStatusTone = (status?: string) => {
  const normalized = status?.toLowerCase() ?? ''
  if (['completed', 'succeeded', 'success', 'passed', 'ok'].includes(normalized)) return 'success'
  if (['failed', 'failure', 'error', 'cancelled'].includes(normalized)) return 'error'
  return 'default'
}

const flattenDetail = (value: unknown, prefix = '', depth = 0): string[] => {
  if (value == null || value === '') return []
  if (typeof value !== 'object') return [`${prefix === '' ? '' : `${prefix}: `}${String(value)}`]
  if (depth >= 2) return [`${prefix === '' ? '' : `${prefix}: `}${getToolInlineValueText(value)}`]
  if (Array.isArray(value)) {
    return value.slice(0, 4).flatMap((item, index) => flattenDetail(item, `${prefix}[${index}]`, depth + 1))
  }
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 6)
    .flatMap(([key, item]) => flattenDetail(item, prefix === '' ? key : `${prefix}.${key}`, depth + 1))
}

export function ToolRecordField({
  icon,
  label,
  records
}: {
  icon: string
  label: string
  records: ToolRecordView[]
}) {
  return (
    <>
      <div className='tool-detail-section__header tool-detail-section__header--labeled'>
        <span className='tool-detail-section__icon material-symbols-rounded'>{icon}</span>
        <span className='tool-detail-section__title'>{label}</span>
        <span className='tool-detail-section__count'>{records.length}</span>
      </div>
      <div className='tool-record-list'>
        {records.map((record, recordIndex) => {
          const detailItems = flattenDetail(record.detail)
          return (
            <div className='tool-record' key={`${record.title}-${recordIndex}`}>
              <span className='tool-record__index'>{recordIndex + 1}</span>
              <div className='tool-record__content'>
                <div className='tool-record__main'>
                  <span className='tool-record__title'>{record.title}</span>
                  {record.subtitle != null && <span className='tool-record__subtitle'>{record.subtitle}</span>}
                  {record.status != null && (
                    <span className={`tool-record__status tool-record__status--${recordStatusTone(record.status)}`}>
                      {record.status}
                    </span>
                  )}
                </div>
                {record.meta != null && <div className='tool-record__meta'>{record.meta}</div>}
                {detailItems.length > 0 && (
                  <div className='tool-record__details'>
                    {detailItems.map((item, detailIndex) => (
                      <span className='tool-record__detail' key={`${item}-${detailIndex}`}>{item}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
