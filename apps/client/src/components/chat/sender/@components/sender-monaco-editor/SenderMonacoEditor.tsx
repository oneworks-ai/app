import './SenderMonacoEditor.scss'

import Editor from '@monaco-editor/react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject
} from 'react'

import type { SessionInfo } from '@oneworks/types'

import type { SenderEditorHandle } from '#~/components/chat/sender/@types/sender-editor'
import type { SenderCompletionMatch, SenderTokenDecoration } from '#~/components/chat/sender/@utils/sender-completion'
import { isImeComposingKeyboardEvent, isShortcutMatch } from '#~/utils/shortcutUtils'
import { FONT_SIZE, LINE_HEIGHT, SENDER_UNICODE_HIGHLIGHT_OPTIONS } from './monaco-runtime'
import { useSenderMonacoEditor } from './use-sender-monaco-editor'

const AUTOMATION_INPUT_POLL_INTERVAL_MS = 150

const hasPastedImageFile = (clipboardData?: DataTransfer | null) => {
  return Array.from(clipboardData?.items ?? [])
    .some(item => item.kind === 'file' && item.type.startsWith('image/'))
}

export function SenderMonacoEditor({
  editorRef,
  sessionInfo,
  value,
  placeholder,
  disabled,
  sendShortcut,
  sendShortcutDisabled,
  onSendShortcut,
  secondarySendShortcut,
  onSecondarySendShortcut,
  minVisibleLineCount,
  onInputChange,
  onCursorChange,
  onKeyDown,
  onPaste,
  resolveCompletionMatch,
  resolveTokenDecorations
}: {
  editorRef: MutableRefObject<SenderEditorHandle | null>
  sessionInfo?: SessionInfo | null
  value: string
  placeholder: string
  disabled: boolean
  sendShortcut: string
  sendShortcutDisabled?: boolean
  onSendShortcut: () => void
  secondarySendShortcut?: string
  onSecondarySendShortcut?: () => void
  minVisibleLineCount?: number
  onInputChange: (value: string, cursorOffset: number | null) => void
  onCursorChange: (cursorOffset: number | null) => void
  onKeyDown: (event: KeyboardEvent) => void
  onPaste: (event: ClipboardEvent) => void | Promise<void>
  resolveCompletionMatch: (
    value: string,
    cursorOffset: number | null,
    sessionInfo?: SessionInfo | null
  ) => SenderCompletionMatch | null
  resolveTokenDecorations: (value: string) => SenderTokenDecoration[]
}) {
  const editorId = useId()
  const modelPath = `inmemory://oneworks-chat-sender/${editorId}.md`
  const automationInputRef = useRef<HTMLTextAreaElement | null>(null)
  const valueRef = useRef(value)
  const {
    themeName,
    editorHeight,
    handleEditorMount
  } = useSenderMonacoEditor({
    editorRef,
    modelPath,
    value,
    disabled,
    sendShortcut,
    sendShortcutDisabled,
    onSendShortcut,
    secondarySendShortcut,
    onSecondarySendShortcut,
    onInputChange,
    onCursorChange,
    onKeyDown,
    onPaste,
    sessionInfo,
    minVisibleLineCount,
    resolveCompletionMatch,
    resolveTokenDecorations
  })
  const [isEditorReady, setIsEditorReady] = useState(false)
  const shouldExposeAutomationInput = typeof window !== 'undefined' && window.oneworksDesktop != null

  valueRef.current = value

  const handleStartupEditorMount = useCallback((...args: Parameters<typeof handleEditorMount>) => {
    setIsEditorReady(true)
    handleEditorMount(...args)
  }, [handleEditorMount])

  const applyAutomationValue = useCallback((nextValue: string) => {
    if (disabled) {
      const automationInput = automationInputRef.current

      if (automationInput != null && automationInput.value !== valueRef.current) {
        automationInput.value = valueRef.current
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

  const syncAutomationInputValue = useCallback(() => {
    const automationInput = automationInputRef.current

    if (automationInput == null || automationInput.value === valueRef.current) {
      return
    }

    applyAutomationValue(automationInput.value)
  }, [applyAutomationValue])

  useEffect(() => {
    if (!shouldExposeAutomationInput) return

    const intervalId = window.setInterval(syncAutomationInputValue, AUTOMATION_INPUT_POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [shouldExposeAutomationInput, syncAutomationInputValue])

  const handleAutomationInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    applyAutomationValue(event.currentTarget.value)
  }, [applyAutomationValue])

  const handleAutomationInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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

  const handleAutomationInputPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (!hasPastedImageFile(event.clipboardData)) return

    void onPaste(event.nativeEvent)
  }, [onPaste])

  return (
    <div className='chat-input-monaco' data-oneworks-sender-editor-ready={isEditorReady ? 'true' : undefined}>
      {shouldExposeAutomationInput && (
        <textarea
          ref={automationInputRef}
          aria-label={placeholder}
          autoCapitalize='off'
          autoCorrect='off'
          className='chat-input-monaco__automation-input'
          data-oneworks-sender-automation-input='true'
          readOnly={disabled}
          spellCheck={false}
          tabIndex={-1}
          value={value}
          onChange={handleAutomationInputChange}
          onInput={handleAutomationInputChange}
          onKeyDown={handleAutomationInputKeyDown}
          onPaste={handleAutomationInputPaste}
        />
      )}
      <div className='chat-input-monaco__editor' style={{ height: `${editorHeight}px` }}>
        <Editor
          path={modelPath}
          language='markdown'
          theme={themeName}
          value={value}
          loading={null}
          onMount={handleStartupEditorMount}
          options={{
            ariaLabel: placeholder,
            automaticLayout: true,
            bracketPairColorization: { enabled: false },
            domReadOnly: disabled,
            // Monaco 0.55 defaults to EditContext on supported browsers, which renders
            // `.native-edit-context` instead of a standard textarea and breaks browser fill automation.
            editContext: false,
            folding: false,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: FONT_SIZE,
            glyphMargin: false,
            guides: {
              bracketPairs: false,
              highlightActiveBracketPair: false,
              indentation: false
            },
            hideCursorInOverviewRuler: true,
            lineDecorationsWidth: 0,
            lineHeight: LINE_HEIGHT,
            lineNumbers: 'off',
            lineNumbersMinChars: 0,
            matchBrackets: 'never',
            minimap: { enabled: false },
            occurrencesHighlight: 'off',
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            padding: { top: 0, bottom: 0 },
            placeholder,
            readOnly: disabled,
            renderFinalNewline: 'off',
            renderLineHighlight: 'none',
            roundedSelection: true,
            scrollBeyondLastLine: false,
            selectionHighlight: false,
            scrollbar: {
              alwaysConsumeMouseWheel: false,
              horizontal: 'hidden',
              useShadows: false,
              vertical: 'hidden'
            },
            suggest: {
              preview: true,
              selectionMode: 'whenQuickSuggestion'
            },
            suggestOnTriggerCharacters: true,
            unicodeHighlight: SENDER_UNICODE_HIGHLIGHT_OPTIONS,
            wordWrap: 'on',
            wordWrapColumn: 80,
            wrappingIndent: 'same'
          }}
        />
      </div>
    </div>
  )
}
