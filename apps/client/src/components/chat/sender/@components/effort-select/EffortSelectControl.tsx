/* eslint-disable max-lines -- effort selector keeps desktop Select, shortcut wiring, and compact drawer together. */
import '../sender-toolbar/SenderSelectShared.scss'
import './EffortSelectControl.scss'

import { ShortcutTooltip } from '@oneworks/components/route-layout'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { StageSlider } from '#~/components/stage-slider/StageSlider'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import { effortIconMap } from '../../@utils/sender-constants'
import {
  SenderMobileSelectDrawer,
  handleSenderMobileSelectOptionKeyDown
} from '../mobile-select-drawer/SenderMobileSelectDrawer'

export function EffortSelectControl({
  state,
  data,
  refs,
  handlers
}: {
  state: Pick<
    SenderToolbarState,
    'isThinking' | 'modelUnavailable' | 'showModelSelect' | 'showEffortSelect' | 'effort' | 'isMac'
  >
  data: Pick<SenderToolbarData, 'effortOptions' | 'composerControlShortcuts'>
  refs: Pick<SenderToolbarRefs, 'effortSelectRef'>
  handlers: Pick<
    SenderToolbarHandlers,
    | 'onShowModelSelectChange'
    | 'onShowEffortSelectChange'
    | 'onOpenEffortSelector'
    | 'onQueueTextareaFocusRestore'
    | 'onCloseReferenceActions'
    | 'onEffortChange'
  >
}) {
  const { t } = useTranslation()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const { isThinking, modelUnavailable, showEffortSelect, effort, isMac } = state
  const { effortOptions, composerControlShortcuts } = data
  const { effortSelectRef } = refs
  const {
    onShowModelSelectChange,
    onShowEffortSelectChange,
    onOpenEffortSelector,
    onQueueTextareaFocusRestore,
    onCloseReferenceActions,
    onEffortChange
  } = handlers
  const isCompactControl = isCompactLayout || isTouchInteraction
  const isEffortSelectOpen = showEffortSelect
  const effortStages = useMemo(() => {
    return effortOptions
      .filter(option => option.value !== 'default')
      .map(option => ({
        value: option.value,
        label: t(`chat.effortLabels.${option.value}`)
      }))
  }, [effortOptions, t])
  const fallbackEffort = effortStages.find(option => option.value === 'medium')?.value ??
    effortStages[0]?.value ?? 'medium'
  const displayedEffort = effortStages.some(option => option.value === effort) ? effort : fallbackEffort
  const selectedEffortLabel = effortStages.find(option => option.value === displayedEffort)?.label ??
    t('chat.effortLabels.medium')

  const handleEffortSelection = (value: typeof effort) => {
    onEffortChange?.(value)
    onShowEffortSelectChange(false)
    onQueueTextareaFocusRestore()
  }

  const closeEffortSelect = () => {
    onShowEffortSelectChange(false)
    onQueueTextareaFocusRestore()
  }

  const openCompactEffortSelect = () => {
    if (modelUnavailable || isThinking || isEffortSelectOpen) {
      return
    }

    window.requestAnimationFrame(onOpenEffortSelector)
  }

  const openEffortSelect = () => {
    if (isCompactControl) {
      openCompactEffortSelect()
      return
    }

    onOpenEffortSelector()
  }

  const handleCompactEffortPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isCompactControl) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    openCompactEffortSelect()
  }

  const decoratedEffortOptions = useMemo(() => {
    return effortStages.map(option => ({
      ...option,
      label: (
        <span className={`effort-option effort-option--${option.value}`.trim()}>
          <span className='material-symbols-rounded effort-option__icon'>{effortIconMap[option.value]}</span>
          <span className='effort-option__text'>{option.label}</span>
        </span>
      )
    }))
  }, [effortStages])

  const handleStageSliderFocus = () => {
    onShowModelSelectChange(false)
    onCloseReferenceActions()
    onShowEffortSelectChange(true)
  }

  return (
    <ShortcutTooltip
      shortcut={composerControlShortcuts.switchEffort}
      isMac={isMac}
      title={t('chat.effortShortcutTooltip')}
      targetClassName='sender-control-tooltip-target'
      enabled={!isCompactControl && !isEffortSelectOpen}
    >
      <div
        className={[
          'sender-select-shell',
          'sender-select-shell--effort',
          isCompactControl ? 'sender-select-shell--compact' : ''
        ].filter(Boolean).join(' ')}
        onPointerDownCapture={handleCompactEffortPointerDown}
      >
        {isCompactControl
          ? (
            <button
              type='button'
              className='effort-select effort-select--responsive sender-responsive-select-button sender-responsive-select-button--effort'
              aria-label={t('chat.effortShortcutTooltip')}
              disabled={modelUnavailable || isThinking}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                openCompactEffortSelect()
              }}
              onFocus={openCompactEffortSelect}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                openCompactEffortSelect()
              }}
            >
              <span
                className={`effort-option effort-option--${displayedEffort} sender-responsive-select-button__value`
                  .trim()}
              >
                <span className='material-symbols-rounded effort-option__icon sender-responsive-select-button__icon'>
                  {effortIconMap[displayedEffort]}
                </span>
                <span className='effort-option__text sender-responsive-select-button__label'>
                  {selectedEffortLabel}
                </span>
              </span>
              <span className='material-symbols-rounded sender-responsive-select-button__chevron'>
                keyboard_arrow_down
              </span>
            </button>
          )
          : (
            <StageSlider
              inputRef={effortSelectRef}
              className='effort-stage-slider'
              ariaLabel={t('chat.effortSliderLabel', { value: selectedEffortLabel })}
              value={displayedEffort}
              options={effortStages}
              disabled={modelUnavailable || isThinking}
              animateLastStage
              onChange={nextEffort => onEffortChange?.(nextEffort)}
              onFocus={handleStageSliderFocus}
              onBlur={() => onShowEffortSelectChange(false)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') {
                  return
                }

                event.preventDefault()
                event.stopPropagation()
                onShowEffortSelectChange(false)
                event.currentTarget.blur()
                onQueueTextareaFocusRestore()
              }}
            />
          )}
        {isCompactControl && (
          <SenderMobileSelectDrawer
            open={isEffortSelectOpen}
            title={t('chat.effortSelectPlaceholder')}
            className='effort-mobile-select-drawer'
            onClose={closeEffortSelect}
          >
            <div className='sender-mobile-select-list' role='listbox'>
              {decoratedEffortOptions.map(option => (
                <div
                  key={option.value}
                  role='option'
                  tabIndex={0}
                  aria-selected={displayedEffort === option.value}
                  className={[
                    'sender-mobile-select-option',
                    'effort-mobile-select-option',
                    displayedEffort === option.value ? 'is-selected' : ''
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleEffortSelection(option.value)}
                  onKeyDown={(event) =>
                    handleSenderMobileSelectOptionKeyDown(event, () => handleEffortSelection(option.value))}
                >
                  <span className='sender-mobile-select-option__content'>{option.label}</span>
                  {displayedEffort === option.value && (
                    <span className='material-symbols-rounded sender-mobile-select-option__check'>check</span>
                  )}
                </div>
              ))}
            </div>
          </SenderMobileSelectDrawer>
        )}
      </div>
    </ShortcutTooltip>
  )
}
