/* eslint-disable max-lines -- desktop model selector popup coordinates search, menu groups, and recommendation toggles. */
import { Tooltip } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { OverlayMenu, OverlayPanel, OverlaySearchRow } from '#~/components/overlay'
import type { OverlayMenuActionItem, OverlayMenuItem } from '#~/components/overlay'
import type { ModelSelectMenuGroup, ModelSelectOption } from '#~/hooks/chat/use-chat-model-adapter-selection'

import { ModelSelectOptionLabel } from '../@components/model-select/ModelSelectOptionLabel'

const EMPTY_MODEL_OPEN_KEYS: string[] = []

export const useModelSelectBrowser = ({
  builtinPreviewModelOptions,
  modelSearchOptions,
  modelSearchValue,
  modelMenuGroups,
  onModelSearchValueChange,
  onToggleRecommendedModel,
  recommendedModelOptions,
  servicePreviewModelOptions,
  selectedModel,
  updatingRecommendedModelValue,
  onCloseModelSelect,
  onSelectModel
}: {
  builtinPreviewModelOptions?: ModelSelectOption[]
  modelSearchOptions?: ModelSelectOption[]
  modelSearchValue: string
  modelMenuGroups?: ModelSelectMenuGroup[]
  onModelSearchValueChange: (value: string) => void
  onToggleRecommendedModel?: (option: ModelSelectOption) => void | Promise<void>
  recommendedModelOptions?: ModelSelectOption[]
  servicePreviewModelOptions?: ModelSelectOption[]
  selectedModel?: string
  updatingRecommendedModelValue?: string
  onCloseModelSelect: () => void
  onSelectModel: (value: string) => void
}) => {
  const { t } = useTranslation()
  const hasModelSearchQuery = modelSearchValue.trim() !== ''

  const renderCompactModelMenuLabel = useCallback((option: ModelSelectOption, showServicePrefix = false) => (
    <ModelSelectOptionLabel
      option={option}
      showServicePrefix={showServicePrefix}
      onToggleRecommendedModel={onToggleRecommendedModel}
      updatingRecommendedModelValue={updatingRecommendedModelValue}
    />
  ), [onToggleRecommendedModel, updatingRecommendedModelValue])

  const renderModelMenuGroupLabel = useCallback((group: ModelSelectMenuGroup) => {
    const label = (
      <span className='model-menu-group-label'>
        <span className='model-menu-group-title'>{group.title}</span>
      </span>
    )

    if (!group.description) {
      return label
    }

    return (
      <Tooltip
        title={group.description}
        placement='left'
        classNames={{ root: 'model-menu-tooltip' }}
        mouseEnterDelay={.35}
        destroyOnHidden
      >
        {label}
      </Tooltip>
    )
  }, [])

  const modelMenuItems = useMemo<OverlayMenuItem[]>(() => {
    const servicePreviewItems = (servicePreviewModelOptions ?? []).map(option => ({
      key: `service-preview:${option.value}`,
      label: renderCompactModelMenuLabel(option, true),
      className: 'model-select-menu-item'
    }))

    const builtinPreviewItems = (builtinPreviewModelOptions ?? []).map(option => ({
      key: `builtin-preview:${option.value}`,
      label: renderCompactModelMenuLabel(option),
      className: 'model-select-menu-item'
    }))

    const recommendedItems = (recommendedModelOptions ?? []).map(option => ({
      key: `recommended:${option.value}`,
      label: renderCompactModelMenuLabel(option),
      className: 'model-select-menu-item'
    }))

    const moreModelChildren = (modelMenuGroups ?? [])
      .filter(group => group.options.length > 0)
      .map(group => ({
        key: group.key,
        label: renderModelMenuGroupLabel(group),
        children: group.options.map(option => ({
          key: option.value,
          label: (
            <ModelSelectOptionLabel
              option={option}
              onToggleRecommendedModel={onToggleRecommendedModel}
              updatingRecommendedModelValue={updatingRecommendedModelValue}
            />
          ),
          className: 'model-select-menu-item'
        }))
      }))

    if (moreModelChildren.length === 0) {
      if (recommendedItems.length === 0) {
        return [...servicePreviewItems, ...builtinPreviewItems]
      }

      return [
        ...servicePreviewItems,
        ...builtinPreviewItems,
        {
          type: 'section',
          key: 'recommended-group',
          label: <span className='model-select-section-label'>{t('chat.modelGroupRecommended')}</span>
        },
        ...recommendedItems
      ]
    }

    return [
      ...servicePreviewItems,
      ...builtinPreviewItems,
      ...(recommendedItems.length > 0
        ? [{
          type: 'section' as const,
          key: 'recommended-group',
          label: <span className='model-select-section-label'>{t('chat.modelGroupRecommended')}</span>
        }, ...recommendedItems]
        : []),
      {
        key: 'more-models',
        label: <span className='model-more-menu-label'>{t('chat.modelMoreModels')}</span>,
        children: moreModelChildren
      }
    ]
  }, [
    builtinPreviewModelOptions,
    modelMenuGroups,
    onToggleRecommendedModel,
    recommendedModelOptions,
    renderCompactModelMenuLabel,
    renderModelMenuGroupLabel,
    servicePreviewModelOptions,
    t,
    updatingRecommendedModelValue
  ])

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

  const searchModelMenuItems = useMemo<OverlayMenuItem[]>(() => {
    return filteredModelSearchOptions.map(option => ({
      key: `search-results:${option.value}`,
      label: renderCompactModelMenuLabel(option, true),
      className: 'model-select-menu-item'
    }))
  }, [filteredModelSearchOptions, renderCompactModelMenuLabel])

  const handleModelMenuClick = useCallback((item: OverlayMenuActionItem) => {
    const { key } = item
    if (key === 'more-models' || item.children != null) return
    onSelectModel(key.replace(/^(service-preview:|builtin-preview:|recommended:|search-results:)/, ''))
  }, [onSelectModel])

  const selectedModelMenuKeys = useMemo(() => {
    if (!selectedModel) return []

    return [
      selectedModel,
      `service-preview:${selectedModel}`,
      `builtin-preview:${selectedModel}`,
      `recommended:${selectedModel}`,
      `search-results:${selectedModel}`
    ]
  }, [selectedModel])

  const renderModelPopup = useCallback((_menu: React.ReactElement) => {
    const activeMenuItems = hasModelSearchQuery ? searchModelMenuItems : modelMenuItems
    const hasMenuItems = activeMenuItems != null && activeMenuItems.length > 0
    const searchRow = (
      <OverlaySearchRow
        autoFocus
        className='model-select-browser__search-row'
        clearLabel={t('common.clear')}
        placeholder={t('chat.modelSearchPlaceholder')}
        value={modelSearchValue}
        onChange={onModelSearchValueChange}
        onClear={() => onModelSearchValueChange('')}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') {
            return
          }

          event.preventDefault()
          event.stopPropagation()
          if (modelSearchValue.trim() !== '') {
            onModelSearchValueChange('')
            return
          }

          onCloseModelSelect()
        }}
      />
    )

    return (
      <div
        className='model-select-browser'
        onMouseDown={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('.model-select-browser__search-row') != null
          ) {
            event.stopPropagation()
            return
          }

          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {hasMenuItems
          ? (
            <OverlayMenu
              className='model-select-menu-composite'
              defaultOpenKeys={EMPTY_MODEL_OPEN_KEYS}
              menuClassName='model-select-menu'
              panelClassName='model-select-submenu-popup model-select-submenu-panel'
              primaryHeader={searchRow}
              surface
              selectedKeys={selectedModelMenuKeys}
              submenuTrigger='click'
              items={activeMenuItems}
              onItemClick={handleModelMenuClick}
            />
          )
          : (
            <OverlayPanel className='model-select-submenu-popup model-select-submenu-panel model-select-empty-panel'>
              <div className='oneworks-overlay-menu-header'>{searchRow}</div>
              <div className='model-select-browser__empty'>
                {t('common.noData')}
              </div>
            </OverlayPanel>
          )}
      </div>
    )
  }, [
    hasModelSearchQuery,
    handleModelMenuClick,
    modelMenuItems,
    modelSearchValue,
    onCloseModelSelect,
    onModelSearchValueChange,
    searchModelMenuItems,
    selectedModelMenuKeys,
    t
  ])

  return { renderModelPopup }
}
