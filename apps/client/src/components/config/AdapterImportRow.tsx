import './AdapterImportRow.scss'

import { Button, Tooltip } from 'antd'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { getAdapterDisplay, resolveAdapterDisplayIcon } from '#~/resources/adapters'

export interface AdapterImportOption {
  adapterKey: string
  description?: string
  runtimeAdapter: string
  title: string
}

export interface AdapterImportAction {
  actionLabel: string
  adapters: AdapterImportOption[]
  buttonLabel: string
  disabled?: boolean
  emptyLabel: string
  loading?: boolean
  mobileTitle: string
  onAdapterChange: (adapterKey: string) => void
  onClick?: () => void
  optionsLoading?: boolean
  placeholder: string
  selectedAdapterKey?: string
  selectDisabled?: boolean
  selectLabel: string
  title?: ReactNode
}

interface AdapterImportSelectOption {
  label: ReactNode
  searchText: string
  selectedLabel: ReactNode
  value: string
}

const filterImportOption = (inputValue: string, option?: AdapterImportSelectOption) => {
  const keyword = inputValue.trim().toLowerCase()
  return keyword === '' || option?.searchText.includes(keyword) === true
}

const renderAdapterImportIcon = (displayIcon?: string) => (
  <span className='config-view__adapter-import-option-icon' aria-hidden='true'>
    {displayIcon != null
      ? <img src={displayIcon} alt='' />
      : <span className='material-symbols-rounded'>deployed_code</span>}
  </span>
)

export function AdapterImportSelect({ action }: { action: AdapterImportAction }) {
  const { resolvedThemeMode } = useResolvedThemeMode()
  const options = useMemo<AdapterImportSelectOption[]>(() => (
    action.adapters.map((adapter) => {
      const display = getAdapterDisplay(adapter.runtimeAdapter)
      const displayIcon = resolveAdapterDisplayIcon(display, resolvedThemeMode)
      const title = adapter.title.trim() !== '' ? adapter.title : display.title
      const detail = [
        display.title !== title ? display.title : undefined,
        adapter.adapterKey !== adapter.runtimeAdapter ? adapter.adapterKey : undefined
      ].filter((item): item is string => item != null).join(' · ')
      return {
        value: adapter.adapterKey,
        selectedLabel: (
          <span className='config-view__adapter-import-selected'>
            {renderAdapterImportIcon(displayIcon)}
            <span className='config-view__adapter-import-selected-title'>{title}</span>
          </span>
        ),
        searchText: [
          adapter.adapterKey,
          adapter.runtimeAdapter,
          adapter.title,
          adapter.description,
          display.title
        ].filter(Boolean).join(' ').toLowerCase(),
        label: (
          <div className='config-view__adapter-import-option'>
            {renderAdapterImportIcon(displayIcon)}
            <span className='config-view__option'>
              <span className='config-view__option-title'>{title}</span>
              {detail !== '' && <span className='config-view__option-desc'>{detail}</span>}
            </span>
          </div>
        )
      }
    })
  ), [action.adapters, resolvedThemeMode])

  return (
    <div className='config-view__adapter-import-select'>
      <Select<string, AdapterImportSelectOption>
        aria-label={action.selectLabel}
        disabled={action.loading || action.optionsLoading || action.selectDisabled}
        filterOption={filterImportOption}
        loading={action.optionsLoading}
        mobileTitle={action.mobileTitle}
        notFoundContent={action.emptyLabel}
        optionLabelProp='selectedLabel'
        options={options}
        placeholder={action.placeholder}
        showSearch
        value={action.selectedAdapterKey}
        onChange={action.onAdapterChange}
      />
    </div>
  )
}

export function AdapterImportRow({ action }: { action: AdapterImportAction }) {
  return (
    <div className='config-view__record-add config-view__adapter-import-row'>
      <div className='config-view__record-add-inputs'>
        <AdapterImportSelect action={action} />
        <Tooltip title={action.title ?? action.actionLabel}>
          <Button
            size='small'
            type='primary'
            className='config-view__icon-button config-view__adapter-import-button'
            aria-label={action.actionLabel}
            aria-busy={action.loading === true || undefined}
            aria-disabled={action.disabled === true || action.loading === true || action.optionsLoading === true ||
              undefined}
            loading={action.loading}
            disabled={action.disabled || action.optionsLoading}
            icon={<span className='material-symbols-rounded'>file_download</span>}
            onClick={() => action.onClick?.()}
          />
        </Tooltip>
      </div>
    </div>
  )
}
