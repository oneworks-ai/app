import type { RefObject } from 'react'
import { useEffect } from 'react'

import type { SenderEditorHandle } from '#~/components/chat/sender/@types/sender-editor'

const MAX_AUTO_FOCUS_LOOKUP_ATTEMPTS = 60
const MAX_AUTO_FOCUS_READY_ATTEMPTS = 24

export const useSenderAutofocus = ({
  autoFocus,
  autoFocusKey,
  editorRef
}: {
  autoFocus: boolean
  autoFocusKey?: string
  editorRef: RefObject<SenderEditorHandle | null>
}) => {
  useEffect(() => {
    if (!autoFocus) {
      return
    }

    let frame: number | undefined
    let lookupAttempts = 0
    let readyAttempts = 0
    let cancelled = false

    const focusWhenEditorIsReady = () => {
      if (cancelled) return

      const editor = editorRef.current

      if (editor == null) {
        lookupAttempts += 1
        if (lookupAttempts < MAX_AUTO_FOCUS_LOOKUP_ATTEMPTS) {
          frame = window.requestAnimationFrame(focusWhenEditorIsReady)
        }
        return
      }

      const length = editor.getValue().length
      editor.focus()
      editor.setSelection({ start: length, end: length })
      readyAttempts += 1
      if (readyAttempts < MAX_AUTO_FOCUS_READY_ATTEMPTS) {
        frame = window.requestAnimationFrame(focusWhenEditorIsReady)
      }
    }

    frame = window.requestAnimationFrame(focusWhenEditorIsReady)

    return () => {
      cancelled = true
      if (frame != null) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [autoFocus, autoFocusKey, editorRef])
}
