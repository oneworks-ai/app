import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'

import type { ChatSessionTargetType } from '#~/hooks/chat/chat-session-target'

import { sessionTargetModeIcons } from './session-target-constants'

interface SenderSessionTargetTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  activeType: ChatSessionTargetType
  selectedText: string | null
}

export const SenderSessionTargetTrigger = forwardRef<HTMLButtonElement, SenderSessionTargetTriggerProps>(({
  activeType,
  selectedText,
  className,
  disabled,
  ...buttonProps
}, ref) => {
  const { t } = useTranslation()

  return (
    <button
      {...buttonProps}
      ref={ref}
      type='button'
      className={[
        'sender-session-target__trigger',
        className ?? ''
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      aria-label={buttonProps['aria-label'] ?? t('chat.sessionTarget.title')}
    >
      <span className='material-symbols-rounded sender-session-target__trigger-icon'>
        {sessionTargetModeIcons[activeType]}
      </span>
      <span className='sender-session-target__trigger-copy'>
        <span className='sender-session-target__trigger-mode'>
          {t(`chat.sessionTarget.modes.${activeType}`)}
        </span>
        {selectedText != null && (
          <span className='sender-session-target__trigger-value'>{selectedText}</span>
        )}
      </span>
      <span className='material-symbols-rounded sender-session-target__trigger-chevron'>expand_more</span>
    </button>
  )
})

SenderSessionTargetTrigger.displayName = 'SenderSessionTargetTrigger'
