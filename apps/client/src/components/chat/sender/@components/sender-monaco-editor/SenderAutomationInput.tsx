import { useCallback, useEffect, useRef } from 'react'
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject
} from 'react'

import type { SenderEditorHandle } from '#~/components/chat/sender/@types/sender-editor'
import { isImeComposingKeyboardEvent, isShortcutMatch } from '#~/utils/shortcutUtils'

const AUTOMATION_INPUT_POLL_INTERVAL_MS = 150

const hasPastedImageFile = (clipboardData?: DataTransfer | null) => {
  return Array.from(clipboardData?.items ?? [])
    .some(item => item.kind === 'file' && item.type.startsWith('image/'))
}

export function SenderAutomationInput({
  editorRef,
  value,
  placeholder,
  disabled,
  sendShortcut,
  sendShortcutDisabled,
  onSendShortcut,
  secondarySendShortcut,
  onSecondarySendShortcut,
  onInputChange,
  onCursorChange,
  onKeyDown,
  onPaste
}: {
  editorRef: MutableRefObject<SenderEditorHandle | null>
  value: string
  placeholder: string
  disabled: boolean
  sendShortcut: string
  sendShortcutDisabled?: boolean
  onSendShortcut: () => void
  secondarySendShortcut?: string
  onSecondarySendShortcut?: () => void
  onInputChange: (value: string, cursorOffset: number | null) => void
  onCursorChange: (cursorOffset: number | null) => void
  onKeyDown: (event: KeyboardEvent) => void
  onPaste: (event: ClipboardEvent) => void | Promise<void>
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const valueRef = useRef(value)
  const shouldExpose = typeof window !== 'undefined' && window.oneworksDesktop != null

  valueRef.current = value

  const applyValue = useCallback((nextValue: string) => {
    if (disabled) {
      const input = inputRef.current

      if (input != null && input.value !== valueRef.current) {
        input.value = valueRef.current
      }
      return
    }

    const cursorOffset = nextValue.length
    const editor = editorRef.current

    valueRef.current = nextValue

    if (editor != null && !editor.isDisabled()) {
      const previousValue = editor.getValue()
      editor.setValue(nextValue, { start: cursorOffset, end: cursorOffset })

      if (previousValue === nextValue) {
        onInputChange(nextValue, cursorOffset)
        onCursorChange(cursorOffset)
      }
      return
    }

    onInputChange(nextValue, cursorOffset)
    onCursorChange(cursorOffset)
  }, [disabled, editorRef, onCursorChange, onInputChange])

  const syncValue = useCallback(() => {
    const input = inputRef.current

    if (input == null || input.value === valueRef.current) {
      return
    }

    applyValue(input.value)
  }, [applyValue])

  useEffect(() => {
    if (!shouldExpose) return

    const intervalId = window.setInterval(syncValue, AUTOMATION_INPUT_POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [shouldExpose, syncValue])

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    applyValue(event.currentTarget.value)
  }, [applyValue])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled || isImeComposingKeyboardEvent(event)) return

    const isMac = navigator.platform.includes('Mac')

    if (
      secondarySendShortcut != null &&
      onSecondarySendShortcut != null &&
      isShortcutMatch(event, secondarySendShortcut, isMac)
    ) {
      event.preventDefault()
      event.stopPropagation()
      onSecondarySendShortcut()
      return
    }

    if (!sendShortcutDisabled && isShortcutMatch(event, sendShortcut, isMac)) {
      event.preventDefault()
      event.stopPropagation()
      onSendShortcut()
      return
    }

    onKeyDown(event.nativeEvent)
  }, [
    disabled,
    onKeyDown,
    onSecondarySendShortcut,
    onSendShortcut,
    secondarySendShortcut,
    sendShortcut,
    sendShortcutDisabled
  ])

  const handlePaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (!hasPastedImageFile(event.clipboardData)) return

    void onPaste(event.nativeEvent)
  }, [onPaste])

  if (!shouldExpose) return null

  return (
    <textarea
      ref={inputRef}
      aria-label={placeholder}
      autoCapitalize='off'
      autoCorrect='off'
      className='chat-input-monaco__automation-input'
      data-oneworks-sender-automation-input='true'
      readOnly={disabled}
      spellCheck={false}
      tabIndex={-1}
      value={value}
      onChange={handleChange}
      onInput={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  )
}
