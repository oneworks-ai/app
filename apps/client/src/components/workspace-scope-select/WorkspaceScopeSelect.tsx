import './WorkspaceScopeSelect.scss'

import { Tooltip } from 'antd'
import type { DefaultOptionType } from 'antd/es/select'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'

const allScopeValue = '__oneworks_scope_select_all__'

export interface WorkspaceScopeSelectOption {
  label: string
  description?: string
  descriptionTooltip?: string
  icon?: string
  selectedLabel?: string
  title?: string
  value: string
}

interface WorkspaceScopeSelectProps {
  allLabel: string
  ariaLabel: string
  emptyLabel: string
  mobileTitle: string
  options: WorkspaceScopeSelectOption[]
  scope: 'project' | 'session'
  value: string | undefined
  className?: string
  disabled?: boolean
  showSearch?: boolean
  onChange: (value: string | undefined) => void
}

type WorkspaceScopeSelectInternalOption = DefaultOptionType & {
  icon: string
  label: ReactNode
  searchText: string
  selectedLabel: string
  title: string
  value: string
}

const mergeClassNames = (...classNames: Array<false | null | string | undefined>) =>
  classNames.filter(Boolean).join(' ') || undefined

const getDefaultScopeIcon = (scope: WorkspaceScopeSelectProps['scope']) => (
  scope === 'project' ? 'folder_open' : 'forum'
)

const getOptionSearchText = (option: WorkspaceScopeSelectOption) =>
  [
    option.label,
    option.description,
    option.descriptionTooltip,
    option.selectedLabel,
    option.title,
    option.value
  ].filter(Boolean).join(' ').toLowerCase()

export function WorkspaceScopeSelect({
  allLabel,
  ariaLabel,
  className,
  disabled,
  emptyLabel,
  mobileTitle,
  onChange,
  options,
  scope,
  showSearch = true,
  value
}: WorkspaceScopeSelectProps) {
  const filterOption = useMemo(() => (
    (inputValue: string, option?: WorkspaceScopeSelectInternalOption) => {
      const keyword = inputValue.trim().toLowerCase()
      if (keyword === '') return true
      return option?.searchText?.includes(keyword) === true
    }
  ), [])

  const selectOptions = useMemo<WorkspaceScopeSelectInternalOption[]>(() => [
    {
      icon: 'select_all',
      label: renderOptionLabel({
        icon: 'select_all',
        label: allLabel,
        selectedLabel: allLabel,
        title: allLabel,
        value: allScopeValue
      }),
      searchText: allLabel.toLowerCase(),
      selectedLabel: allLabel,
      title: allLabel,
      value: allScopeValue
    },
    ...options.map(option => ({
      icon: option.icon ?? getDefaultScopeIcon(scope),
      label: renderOptionLabel({
        ...option,
        icon: option.icon ?? getDefaultScopeIcon(scope)
      }),
      searchText: getOptionSearchText(option),
      selectedLabel: option.selectedLabel ?? option.label,
      title: option.title ?? option.label,
      value: option.value
    }))
  ], [allLabel, options, scope])

  return (
    <Select<string, WorkspaceScopeSelectInternalOption>
      aria-label={ariaLabel}
      className={mergeClassNames('workspace-scope-select', `workspace-scope-select--${scope}`, className)}
      disabled={disabled}
      mobileTitle={mobileTitle}
      notFoundContent={emptyLabel}
      options={selectOptions}
      popupClassName='workspace-scope-select-popup'
      showSearch={showSearch}
      filterOption={filterOption}
      optionLabelProp='selectedLabel'
      value={value ?? allScopeValue}
      onChange={(nextValue) => {
        onChange(typeof nextValue === 'string' && nextValue !== allScopeValue ? nextValue : undefined)
      }}
    />
  )
}

export function WorkspaceProjectSelect(
  props: Omit<WorkspaceScopeSelectProps, 'scope'>
) {
  return <WorkspaceScopeSelect {...props} scope='project' />
}

export function WorkspaceSessionSelect(
  props: Omit<WorkspaceScopeSelectProps, 'scope'>
) {
  return <WorkspaceScopeSelect {...props} scope='session' />
}

function renderOptionLabel(option: WorkspaceScopeSelectOption): ReactNode {
  const hasDescription = option.description != null && option.description.trim() !== ''
  const description = hasDescription
    ? <span className='workspace-scope-select__option-description'>{option.description}</span>
    : undefined
  return (
    <span className='workspace-scope-select__option'>
      <span className='material-symbols-rounded workspace-scope-select__option-icon' aria-hidden='true'>
        {option.icon}
      </span>
      <span className='workspace-scope-select__option-body'>
        <span className='workspace-scope-select__option-title'>{option.label}</span>
        {description == null
          ? null
          : option.descriptionTooltip == null || option.descriptionTooltip.trim() === ''
          ? description
          : (
            <Tooltip title={option.descriptionTooltip} placement='right' mouseEnterDelay={0.25}>
              {description}
            </Tooltip>
          )}
      </span>
    </span>
  )
}
