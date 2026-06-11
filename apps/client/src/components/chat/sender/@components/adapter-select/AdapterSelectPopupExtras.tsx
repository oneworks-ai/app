import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { OverlayAction, OverlayDivider } from '#~/components/overlay'
import type { HiddenBuiltinAdapterOption } from '#~/hooks/chat/use-chat-model-adapter-selection'

export function AdapterSelectPopupExtras({
  hiddenOptions,
  showHiddenOptions = true,
  showHint = true,
  useOverlayStyles = true
}: {
  hiddenOptions: HiddenBuiltinAdapterOption[]
  showHiddenOptions?: boolean
  showHint?: boolean
  useOverlayStyles?: boolean
}) {
  const { t } = useTranslation()
  const [showHiddenBuiltinAdapters, setShowHiddenBuiltinAdapters] = useState(false)
  const canShowHiddenOptions = showHiddenOptions && hiddenOptions.length > 0
  const renderOverlayDivider = () => (
    useOverlayStyles
      ? <OverlayDivider className='adapter-select-menu__divider' decorative />
      : null
  )

  return (
    <>
      {showHint && (
        <>
          {renderOverlayDivider()}
          <div className='adapter-select-menu__hint'>
            <span className='material-symbols-rounded' aria-hidden='true'>info</span>
            <span>{t('chat.adapterFirstRunHint')}</span>
          </div>
        </>
      )}
      {canShowHiddenOptions && (
        <>
          {renderOverlayDivider()}
          <div className='adapter-hidden-options'>
            <button
              type='button'
              className='adapter-hidden-options__title'
              aria-expanded={showHiddenBuiltinAdapters}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setShowHiddenBuiltinAdapters(open => !open)
              }}
            >
              <span className='adapter-hidden-options__title-main'>
                <span className='material-symbols-rounded adapter-hidden-options__title-icon' aria-hidden='true'>
                  visibility_off
                </span>
                <span>{t('chat.adapterHiddenBuiltinTitle')}</span>
              </span>
              <span className='material-symbols-rounded adapter-hidden-options__title-icon' aria-hidden='true'>
                {showHiddenBuiltinAdapters ? 'expand_more' : 'chevron_right'}
              </span>
            </button>
            {showHiddenBuiltinAdapters && (
              <div className='adapter-hidden-options__list'>
                {hiddenOptions.map(option => (
                  <div key={option.value} className='adapter-hidden-options__item'>
                    <OverlayAction
                      className='adapter-hidden-option'
                      onMouseDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        option.onRestore()
                      }}
                    >
                      <span className='adapter-hidden-option__main'>
                        {option.iconUrl == null
                          ? (
                            <span
                              className='adapter-hidden-option__icon adapter-hidden-option__icon--fallback material-symbols-rounded'
                              aria-hidden='true'
                            >
                              {option.fallbackIcon}
                            </span>
                          )
                          : (
                            <img
                              className='adapter-hidden-option__icon'
                              src={option.iconUrl}
                              alt=''
                              aria-hidden='true'
                            />
                          )}
                        <span className='adapter-hidden-option__title'>{option.title}</span>
                      </span>
                      <span
                        className='material-symbols-rounded adapter-hidden-option__restore'
                        aria-label={t('chat.adapterRestoreBuiltin', { adapter: option.title })}
                      >
                        visibility
                      </span>
                    </OverlayAction>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
