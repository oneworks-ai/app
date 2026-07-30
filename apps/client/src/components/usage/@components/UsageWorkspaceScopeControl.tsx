import './UsageWorkspaceScopeControl.scss'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MobileAwareSelect } from '#~/components/mobile-aware-select/MobileAwareSelect'

import { USAGE_GLOBAL_WORKSPACE_SCOPE_ID, resolveUsageWorkspaceSelectionChange } from '../@core/usage-workspace-scope'
import type { UsageWorkspaceScopeOption } from '../@core/usage-workspace-scope'

interface UsageWorkspaceSelectOption {
  disabled?: boolean
  label: ReactNode
  value?: string
}

export function UsageWorkspaceScopeControl({
  globalAvailable,
  options,
  selection,
  onChange
}: {
  globalAvailable: boolean
  options: UsageWorkspaceScopeOption[]
  selection: string[]
  onChange: (selection: string[]) => void
}) {
  const { t } = useTranslation()
  const globalSelected = selection.includes(USAGE_GLOBAL_WORKSPACE_SCOPE_ID)
  const selectedOptions = options.filter(option => selection.includes(option.id))
  const summary = globalSelected
    ? t('usage.scope.global')
    : selectedOptions.length === 1
    ? selectedOptions[0]!.label
    : t('usage.scope.selectedCount', { count: selectedOptions.length })
  const summaryIcon = globalSelected ? 'language' : 'folder'
  const selectOptions: UsageWorkspaceSelectOption[] = [
    {
      disabled: !globalAvailable,
      label: (
        <span className='usage-workspace-scope-option'>
          <MaterialSymbol name='language' />
          <span>{t('usage.scope.global')}</span>
        </span>
      ),
      value: USAGE_GLOBAL_WORKSPACE_SCOPE_ID
    },
    ...options.map(item => ({
      label: (
        <span className='usage-workspace-scope-option'>
          <MaterialSymbol name='folder' />
          <span className='usage-workspace-scope-option__label'>{item.label}</span>
          {item.isCurrent && (
            <span className='usage-workspace-scope-option__current'>
              {t('usage.scope.current')}
            </span>
          )}
        </span>
      ),
      value: item.id
    }))
  ]

  return (
    <MobileAwareSelect<string[], UsageWorkspaceSelectOption>
      aria-label={t('usage.scope.selectorLabel')}
      className='usage-workspace-scope-select'
      maxTagCount={0}
      maxTagPlaceholder={
        <span className='usage-workspace-scope-summary'>
          <MaterialSymbol name={summaryIcon} />
          <span className='usage-workspace-scope-summary__label'>{summary}</span>
        </span>
      }
      mobileTitle={t('usage.scope.selectorLabel')}
      mode='multiple'
      options={selectOptions}
      placement='bottomRight'
      popupClassName='usage-workspace-scope-popup'
      showSearch={options.length > 5}
      value={selection}
      onChange={nextSelection => {
        onChange(resolveUsageWorkspaceSelectionChange(selection, nextSelection))
      }}
    />
  )
}
