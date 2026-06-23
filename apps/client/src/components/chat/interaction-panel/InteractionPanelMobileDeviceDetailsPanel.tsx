import { Button, Input } from 'antd'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function InteractionPanelMobileDeviceTargetsPanel({
  details
}: {
  details: ReactNode
}) {
  return (
    <div className='chat-interaction-panel-mobile-debug__targets-tab'>
      {details}
    </div>
  )
}

export function InteractionPanelMobileDeviceInputPanel({
  error,
  onSendInput
}: {
  error: string | null
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
}) {
  const { t } = useTranslation()
  const [textInput, setTextInput] = useState('')

  const sendText = useCallback(() => {
    const trimmedText = textInput.trim()
    if (trimmedText === '') return
    onSendInput({ kind: 'text', text: trimmedText })
    setTextInput('')
  }, [onSendInput, textInput])

  return (
    <div className='chat-interaction-panel-mobile-debug__input-tab'>
      {error != null && <div className='chat-interaction-panel-mobile-debug__preview-error'>{error}</div>}
      <div className='chat-interaction-panel-mobile-debug__text-input'>
        <Input
          size='small'
          value={textInput}
          placeholder={t('chat.interactionPanel.mobileDebugTextPlaceholder')}
          prefix={<span className='material-symbols-rounded' aria-hidden='true'>text_fields</span>}
          onChange={event => setTextInput(event.target.value)}
          onPressEnter={sendText}
        />
        <Button
          type='text'
          size='small'
          title={t('chat.interactionPanel.mobileDebugSendText')}
          aria-label={t('chat.interactionPanel.mobileDebugSendText')}
          onClick={sendText}
        >
          <span className='material-symbols-rounded' aria-hidden='true'>keyboard_return</span>
        </Button>
      </div>
    </div>
  )
}
