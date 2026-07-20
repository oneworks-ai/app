/* eslint-disable max-lines -- model selector coordinates desktop Select, shortcuts, and the compact drawer. */
import '../sender-toolbar/SenderSelectShared.scss'
import '../sender-toolbar/SenderSelectBase.scss'
import './ModelSelectControl.scss'
import './ModelSelectMenu.scss'
import './ModelSelectMenuLabels.scss'

import { ShortcutTooltip } from '@oneworks/components/route-layout'
import type { IconRef } from '@oneworks/types'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { useModelSelectBrowser } from '#~/components/chat/sender/@hooks/use-model-select-browser'
import type { ModelSelectOption } from '#~/hooks/chat/use-chat-model-adapter-selection'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { renderIconRef } from '#~/utils/model-provider-icons'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import { ModelMobileSelectDrawer } from './ModelMobileSelectDrawer'

const renderSelectArrow = (onMouseDown?: (event: React.MouseEvent<HTMLSpanElement>) => void) => (
  <span className='material-symbols-rounded sender-select-arrow' onMouseDown={onMouseDown}>
    keyboard_arrow_down
  </span>
)

const defaultModelTriggerIcon: IconRef = { kind: 'material', name: 'model_training' }

const renderSelectedModelTriggerIcon = (option: ModelSelectOption | undefined) =>
  renderIconRef({
    icon: option?.modelIcon ?? option?.serviceIcon ?? defaultModelTriggerIcon,
    imageClassName: 'model-select-trigger-icon sender-responsive-select-button__icon',
    symbolClassName: 'model-select-trigger-icon-symbol sender-responsive-select-button__icon'
  })

const renderSelectedModelTriggerLabel = ({
  label,
  option
}: {
  label: React.ReactNode
  option: ModelSelectOption | undefined
}) => (
  <span className='model-select-trigger-label'>
    {renderSelectedModelTriggerIcon(option)}
    <span className='model-select-trigger-text'>{label}</span>
  </span>
)

export function ModelSelectControl({
  state,
  data,
  refs,
  handlers
}: {
  state: Pick<
    SenderToolbarState,
    | 'isThinking'
    | 'modelUnavailable'
    | 'showModelSelect'
    | 'selectedModel'
    | 'modelSearchValue'
    | 'isMac'
  >
  data: Pick<
    SenderToolbarData,
    | 'modelMenuGroups'
    | 'modelSearchOptions'
    | 'builtinPreviewModelOptions'
    | 'recommendedModelOptions'
    | 'servicePreviewModelOptions'
    | 'composerControlShortcuts'
    | 'updatingRecommendedModelValue'
  >
  refs: Pick<SenderToolbarRefs, 'modelSelectRef'>
  handlers: Pick<
    SenderToolbarHandlers,
    | 'onShowModelSelectChange'
    | 'onModelSearchValueChange'
    | 'onOpenModelSelector'
    | 'onQueueTextareaFocusRestore'
    | 'onModelChange'
    | 'onToggleRecommendedModel'
    | 'onConnectMoreModelServices'
    | 'onOpenModelServicesConfig'
  >
}) {
  const { t } = useTranslation()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const { isThinking, modelUnavailable, showModelSelect, selectedModel, modelSearchValue, isMac } = state
  const {
    modelMenuGroups,
    modelSearchOptions,
    builtinPreviewModelOptions,
    recommendedModelOptions,
    servicePreviewModelOptions,
    composerControlShortcuts,
    updatingRecommendedModelValue
  } = data
  const { modelSelectRef } = refs
  const {
    onShowModelSelectChange,
    onModelSearchValueChange,
    onOpenModelSelector,
    onQueueTextareaFocusRestore,
    onModelChange,
    onToggleRecommendedModel,
    onConnectMoreModelServices,
    onOpenModelServicesConfig
  } = handlers
  const isCompactControl = isCompactLayout || isTouchInteraction
  const isModelSelectOpen = showModelSelect
  const defaultModelLabel = t('chat.defaultModelLabel')
  const selectedModelOption = modelSearchOptions?.find(option => option.value === selectedModel)
  const displayedModelOption = selectedModel === 'default'
    ? builtinPreviewModelOptions?.find(option => option.value !== 'default') ??
      modelSearchOptions?.find(option => option.serviceKey == null && option.value !== 'default') ??
      selectedModelOption
    : selectedModelOption
  const selectedModelLabel = modelUnavailable
    ? t('chat.modelUnavailable')
    : displayedModelOption?.displayLabel ??
      selectedModel ??
      defaultModelLabel

  const handleModelSelection = (value: string) => {
    onModelChange?.(value)
    onShowModelSelectChange(false)
    onModelSearchValueChange('')
    onQueueTextareaFocusRestore()
  }

  const closeModelSelect = () => {
    onShowModelSelectChange(false)
    onModelSearchValueChange('')
    onQueueTextareaFocusRestore()
  }

  const openCompactModelSelect = () => {
    if (modelUnavailable || isThinking || isModelSelectOpen) {
      return
    }

    window.requestAnimationFrame(onOpenModelSelector)
  }

  const openModelSelect = () => {
    if (isCompactControl) {
      openCompactModelSelect()
      return
    }

    onOpenModelSelector()
  }

  const handleCompactModelPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isCompactControl) {
      return
    }

    if (
      event.target instanceof Element &&
      event.target.closest('.sender-mobile-select-drawer-root') != null
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    openCompactModelSelect()
  }

  const { renderModelPopup } = useModelSelectBrowser({
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
    onCloseModelSelect: closeModelSelect,
    onSelectModel: handleModelSelection,
    onConnectMoreModelServices,
    onOpenModelServicesConfig
  })

  return (
    <ShortcutTooltip
      shortcut={composerControlShortcuts.switchModel}
      isMac={isMac}
      title={t('chat.modelShortcutTooltip')}
      targetClassName='sender-control-tooltip-target'
      enabled={!isCompactControl && !isModelSelectOpen}
    >
      {isCompactControl
        ? (
          <div
            className={[
              'sender-select-shell',
              'sender-select-shell--model',
              'sender-select-shell--compact',
              isModelSelectOpen ? 'is-open' : '',
              modelUnavailable || isThinking ? 'is-disabled' : ''
            ].filter(Boolean).join(' ')}
            onPointerDownCapture={handleCompactModelPointerDown}
          >
            <button
              type='button'
              className='model-select model-select--responsive sender-responsive-select-button sender-responsive-select-button--model'
              aria-label={t('chat.modelShortcutTooltip')}
              disabled={modelUnavailable || isThinking}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                openCompactModelSelect()
              }}
              onFocus={openCompactModelSelect}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                openCompactModelSelect()
              }}
            >
              {renderSelectedModelTriggerIcon(displayedModelOption)}
              <span className='sender-responsive-select-button__label'>{selectedModelLabel}</span>
              <span className='material-symbols-rounded sender-responsive-select-button__chevron'>
                keyboard_arrow_down
              </span>
            </button>
            <ModelMobileSelectDrawer
              open={isModelSelectOpen}
              builtinPreviewModelOptions={builtinPreviewModelOptions}
              selectedModel={selectedModel}
              modelSearchValue={modelSearchValue}
              modelSearchOptions={modelSearchOptions}
              modelMenuGroups={modelMenuGroups}
              recommendedModelOptions={recommendedModelOptions}
              servicePreviewModelOptions={servicePreviewModelOptions}
              updatingRecommendedModelValue={updatingRecommendedModelValue}
              onClose={closeModelSelect}
              onSearchChange={onModelSearchValueChange}
              onSelectModel={handleModelSelection}
              onToggleRecommendedModel={onToggleRecommendedModel}
              onConnectMoreModelServices={onConnectMoreModelServices}
              onOpenModelServicesConfig={onOpenModelServicesConfig}
            />
          </div>
        )
        : (
          <Select
            ref={modelSelectRef}
            className='model-select'
            classNames={{ popup: { root: 'model-select-popup' } }}
            controlTrigger={{
              ariaLabel: t('chat.modelShortcutTooltip'),
              className: 'sender-select-content-trigger',
              content: (
                <>
                  {renderSelectedModelTriggerLabel({
                    label: selectedModelLabel,
                    option: displayedModelOption
                  })}
                  {renderSelectArrow()}
                </>
              ),
              stopPropagation: true,
              wrapperClassName: 'sender-select-shell sender-select-shell--model'
            }}
            dropdownAlign={{ overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } }}
            placement='topLeft'
            open={isModelSelectOpen}
            value={selectedModel}
            options={modelSearchOptions ?? []}
            showSearch={false}
            allowClear={false}
            disabled={modelUnavailable || isThinking}
            onChange={handleModelSelection}
            onOpenChange={(nextOpen) => {
              if (nextOpen) {
                openModelSelect()
                return
              }
              onQueueTextareaFocusRestore()
              onShowModelSelectChange(false)
            }}
            placeholder={modelUnavailable ? t('chat.modelUnavailable') : defaultModelLabel}
            optionLabelProp='displayLabel'
            labelRender={() =>
              renderSelectedModelTriggerLabel({
                label: selectedModelLabel,
                option: displayedModelOption
              })}
            popupRender={renderModelPopup}
            popupMatchSelectWidth={false}
            suffixIcon={renderSelectArrow((event) => {
              event.preventDefault()
              event.stopPropagation()
              if (isModelSelectOpen) {
                onShowModelSelectChange(false)
                onQueueTextareaFocusRestore()
                return
              }
              openModelSelect()
            })}
          />
        )}
    </ShortcutTooltip>
  )
}
