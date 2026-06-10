/* eslint-disable max-lines -- effort selector keeps desktop Select, shortcut wiring, and compact drawer together. */
import '../sender-toolbar/SenderSelectShared.scss'
import '../sender-toolbar/SenderSelectBase.scss'
import './EffortSelectControl.scss'
import './EffortSelectDropdown.scss'

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ShortcutTooltip } from '#~/components/ShortcutTooltip'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
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

const renderSelectArrow = (onMouseDown: (event: React.MouseEvent<HTMLSpanElement>) => void) => (
  <span className='material-symbols-rounded sender-select-arrow' onMouseDown={onMouseDown}>
    keyboard_arrow_down
  </span>
)

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
  const selectedEffortLabel = effort === 'default'
    ? t('chat.effortLabels.default')
    : t(`chat.effortLabels.${effort}`)

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
    return effortOptions.map(option => ({
      ...option,
      label: (
        <span className={`effort-option effort-option--${option.value}`.trim()}>
          <span className='material-symbols-rounded effort-option__icon'>{effortIconMap[option.value]}</span>
          <span className='effort-option__text'>
            {option.value === 'default' ? t('chat.effortLabels.default') : t(`chat.effortLabels.${option.value}`)}
          </span>
        </span>
      )
    }))
  }, [effortOptions, t])

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
        {!isCompactControl && !isEffortSelectOpen && !(modelUnavailable || isThinking) && (
          <button
            type='button'
            className='sender-select-body-trigger'
            aria-label={t('chat.effortShortcutTooltip')}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openEffortSelect()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openEffortSelect()
            }}
          />
        )}
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
                className={`effort-option effort-option--${effort} sender-responsive-select-button__value`.trim()}
              >
                <span className='material-symbols-rounded effort-option__icon sender-responsive-select-button__icon'>
                  {effortIconMap[effort]}
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
            <Select
              ref={effortSelectRef}
              className='effort-select'
              classNames={{ popup: { root: 'effort-select-popup' } }}
              open={isEffortSelectOpen}
              value={effort}
              options={decoratedEffortOptions}
              showSearch={false}
              allowClear={false}
              disabled={modelUnavailable || isThinking}
              onChange={handleEffortSelection}
              onOpenChange={(nextOpen) => {
                if (nextOpen) {
                  onShowModelSelectChange(false)
                  onCloseReferenceActions()
                } else {
                  onQueueTextareaFocusRestore()
                }
                onShowEffortSelectChange(nextOpen)
              }}
              onInputKeyDown={(event) => {
                if (event.key !== 'Escape' || !isEffortSelectOpen) {
                  return
                }

                event.preventDefault()
                event.stopPropagation()
                closeEffortSelect()
              }}
              placeholder={t('chat.effortSelectPlaceholder')}
              optionLabelProp='label'
              popupMatchSelectWidth={false}
              suffixIcon={renderSelectArrow((event) => {
                event.preventDefault()
                event.stopPropagation()
                if (isEffortSelectOpen) {
                  onShowEffortSelectChange(false)
                  onQueueTextareaFocusRestore()
                  return
                }
                openEffortSelect()
              })}
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
                  aria-selected={effort === option.value}
                  className={[
                    'sender-mobile-select-option',
                    'effort-mobile-select-option',
                    effort === option.value ? 'is-selected' : ''
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleEffortSelection(option.value)}
                  onKeyDown={(event) =>
                    handleSenderMobileSelectOptionKeyDown(event, () => handleEffortSelection(option.value))}
                >
                  <span className='sender-mobile-select-option__content'>{option.label}</span>
                  {effort === option.value && (
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
