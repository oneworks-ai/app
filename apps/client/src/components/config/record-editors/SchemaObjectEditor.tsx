/* eslint-disable max-lines -- Schema field selection and its shared workspace-file picker form one editor boundary. */
import './RecordEditors.scss'

import { Button, Input, InputNumber, Switch } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'

import type { ConfigUiField, ConfigUiFieldOption, ConfigUiObjectSchema } from '@oneworks/types'

import { ComplexTextEditor, StringArrayEditor } from '../ConfigEditors'
import { FieldRow } from '../ConfigFieldRow'
import { getTypeIcon, getValueByPath, isSensitiveKey, setValueByPath } from '../configUtils'
import type { TranslationFn } from '../configUtils'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { ContextFilePicker } from '#~/components/workspace/ContextFilePicker'
import { toLabel } from './schemaRecordUtils'

const buildSelectOptions = (options: ConfigUiFieldOption[] = []) => (
  options.map(option => ({
    value: option.value,
    label: option.label ?? option.value
  }))
)
const resolveFieldIcon = (field: ConfigUiField) => {
  if (field.icon != null) return field.icon
  if (field.type === 'json') return getTypeIcon('object')
  if (field.type === 'string[]') return getTypeIcon('array')
  if (field.type === 'select' || field.type === 'multiline') return getTypeIcon('string')
  if (field.type === 'string' || field.type === 'number' || field.type === 'boolean') {
    return getTypeIcon(field.type)
  }
  return getTypeIcon('object')
}

export const SchemaObjectEditor = ({
  value,
  schema,
  onChange,
  onCommit,
  t,
  hideFieldPaths,
  visibleFieldPaths,
  resolveFieldValue,
  resolveFieldLabel,
  resolveFieldDescription,
  resolveFieldOptions
}: {
  value: Record<string, unknown>
  schema: ConfigUiObjectSchema
  onChange: (nextValue: Record<string, unknown>) => void
  onCommit?: (nextValue: Record<string, unknown>) => void
  t: TranslationFn
  hideFieldPaths?: string[][]
  visibleFieldPaths?: string[][]
  resolveFieldValue?: (field: ConfigUiField, currentValue: unknown, defaultValue: unknown) => unknown
  resolveFieldLabel?: (field: ConfigUiField, fallback: string) => string
  resolveFieldDescription?: (field: ConfigUiField, fallback: string) => string
  resolveFieldOptions?: (field: ConfigUiField) => ConfigUiFieldOption[] | undefined
}) => {
  const [filePickerField, setFilePickerField] = useState<ConfigUiField | null>(null)

  const renderField = (field: ConfigUiField) => {
    if (
      visibleFieldPaths != null && !visibleFieldPaths.some(visiblePath => (
        field.path.length === visiblePath.length &&
        field.path.every((segment, index) => segment === visiblePath[index])
      ))
    ) {
      return null
    }

    if (
      hideFieldPaths?.some(hiddenPath => (
        field.path.length === hiddenPath.length &&
        field.path.every((segment, index) => segment === hiddenPath[index])
      ))
    ) {
      return null
    }

    const currentValue = getValueByPath(value, field.path)
    const valueToUse = resolveFieldValue == null
      ? (currentValue !== undefined ? currentValue : field.defaultValue)
      : resolveFieldValue(field, currentValue, field.defaultValue)
    const fallbackTitle = field.label ?? toLabel(field.path[field.path.length - 1] ?? '')
    const fallbackDescription = field.description ?? ''
    const title = resolveFieldLabel?.(field, fallbackTitle) ?? fallbackTitle
    const description = resolveFieldDescription?.(field, fallbackDescription) ?? fallbackDescription
    const resolvedOptions = resolveFieldOptions?.(field)
    const nextValue = (updated: unknown) => {
      onChange(setValueByPath(value, field.path, updated) as Record<string, unknown>)
    }

    let control: ReactNode = null
    const stacked = field.type === 'json' || field.type === 'multiline' || field.type === 'string[]'

    if (field.type === 'string' && field.control === 'workspace-file') {
      control = (
        <div className='config-view__workspace-file-control'>
          <Input
            value={typeof valueToUse === 'string' ? valueToUse : ''}
            onChange={(event) => nextValue(event.target.value)}
            placeholder={field.placeholder}
          />
          <Button
            aria-label={t('common.select')}
            icon={<span className='material-symbols-rounded' aria-hidden='true'>folder_open</span>}
            title={t('common.select')}
            onClick={() => setFilePickerField(field)}
          />
        </div>
      )
    } else if (field.type === 'string' && resolvedOptions != null) {
      control = (
        <Select
          aria-label={title}
          allowClear
          value={typeof valueToUse === 'string' && valueToUse !== '' ? valueToUse : undefined}
          options={buildSelectOptions(resolvedOptions)}
          placeholder={field.placeholder}
          onChange={(selected) => nextValue(typeof selected === 'string' ? selected : undefined)}
        />
      )
    } else if (field.type === 'string') {
      const sensitive = field.sensitive === true || isSensitiveKey(field.path[field.path.length - 1] ?? '')
      control = sensitive
        ? (
          <Input.Password
            aria-label={title}
            value={typeof valueToUse === 'string' ? valueToUse : ''}
            onChange={(event) => nextValue(event.target.value)}
            placeholder={field.placeholder ?? t('config.editor.secretPlaceholder')}
          />
        )
        : (
          <Input
            aria-label={title}
            value={typeof valueToUse === 'string' ? valueToUse : ''}
            onChange={(event) => nextValue(event.target.value)}
            placeholder={field.placeholder}
          />
        )
    } else if (field.type === 'multiline') {
      control = (
        <Input.TextArea
          aria-label={title}
          value={typeof valueToUse === 'string' ? valueToUse : ''}
          onChange={(event) => nextValue(event.target.value)}
          autoSize={{ minRows: 2 }}
          placeholder={field.placeholder}
        />
      )
    } else if (field.type === 'number') {
      control = (
        <InputNumber
          aria-label={title}
          value={typeof valueToUse === 'number' ? valueToUse : undefined}
          onChange={(input) => nextValue(typeof input === 'number' ? input : undefined)}
        />
      )
    } else if (field.type === 'boolean') {
      control = (
        <Switch
          aria-label={title}
          checked={Boolean(valueToUse)}
          onChange={(checked) => nextValue(checked)}
        />
      )
    } else if (field.type === 'string[]') {
      control = (
        <StringArrayEditor
          ariaLabel={title}
          value={Array.isArray(valueToUse) ? valueToUse.filter(item => typeof item === 'string') : []}
          onChange={(items) => nextValue(items)}
          t={t}
        />
      )
    } else if (field.type === 'select') {
      control = (
        <Select
          aria-label={title}
          value={typeof valueToUse === 'string' ? valueToUse : undefined}
          options={buildSelectOptions(resolvedOptions ?? field.options ?? [])}
          onChange={(selected) => nextValue(selected)}
        />
      )
    } else {
      control = (
        <ComplexTextEditor
          ariaLabel={title}
          value={valueToUse ?? {}}
          onChange={(updated) => nextValue(updated)}
        />
      )
    }

    return (
      <FieldRow
        key={field.path.join('.')}
        title={title}
        description={description}
        icon={resolveFieldIcon(field)}
        layout={stacked ? 'stacked' : 'inline'}
      >
        {control}
      </FieldRow>
    )
  }

  return (
    <>
      <div className='config-view__record-fields'>
        {schema.fields.map(renderField)}
      </div>
      <ContextFilePicker
        multiple={false}
        open={filePickerField != null}
        selectableTypes='files'
        selectedPaths={filePickerField == null
          ? []
          : [getValueByPath(value, filePickerField.path)].filter(
            (item): item is string => typeof item === 'string' && item !== ''
          )}
        onCancel={() => setFilePickerField(null)}
        onConfirm={(files) => {
          const selectedPath = files[0]?.path
          if (filePickerField == null || selectedPath == null) return
          const nextValue = setValueByPath(
            value,
            filePickerField.path,
            selectedPath
          ) as Record<string, unknown>
          onChange(nextValue)
          onCommit?.(nextValue)
          setFilePickerField(null)
        }}
      />
    </>
  )
}
