/* eslint-disable max-lines */
import type { SenderEditorHandle } from '#~/components/chat/sender/@types/sender-editor'
import type { SenderCompletionMatch, SenderTokenDecoration } from '#~/components/chat/sender/@utils/sender-completion'
import { emitDesktopViewShortcut, getDesktopViewShortcutActionFromEvent } from '#~/desktop/view-shortcuts'
import { isImeComposingKeyboardEvent, isShortcutMatch } from '#~/utils/shortcutUtils'
import type { SessionInfo } from '@oneworks/types'
import type { IDisposable, editor as MonacoEditorNamespace } from 'monaco-editor'
import type { MutableRefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  clampEditorHeight,
  getMinEditorHeight,
  getSelectionOffsets,
  registerSenderCompletionProvider,
  toMonacoRange
} from './monaco-runtime'
import { useSenderEditorHandle } from './use-sender-editor-handle'
import { useSenderMonacoTheme } from './use-sender-monaco-theme'

const hasPastedImageFile = (clipboardData?: DataTransfer | null) => {
  return Array.from(clipboardData?.items ?? [])
    .some(item => item.kind === 'file' && item.type.startsWith('image/'))
}

export const useSenderMonacoEditor = ({
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
  minVisibleLineCount = 1,
  resolveCompletionMatch,
  resolveTokenDecorations
}: {
  editorRef: MutableRefObject<SenderEditorHandle | null>
  modelPath: string
  value: string
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
  sessionInfo?: SessionInfo | null
  minVisibleLineCount?: number
  resolveCompletionMatch: (
    value: string,
    cursorOffset: number | null,
    sessionInfo?: SessionInfo | null
  ) => SenderCompletionMatch | null
  resolveTokenDecorations: (value: string) => SenderTokenDecoration[]
}) => {
  const themeName = useSenderMonacoTheme()
  const minEditorHeight = getMinEditorHeight(minVisibleLineCount)
  const [editorHeight, setEditorHeight] = useState(minEditorHeight)
  const standaloneEditorRef = useRef<MonacoEditorNamespace.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<MonacoEditorNamespace.IEditorDecorationsCollection | null>(null)
  const minEditorHeightRef = useRef(minEditorHeight)
  const disabledRef = useRef(disabled)
  const sendShortcutRef = useRef(sendShortcut)
  const sendShortcutDisabledRef = useRef(Boolean(sendShortcutDisabled))
  const onSendShortcutRef = useRef(onSendShortcut)
  const secondarySendShortcutRef = useRef(secondarySendShortcut)
  const onSecondarySendShortcutRef = useRef(onSecondarySendShortcut)
  const onInputChangeRef = useRef(onInputChange)
  const onCursorChangeRef = useRef(onCursorChange)
  const onKeyDownRef = useRef(onKeyDown)
  const onPasteRef = useRef(onPaste)
  const lastHandledViewShortcutRef = useRef<string | null>(null)
  const imeComposingRef = useRef(false)
  const resolveCompletionMatchRef = useRef(resolveCompletionMatch)
  const resolveTokenDecorationsRef = useRef(resolveTokenDecorations)
  const sessionInfoRef = useRef(sessionInfo)

  minEditorHeightRef.current = minEditorHeight
  disabledRef.current = disabled
  sendShortcutRef.current = sendShortcut
  sendShortcutDisabledRef.current = Boolean(sendShortcutDisabled)
  onSendShortcutRef.current = onSendShortcut
  secondarySendShortcutRef.current = secondarySendShortcut
  onSecondarySendShortcutRef.current = onSecondarySendShortcut
  onInputChangeRef.current = onInputChange
  onCursorChangeRef.current = onCursorChange
  onKeyDownRef.current = onKeyDown
  onPasteRef.current = onPaste
  resolveCompletionMatchRef.current = resolveCompletionMatch
  resolveTokenDecorationsRef.current = resolveTokenDecorations
  sessionInfoRef.current = sessionInfo

  useSenderEditorHandle({ editorRef, standaloneEditorRef, value, disabledRef })

  useEffect(() => {
    standaloneEditorRef.current?.updateOptions({
      readOnly: disabled,
      domReadOnly: disabled
    })
  }, [disabled])

  useEffect(() => {
    const editor = standaloneEditorRef.current
    setEditorHeight(clampEditorHeight(editor?.getContentHeight() ?? minEditorHeight, minEditorHeight))
  }, [minEditorHeight])

  const applyDecorations = () => {
    const editor = standaloneEditorRef.current
    const model = editor?.getModel()

    if (editor == null || model == null) {
      return
    }

    const nextDecorations = resolveTokenDecorationsRef.current(model.getValue()).map(({ start, end, className }) => ({
      range: toMonacoRange(model, start, end),
      options: { inlineClassName: className }
    }))

    if (decorationsRef.current == null) {
      decorationsRef.current = editor.createDecorationsCollection(nextDecorations)
      return
    }

    decorationsRef.current.set(nextDecorations)
  }

  useEffect(() => {
    applyDecorations()
  }, [value])

  useEffect(() => {
    return () => {
      const editor = standaloneEditorRef.current as
        | (MonacoEditorNamespace.IStandaloneCodeEditor & {
          __vfDispose?: () => void
        })
        | null

      editor?.__vfDispose?.()
      decorationsRef.current?.clear()
      decorationsRef.current = null
      standaloneEditorRef.current = null
    }
  }, [])

  const handleEditorMount = (
    editor: MonacoEditorNamespace.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor')
  ) => {
    standaloneEditorRef.current = editor
    setEditorHeight(clampEditorHeight(editor.getContentHeight(), minEditorHeightRef.current))
    applyDecorations()

    const disposables: IDisposable[] = [registerSenderCompletionProvider({
      monaco,
      resolveCompletionMatch: (nextValue, cursorOffset) =>
        resolveCompletionMatchRef.current(nextValue, cursorOffset, sessionInfoRef.current)
    })]
    const domNode = editor.getDomNode()
    const handleViewShortcutKeyDown = (event: KeyboardEvent) => {
      if (window.oneworksDesktop?.onViewShortcut != null) {
        return false
      }

      const action = getDesktopViewShortcutActionFromEvent(event, navigator.platform.includes('Mac'))
      if (action == null) {
        return false
      }

      const eventKey =
        `${event.timeStamp}:${event.key}:${event.metaKey}:${event.ctrlKey}:${event.altKey}:${event.shiftKey}`
      if (lastHandledViewShortcutRef.current === eventKey) {
        return true
      }

      lastHandledViewShortcutRef.current = eventKey
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      emitDesktopViewShortcut(action, { source: 'monaco' })
      return true
    }

    if (domNode != null) {
      const inputTargets = Array.from(
        domNode.querySelectorAll<HTMLElement>('.native-edit-context, textarea.inputarea')
      )
      let compositionEndTimer: number | null = null
      const markImeCompositionStart = () => {
        if (compositionEndTimer != null) {
          window.clearTimeout(compositionEndTimer)
          compositionEndTimer = null
        }
        imeComposingRef.current = true
      }
      const markImeCompositionEnd = () => {
        if (compositionEndTimer != null) {
          window.clearTimeout(compositionEndTimer)
        }
        compositionEndTimer = window.setTimeout(() => {
          imeComposingRef.current = false
          compositionEndTimer = null
        }, 0)
      }
      const shouldHandleImagePaste = (event: ClipboardEvent, requireFocus: boolean) => {
        if (!hasPastedImageFile(event.clipboardData)) {
          return false
        }

        if (!requireFocus) {
          return true
        }

        const activeElement = document.activeElement

        return editor.hasTextFocus() ||
          (activeElement != null && domNode.contains(activeElement)) ||
          (event.target instanceof Node && domNode.contains(event.target))
      }
      const handleImagePaste = (
        event: ClipboardEvent,
        { requireFocus, stopImmediately }: { requireFocus: boolean; stopImmediately: boolean }
      ) => {
        if (!shouldHandleImagePaste(event, requireFocus)) {
          return
        }

        event.preventDefault()
        event.stopPropagation()

        if (stopImmediately) {
          event.stopImmediatePropagation()
        }

        void onPasteRef.current(event)
      }
      const handleDocumentPaste = (event: ClipboardEvent) => {
        if (!shouldHandleImagePaste(event, true)) {
          return
        }

        handleImagePaste(event, { requireFocus: true, stopImmediately: true })
      }
      const handleNativePaste: EventListener = (event) => {
        if (!(event instanceof ClipboardEvent)) {
          return
        }

        handleImagePaste(event, { requireFocus: false, stopImmediately: true })
      }
      const handleNativeKeyDown: EventListener = (event) => {
        if (!(event instanceof KeyboardEvent)) {
          return
        }
        if (isImeComposingKeyboardEvent(event, imeComposingRef.current)) {
          return
        }
        if (handleViewShortcutKeyDown(event)) {
          return
        }
        if (
          secondarySendShortcutRef.current != null &&
          onSecondarySendShortcutRef.current != null &&
          isShortcutMatch(event, secondarySendShortcutRef.current, navigator.platform.includes('Mac'))
        ) {
          event.preventDefault()
          event.stopPropagation()
          onSecondarySendShortcutRef.current()
          return
        }
        if (
          !sendShortcutDisabledRef.current &&
          isShortcutMatch(event, sendShortcutRef.current, navigator.platform.includes('Mac'))
        ) {
          event.preventDefault()
          event.stopPropagation()
          onSendShortcutRef.current()
        }
      }

      document.addEventListener('paste', handleDocumentPaste, true)
      for (const inputTarget of inputTargets) {
        inputTarget.addEventListener('paste', handleNativePaste, true)
        inputTarget.addEventListener('keydown', handleNativeKeyDown, true)
        inputTarget.addEventListener('compositionstart', markImeCompositionStart, true)
        inputTarget.addEventListener('compositionend', markImeCompositionEnd, true)
      }
      disposables.push({
        dispose: () => {
          if (compositionEndTimer != null) {
            window.clearTimeout(compositionEndTimer)
          }
          imeComposingRef.current = false
          document.removeEventListener('paste', handleDocumentPaste, true)
          for (const inputTarget of inputTargets) {
            inputTarget.removeEventListener('paste', handleNativePaste, true)
            inputTarget.removeEventListener('keydown', handleNativeKeyDown, true)
            inputTarget.removeEventListener('compositionstart', markImeCompositionStart, true)
            inputTarget.removeEventListener('compositionend', markImeCompositionEnd, true)
          }
        }
      })
    }

    disposables.push(
      editor.onDidContentSizeChange(() => {
        setEditorHeight(clampEditorHeight(editor.getContentHeight(), minEditorHeightRef.current))
      }),
      editor.onDidChangeModelContent(() => {
        const cursorOffset = getSelectionOffsets(editor)?.end ?? null
        const nextValue = editor.getValue()

        onInputChangeRef.current(nextValue, cursorOffset)

        if (resolveCompletionMatchRef.current(nextValue, cursorOffset, sessionInfoRef.current) != null) {
          requestAnimationFrame(() => {
            if (standaloneEditorRef.current === editor) {
              editor.trigger('oneworks.sender', 'editor.action.triggerSuggest', {})
            }
          })
        }
      }),
      editor.onDidChangeCursorSelection(() => {
        onCursorChangeRef.current(getSelectionOffsets(editor)?.end ?? null)
      }),
      editor.onKeyDown((event) => {
        if (isImeComposingKeyboardEvent(event.browserEvent, imeComposingRef.current)) {
          return
        }

        if (handleViewShortcutKeyDown(event.browserEvent)) {
          return
        }

        onKeyDownRef.current(event.browserEvent)
      })
    )
    ;(editor as MonacoEditorNamespace.IStandaloneCodeEditor & { __vfDispose?: () => void }).__vfDispose = () => {
      for (const item of disposables) {
        item.dispose()
      }
    }
  }

  return {
    themeName,
    editorHeight,
    handleEditorMount
  }
}
