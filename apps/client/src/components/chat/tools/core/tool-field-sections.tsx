import { Tooltip } from 'antd'
import React from 'react'

import { CodeBlock } from '#~/components/CodeBlock'
import { safeJsonStringify } from '#~/utils/safe-serialize'

import { TOOL_TOOLTIP_PROPS, getToolFieldIcon, getToolInlineValueText, getToolValueText } from './tool-display'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type ToolFieldFormat = 'inline' | 'text' | 'code' | 'list' | 'chips' | 'records' | 'json' | 'questions'

export interface ToolRecordView {
  detail?: unknown
  meta?: string
  status?: string
  subtitle?: string
  title: string
}

export interface ToolFieldView {
  labelKey: string
  fallbackLabel: string
  format: ToolFieldFormat
  value: unknown
  lang?: string
  records?: ToolRecordView[]
}

const getFieldKey = (field: ToolFieldView, index: number) => `${field.labelKey}-${index}`

const getSectionHeader = (icon: string, label: string) => (
  <div className='tool-detail-section__header'>
    <Tooltip title={label} {...TOOL_TOOLTIP_PROPS}>
      <span className='tool-detail-section__icon material-symbols-rounded'>{icon}</span>
    </Tooltip>
  </div>
)

const getLabeledSectionHeader = (icon: string, label: string, count?: number) => (
  <div className='tool-detail-section__header tool-detail-section__header--labeled'>
    <span className='tool-detail-section__icon material-symbols-rounded'>{icon}</span>
    <span className='tool-detail-section__title'>{label}</span>
    {count != null && <span className='tool-detail-section__count'>{count}</span>}
  </div>
)

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

export function ToolInlineFields({
  fields,
  t
}: {
  fields: ToolFieldView[]
  t: Translate
}) {
  if (fields.length === 0) {
    return null
  }

  return (
    <div
      className='tool-inline-token-list tool-inline-token-list--standalone'
      aria-label={t('chat.tools.fields.details')}
    >
      {fields.map((field, index) => {
        const label = t(field.labelKey, { defaultValue: field.fallbackLabel })
        const valueText = getToolInlineValueText(field.value)
        return (
          <Tooltip
            key={getFieldKey(field, index)}
            title={
              <div className='tool-tooltip-content'>
                <div className='tool-tooltip-content__title'>{label}</div>
                <div className='tool-tooltip-content__value'>{getToolValueText(field.value)}</div>
              </div>
            }
            {...TOOL_TOOLTIP_PROPS}
          >
            <div className='tool-inline-token'>
              <span className='tool-inline-token__icon material-symbols-rounded'>
                {getToolFieldIcon(field.labelKey, field.format)}
              </span>
              <span className='tool-inline-token__value'>{valueText}</span>
            </div>
          </Tooltip>
        )
      })}
    </div>
  )
}

export function renderToolBlockField(
  field: ToolFieldView,
  index: number,
  t: Translate,
  options: {
    sectionClassName?: string
  } = {}
) {
  const label = t(field.labelKey, { defaultValue: field.fallbackLabel })
  const sectionHeader = getSectionHeader(getToolFieldIcon(field.labelKey, field.format), label)
  const sectionClassName = options.sectionClassName ?? 'tool-detail-section'

  if (field.format === 'text') {
    return (
      <div className={sectionClassName} key={getFieldKey(field, index)}>
        {sectionHeader}
        <div className='tool-detail-section__text'>{String(field.value)}</div>
      </div>
    )
  }

  if (field.format === 'code') {
    return (
      <div className={sectionClassName} key={getFieldKey(field, index)}>
        {sectionHeader}
        <CodeBlock
          code={String(field.value)}
          lang={field.lang ?? 'text'}
          hideHeader={true}
        />
      </div>
    )
  }

  if (field.format === 'list') {
    const items = Array.isArray(field.value) ? field.value.map(item => String(item)) : []
    return (
      <div className={sectionClassName} key={getFieldKey(field, index)}>
        {sectionHeader}
        <div className='tool-detail-list'>
          {items.map(listItem => (
            <div className='tool-detail-list-item' key={listItem}>{listItem}</div>
          ))}
        </div>
      </div>
    )
  }

  if (field.format === 'chips') {
    const items = Array.isArray(field.value) ? field.value.map(item => String(item)) : []
    return (
      <div className={sectionClassName} key={getFieldKey(field, index)}>
        {getLabeledSectionHeader(getToolFieldIcon(field.labelKey, field.format), label, items.length)}
        <div className='tool-detail-chip-list'>
          {items.map((item, itemIndex) => (
            <span className='tool-detail-chip' key={`${item}-${itemIndex}`}>{item}</span>
          ))}
        </div>
      </div>
    )
  }

  if (field.format === 'records') {
    const records = field.records ?? []
    return (
      <div className={sectionClassName} key={getFieldKey(field, index)}>
        {getLabeledSectionHeader(getToolFieldIcon(field.labelKey, field.format), label, records.length)}
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
      </div>
    )
  }

  return (
    <div className={sectionClassName} key={getFieldKey(field, index)}>
      {sectionHeader}
      <CodeBlock
        code={safeJsonStringify(field.value, 2)}
        lang='json'
        hideHeader={true}
      />
    </div>
  )
}
