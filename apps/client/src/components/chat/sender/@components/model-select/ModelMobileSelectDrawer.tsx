/* eslint-disable max-lines -- mobile model selector mirrors desktop search and submenu navigation. */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelSelectMenuGroup, ModelSelectOption } from '#~/hooks/chat/use-chat-model-adapter-selection'

import {
  SenderMobileSelectBreadcrumbs,
  SenderMobileSelectDrawer,
  handleSenderMobileSelectOptionKeyDown
} from '../mobile-select-drawer/SenderMobileSelectDrawer'
import { ModelSelectOptionLabel } from './ModelSelectOptionLabel'

type ModelMobileView =
  | { kind: 'root' }
  | { kind: 'more' }
  | { kind: 'group'; groupKey: string }

export function ModelMobileSelectDrawer({
  builtinPreviewModelOptions,
  open,
  selectedModel,
  modelSearchValue,
  modelSearchOptions,
  modelMenuGroups,
  recommendedModelOptions,
  servicePreviewModelOptions,
  updatingRecommendedModelValue,
  onClose,
  onSearchChange,
  onSelectModel,
  onToggleRecommendedModel,
  onConnectMoreModelServices,
  onOpenModelServicesConfig
}: {
  builtinPreviewModelOptions?: ModelSelectOption[]
  open: boolean
  selectedModel?: string
  modelSearchValue: string
  modelSearchOptions?: ModelSelectOption[]
  modelMenuGroups?: ModelSelectMenuGroup[]
  recommendedModelOptions?: ModelSelectOption[]
  servicePreviewModelOptions?: ModelSelectOption[]
  updatingRecommendedModelValue?: string
  onClose: () => void
  onSearchChange: (value: string) => void
  onSelectModel: (value: string) => void
  onToggleRecommendedModel?: (option: ModelSelectOption) => void | Promise<void>
  onConnectMoreModelServices?: () => void
  onOpenModelServicesConfig?: () => void
}) {
  const { t } = useTranslation()
  const [modelView, setModelView] = useState<ModelMobileView>({ kind: 'root' })
  const hasModelSearchQuery = modelSearchValue.trim() !== ''
  const availableModelMenuGroups = useMemo(
    () => (modelMenuGroups ?? []).filter(group => group.options.length > 0),
    [modelMenuGroups]
  )
  const activeModelMenuGroup = modelView.kind === 'group'
    ? availableModelMenuGroups.find(group => group.key === modelView.groupKey)
    : undefined

  const filteredModelSearchOptions = useMemo(() => {
    const query = modelSearchValue.trim().toLowerCase()
    if (query === '') {
      return modelSearchOptions ?? []
    }

    return (modelSearchOptions ?? []).filter((option) => {
      const searchText = String(option.searchText ?? '')
      return searchText.toLowerCase().includes(query)
    })
  }, [modelSearchOptions, modelSearchValue])

  const rootModelSections = useMemo(() => ([
    {
      key: 'service-preview',
      title: t('chat.modelGroupServices'),
      options: servicePreviewModelOptions ?? [],
      showServicePrefix: true
    },
    {
      key: 'builtin-preview',
      title: t('chat.modelGroupBuiltinPreview', { defaultValue: '内置模型' }),
      options: builtinPreviewModelOptions ?? []
    },
    {
      key: 'recommended',
      title: t('chat.modelGroupRecommended'),
      options: recommendedModelOptions ?? [],
      showServicePrefix: true
    }
  ].filter(section => section.options.length > 0)), [
    builtinPreviewModelOptions,
    recommendedModelOptions,
    servicePreviewModelOptions,
    t
  ])

  useEffect(() => {
    if (!open) {
      setModelView({ kind: 'root' })
    }
  }, [open])

  useEffect(() => {
    if (modelView.kind === 'more' && availableModelMenuGroups.length === 0) {
      setModelView({ kind: 'root' })
      return
    }

    if (modelView.kind === 'group' && activeModelMenuGroup == null) {
      setModelView({ kind: 'more' })
    }
  }, [activeModelMenuGroup, availableModelMenuGroups.length, modelView.kind])

  const breadcrumbs = useMemo(() => {
    if (hasModelSearchQuery) {
      return []
    }

    const items = [{
      key: 'root',
      label: t('chat.modelSelectPlaceholder'),
      onClick: modelView.kind === 'root' ? undefined : () => setModelView({ kind: 'root' })
    }]

    if (modelView.kind === 'more' || modelView.kind === 'group') {
      items.push({
        key: 'more',
        label: t('chat.modelMoreModels'),
        onClick: modelView.kind === 'more' ? undefined : () => setModelView({ kind: 'more' })
      })
    }

    if (modelView.kind === 'group' && activeModelMenuGroup != null) {
      items.push({
        key: activeModelMenuGroup.key,
        label: activeModelMenuGroup.title,
        onClick: undefined
      })
    }

    return items
  }, [activeModelMenuGroup, hasModelSearchQuery, modelView.kind, t])

  const renderEmptyOption = () => (
    <div className='sender-mobile-select-option is-disabled'>
      <span className='sender-mobile-select-option__title'>{t('common.noData')}</span>
    </div>
  )

  const renderModelOption = (
    option: ModelSelectOption,
    keyPrefix: string,
    showServicePrefix = false
  ) => (
    <div
      key={`${keyPrefix}:${option.value}`}
      role='option'
      tabIndex={0}
      aria-selected={selectedModel === option.value}
      className={[
        'sender-mobile-select-option',
        'model-mobile-select-option',
        selectedModel === option.value ? 'is-selected' : ''
      ].filter(Boolean).join(' ')}
      onClick={() => onSelectModel(option.value)}
      onKeyDown={(event) => handleSenderMobileSelectOptionKeyDown(event, () => onSelectModel(option.value))}
    >
      <ModelSelectOptionLabel
        option={option}
        showServicePrefix={showServicePrefix}
        onToggleRecommendedModel={onToggleRecommendedModel}
        updatingRecommendedModelValue={updatingRecommendedModelValue}
      />
      {selectedModel === option.value && (
        <span className='material-symbols-rounded sender-mobile-select-option__check'>
          check
        </span>
      )}
    </div>
  )

  const renderModelSection = (section: {
    key: string
    title: string
    description?: string
    options: ModelSelectOption[]
    showServicePrefix?: boolean
  }) => (
    <div className='sender-mobile-select-section' key={section.key}>
      <div className='sender-mobile-select-section__label'>
        <span>{section.title}</span>
        {section.description != null && section.description !== '' && (
          <span className='sender-mobile-select-section__description'>
            {section.description}
          </span>
        )}
      </div>
      {section.options.map(option => renderModelOption(option, section.key, section.showServicePrefix === true))}
    </div>
  )

  const renderModelNavigationOption = ({
    key,
    title,
    description,
    icon,
    onClick
  }: {
    key: string
    title: string
    description?: string
    icon: string
    onClick: () => void
  }) => (
    <div
      key={key}
      role='button'
      tabIndex={0}
      className='sender-mobile-select-option model-mobile-select-navigation-option'
      onClick={onClick}
      onKeyDown={(event) => handleSenderMobileSelectOptionKeyDown(event, onClick)}
    >
      <span className='material-symbols-rounded sender-mobile-select-option__icon'>
        {icon}
      </span>
      <span className='sender-mobile-select-option__copy'>
        <span className='sender-mobile-select-option__title'>{title}</span>
        {description != null && description !== '' && (
          <span className='sender-mobile-select-option__description'>{description}</span>
        )}
      </span>
      <span className='material-symbols-rounded sender-mobile-select-option__chevron'>
        chevron_right
      </span>
    </div>
  )

  const renderModelActionOption = ({
    key,
    title,
    icon,
    onClick
  }: {
    key: string
    title: string
    icon: string
    onClick: () => void
  }) => (
    <div
      key={key}
      role='button'
      tabIndex={0}
      className='sender-mobile-select-option model-mobile-select-navigation-option'
      onClick={onClick}
      onKeyDown={(event) => handleSenderMobileSelectOptionKeyDown(event, onClick)}
    >
      <span className='material-symbols-rounded sender-mobile-select-option__icon'>
        {icon}
      </span>
      <span className='sender-mobile-select-option__copy'>
        <span className='sender-mobile-select-option__title'>{title}</span>
      </span>
    </div>
  )

  const renderModelList = () => {
    if (hasModelSearchQuery) {
      return filteredModelSearchOptions.length > 0
        ? filteredModelSearchOptions.map(option => renderModelOption(option, 'search-results', true))
        : renderEmptyOption()
    }

    if (modelView.kind === 'more') {
      const actionOptions = [
        onConnectMoreModelServices == null
          ? null
          : renderModelActionOption({
            key: 'model-services-connect-more',
            title: t('chat.modelConnectMoreServices'),
            icon: 'add_circle',
            onClick: () => {
              onClose()
              onSearchChange('')
              onConnectMoreModelServices()
            }
          }),
        onOpenModelServicesConfig == null
          ? null
          : renderModelActionOption({
            key: 'model-services-open-config',
            title: t('chat.modelOpenModelServicesConfig'),
            icon: 'settings',
            onClick: () => {
              onClose()
              onSearchChange('')
              onOpenModelServicesConfig()
            }
          })
      ].filter((item): item is ReactElement => item != null)
      const groupOptions = availableModelMenuGroups.map(group =>
        renderModelNavigationOption({
          key: group.key,
          title: group.title,
          description: group.description,
          icon: 'folder',
          onClick: () => setModelView({ kind: 'group', groupKey: group.key })
        })
      )

      if (groupOptions.length === 0 && actionOptions.length === 0) {
        return renderEmptyOption()
      }

      return (
        <>
          {groupOptions}
          {actionOptions}
        </>
      )
    }

    if (modelView.kind === 'group') {
      return activeModelMenuGroup != null && activeModelMenuGroup.options.length > 0
        ? renderModelSection({
          key: activeModelMenuGroup.key,
          title: activeModelMenuGroup.title,
          description: activeModelMenuGroup.description,
          options: activeModelMenuGroup.options
        })
        : renderEmptyOption()
    }

    const hasModelServiceActions = onConnectMoreModelServices != null || onOpenModelServicesConfig != null
    const hasRootContent = rootModelSections.length > 0 || availableModelMenuGroups.length > 0 || hasModelServiceActions
    if (!hasRootContent) {
      return renderEmptyOption()
    }

    return (
      <>
        {rootModelSections.map(renderModelSection)}
        {(availableModelMenuGroups.length > 0 || hasModelServiceActions) && renderModelNavigationOption({
          key: 'more-models',
          title: t('chat.modelMoreModels'),
          icon: 'apps',
          onClick: () => setModelView({ kind: 'more' })
        })}
      </>
    )
  }

  return (
    <SenderMobileSelectDrawer
      open={open}
      title={t('chat.modelSelectPlaceholder')}
      className='model-mobile-select-drawer'
      onClose={onClose}
    >
      <div className='sender-mobile-select-search'>
        <input
          className='sender-mobile-select-search__input'
          value={modelSearchValue}
          placeholder={t('chat.modelSelectPlaceholder')}
          autoFocus
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <SenderMobileSelectBreadcrumbs items={breadcrumbs} />
      <div className='sender-mobile-select-list'>
        {renderModelList()}
      </div>
    </SenderMobileSelectDrawer>
  )
}
