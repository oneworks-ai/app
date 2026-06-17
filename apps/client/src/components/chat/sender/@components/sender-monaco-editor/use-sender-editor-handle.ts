import type { editor as MonacoEditorNamespace } from 'monaco-editor'
import type { MutableRefObject } from 'react'
import { useEffect } from 'react'

import type { SenderEditorHandle, SenderEditorSelection } from '#~/components/chat/sender/@types/sender-editor'

import { getSelectionOffsets, toMonacoRange } from './monaco-runtime'

export const useSenderEditorHandle = ({
  editorRef,
  standaloneEditorRef,
  value,
  disabledRef
}: {
  editorRef: MutableRefObject<SenderEditorHandle | null>
  standaloneEditorRef: MutableRefObject<MonacoEditorNamespace.IStandaloneCodeEditor | null>
  value: string
  disabledRef: MutableRefObject<boolean>
}) => {
  useEffect(() => {
    editorRef.current = {
      focus: () => {
        standaloneEditorRef.current?.focus()
      },
      replaceSelection: (text: string, selection?: SenderEditorSelection | null) => {
        const editor = standaloneEditorRef.current
        const model = editor?.getModel()

        if (editor == null || model == null) {
          return
        }

        const currentSelection = selection ?? getSelectionOffsets(editor) ?? {
          start: editor.getValue().length,
          end: editor.getValue().length
        }
        const start = Math.max(0, Math.min(currentSelection.start, editor.getValue().length))
        const end = Math.max(start, Math.min(currentSelection.end, editor.getValue().length))
        editor.executeEdits('oneworks.sender.voice', [{
          range: toMonacoRange(model, start, end),
          text,
          forceMoveMarkers: true
        }])
        const nextOffset = start + text.length
        editor.setSelection(toMonacoRange(model, nextOffset, nextOffset))
        editor.focus()
      },
      setValue: (nextValue: string, selection?: SenderEditorSelection | null) => {
        const editor = standaloneEditorRef.current
        const model = editor?.getModel()

        if (editor == null || model == null) {
          return
        }

        if (editor.getValue() !== nextValue) {
          editor.setValue(nextValue)
        }
        if (selection != null) {
          const start = Math.max(0, Math.min(selection.start, nextValue.length))
          const end = Math.max(start, Math.min(selection.end, nextValue.length))
          editor.setSelection(toMonacoRange(model, start, end))
        }
      },
      setSelection: (selection: SenderEditorSelection) => {
        const editor = standaloneEditorRef.current
        const model = editor?.getModel()

        if (editor == null || model == null) {
          return
        }

        editor.setSelection(toMonacoRange(model, selection.start, selection.end))
      },
      getSelection: () => {
        const editor = standaloneEditorRef.current

        return editor == null ? null : getSelectionOffsets(editor)
      },
      getValue: () => standaloneEditorRef.current?.getValue() ?? value,
      isDisabled: () => disabledRef.current
    }

    return () => {
      editorRef.current = null
    }
  }, [disabledRef, editorRef, standaloneEditorRef, value])
}
