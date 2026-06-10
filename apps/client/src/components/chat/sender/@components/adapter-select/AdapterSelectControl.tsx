import '../sender-toolbar/SenderSelectShared.scss'
import './AdapterSelectControl.scss'
import './AdapterSelectDropdown.scss'

import { Tooltip } from 'antd'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

import type { SenderToolbarData, SenderToolbarHandlers, SenderToolbarState } from '../../@types/sender-toolbar-types'
import {
  SenderMobileSelectDrawer,
  handleSenderMobileSelectOptionKeyDown
} from '../mobile-select-drawer/SenderMobileSelectDrawer'
import { AdapterSelectPopupExtras } from './AdapterSelectPopupExtras'

export function AdapterSelectControl({
  state,
  data,
  handlers
}: {
  state: Pick<SenderToolbarState, 'adapterLocked' | 'modelUnavailable' | 'isThinking' | 'selectedAdapter'>
  data: Pick<SenderToolbarData, 'adapterOptions' | 'hiddenBuiltinAdapterOptions'> & {
    defaultOpen?: boolean
  }
  handlers: Pick<SenderToolbarHandlers, 'onAdapterChange'>
}) {
  const { t } = useTranslation()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const { adapterLocked, modelUnavailable, isThinking, selectedAdapter } = state
  const { adapterOptions, defaultOpen, hiddenBuiltinAdapterOptions } = data
  const { onAdapterChange } = handlers
  const isDisabled = adapterLocked || modelUnavailable || isThinking
  const isCompactControl = isCompactLayout || isTouchInteraction
  const [showAdapterSelect, setShowAdapterSelect] = useState(defaultOpen === true)
  const visibleAdapterOptions = adapterOptions ?? []
  const hiddenAdapterOptions = hiddenBuiltinAdapterOptions ?? []
  const selectedOption = visibleAdapterOptions.find(option => option.value === selectedAdapter)
  const hasHiddenAdapterOptions = hiddenAdapterOptions.length > 0

  const handleAdapterSelection = (value: string) => {
    onAdapterChange?.(value)
    setShowAdapterSelect(false)
  }

  const openCompactAdapterSelect = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isCompactControl || isDisabled || showAdapterSelect) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setShowAdapterSelect(true)
  }

  const renderAdapterPopup = (menu: ReactNode) => (
    <div className='adapter-select-menu'>
      {menu}
      <AdapterSelectPopupExtras hiddenOptions={hiddenAdapterOptions} />
    </div>
  )

  if (visibleAdapterOptions.length <= 1 && !hasHiddenAdapterOptions) {
    return null
  }

  return (
    <Tooltip title={adapterLocked ? t('chat.adapterLockedTooltip') : undefined} placement='top'>
      <span
        className={`adapter-select-tooltip-target ${adapterLocked ? 'adapter-select-tooltip-target--locked' : ''}`
          .trim()}
      >
        <div
          className={[
            'sender-select-shell',
            'sender-select-shell--adapter',
            isCompactControl ? 'sender-select-shell--compact' : '',
            isDisabled ? 'is-disabled' : ''
          ].filter(Boolean).join(' ')}
          onPointerDownCapture={openCompactAdapterSelect}
        >
          {!isCompactControl && !showAdapterSelect && !isDisabled && (
            <button
              type='button'
              className='sender-select-body-trigger'
              aria-label={t('chat.adapterSelectPlaceholder', { defaultValue: 'Adapter' })}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setShowAdapterSelect(true)
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setShowAdapterSelect(true)
              }}
            />
          )}
          {isCompactControl
            ? (
              <button
                type='button'
                className={[
                  'adapter-select',
                  'adapter-select--responsive',
                  adapterLocked ? 'adapter-select--locked' : '',
                  'sender-responsive-select-button',
                  'sender-responsive-select-button--adapter'
                ].filter(Boolean).join(' ')}
                aria-label={t('chat.adapterSelectPlaceholder', { defaultValue: 'Adapter' })}
                disabled={isDisabled}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setShowAdapterSelect(true)
                }}
                onFocus={() => setShowAdapterSelect(true)}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setShowAdapterSelect(true)
                }}
              >
                <span className='sender-responsive-select-button__value adapter-select__responsive-value'>
                  {selectedOption?.label ?? (
                    <span className='material-symbols-rounded adapter-option__icon adapter-option__icon--fallback'>
                      deployed_code
                    </span>
                  )}
                </span>
                <span className='material-symbols-rounded sender-responsive-select-button__chevron'>
                  keyboard_arrow_down
                </span>
              </button>
            )
            : (
              <Select
                className={`adapter-select ${adapterLocked ? 'adapter-select--locked' : ''}`.trim()}
                classNames={{ popup: { root: 'adapter-select-popup' } }}
                open={showAdapterSelect}
                value={selectedAdapter}
                options={visibleAdapterOptions}
                showSearch={false}
                allowClear={false}
                disabled={isDisabled}
                onChange={handleAdapterSelection}
                onOpenChange={setShowAdapterSelect}
                placeholder={t('chat.adapterSelectPlaceholder', { defaultValue: 'Adapter' })}
                optionLabelProp='displayLabel'
                popupRender={renderAdapterPopup}
                popupMatchSelectWidth={false}
                suffixIcon={null}
              />
            )}
          {isCompactControl && (
            <SenderMobileSelectDrawer
              open={showAdapterSelect}
              title={t('chat.adapterSelectPlaceholder', { defaultValue: 'Adapter' })}
              className='adapter-mobile-select-drawer'
              onClose={() => setShowAdapterSelect(false)}
            >
              <AdapterSelectPopupExtras hiddenOptions={[]} showHiddenOptions={false} useOverlayStyles={false} />
              <div className='sender-mobile-select-list' role='listbox'>
                {visibleAdapterOptions.map(option => (
                  <div
                    key={option.value}
                    role='option'
                    tabIndex={0}
                    aria-selected={selectedAdapter === option.value}
                    className={[
                      'sender-mobile-select-option',
                      'adapter-mobile-select-option',
                      selectedAdapter === option.value ? 'is-selected' : ''
                    ].filter(Boolean).join(' ')}
                    onClick={() => handleAdapterSelection(option.value)}
                    onKeyDown={(event) =>
                      handleSenderMobileSelectOptionKeyDown(event, () => handleAdapterSelection(option.value))}
                  >
                    <span className='sender-mobile-select-option__content'>{option.label}</span>
                    {selectedAdapter === option.value && (
                      <span className='material-symbols-rounded sender-mobile-select-option__check'>check</span>
                    )}
                  </div>
                ))}
              </div>
              <AdapterSelectPopupExtras
                hiddenOptions={hiddenAdapterOptions}
                showHint={false}
                useOverlayStyles={false}
              />
            </SenderMobileSelectDrawer>
          )}
        </div>
      </span>
    </Tooltip>
  )
}
