import Editor from '@monaco-editor/react'
import type { editor as MonacoEditorNamespace } from 'monaco-editor'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { PendingFileComment } from '#~/components/chat/sender/@types/sender-composer'
import { monacoApi } from '#~/components/monaco/monaco-runtime'
import { useMonacoTheme } from '#~/components/monaco/use-monaco-theme'

import { WorkspaceFileCodeCommentController } from './workspace-file-code-comment-controller'
import type {
  WorkspaceFileCodeCommentControllerOptions,
  WorkspaceFileCodeCommentDraftState
} from './workspace-file-code-comment-controller'
import type { WorkspaceFileFocusRequest } from './workspace-file-focus-request'

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function WorkspaceFileCodeEditor({
  content,
  focusRequest,
  isMarkdown = false,
  language,
  onCommentDraftStateChange,
  onReferenceFileComments,
  path,
  pendingFileComments = [],
  onChange,
  onSave
}: {
  content: string
  focusRequest?: WorkspaceFileFocusRequest | null
  isMarkdown?: boolean
  language: string
  onCommentDraftStateChange?: (state: WorkspaceFileCodeCommentDraftState) => void
  onReferenceFileComments?: (comments: PendingFileComment[]) => void
  path: string
  pendingFileComments?: PendingFileComment[]
  onChange: (value: string) => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  const themeName = useMonacoTheme()
  const editorRef = useRef<MonacoEditorNamespace.IStandaloneCodeEditor | null>(null)
  const commentControllerRef = useRef<WorkspaceFileCodeCommentController | null>(null)
  const saveHandlerRef = useRef(onSave)
  const handledFocusRequestIdRef = useRef<number | null>(null)
  const commentControllerOptions = useMemo<WorkspaceFileCodeCommentControllerOptions>(() => ({
    isMarkdown,
    labels: {
      addComment: t('chat.fileComments.addComment'),
      cancel: t('common.cancel'),
      commentingLines: segments => t('chat.fileComments.commentingLines', { segments }),
      confirm: t('chat.fileComments.confirmInline'),
      emptyLine: t('chat.fileComments.emptyLine'),
      lineSegment: lineNumber => t('chat.fileComments.lineSegment', { lineNumber }),
      lineSegmentRange: (startLineNumber, endLineNumber) =>
        t('chat.fileComments.lineSegmentRange', { endLineNumber, startLineNumber }),
      lineSegmentSeparator: t('chat.fileComments.lineSegmentSeparator'),
      placeholder: t('chat.fileComments.placeholder'),
      sourceEditor: t('chat.fileComments.sourceEditor')
    },
    onDraftStateChange: onCommentDraftStateChange,
    onReferenceFileComments,
    path
  }), [isMarkdown, onCommentDraftStateChange, onReferenceFileComments, path, t])

  useEffect(() => {
    saveHandlerRef.current = onSave
  }, [onSave])

  useEffect(() => {
    const editor = editorRef.current
    if (commentControllerRef.current == null && editor != null) {
      commentControllerRef.current = new WorkspaceFileCodeCommentController(editor, commentControllerOptions)
    }
    commentControllerRef.current?.updateOptions(commentControllerOptions)
    commentControllerRef.current?.syncPendingFileComments(pendingFileComments)
  }, [commentControllerOptions, pendingFileComments])

  useEffect(() => {
    const editor = editorRef.current
    if (
      editor == null ||
      focusRequest == null ||
      focusRequest.path !== path ||
      handledFocusRequestIdRef.current === focusRequest.requestId
    ) {
      return
    }

    const model = editor.getModel()
    if (model == null) return

    const lineNumber = clampNumber(focusRequest.line ?? 1, 1, model.getLineCount())
    const column = clampNumber(focusRequest.column ?? 1, 1, model.getLineMaxColumn(lineNumber))
    handledFocusRequestIdRef.current = focusRequest.requestId
    editor.setPosition({ column, lineNumber })
    editor.revealLineInCenter(lineNumber)
    editor.focus()
  }, [focusRequest, path])

  useEffect(() => () => {
    commentControllerRef.current?.dispose()
    commentControllerRef.current = null
  }, [])

  const handleMount = (editor: MonacoEditorNamespace.IStandaloneCodeEditor) => {
    commentControllerRef.current?.dispose()
    editorRef.current = editor
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
      saveHandlerRef.current()
    })
    commentControllerRef.current = new WorkspaceFileCodeCommentController(editor, commentControllerOptions)
    commentControllerRef.current.syncPendingFileComments(pendingFileComments)
    editor.focus()
  }

  return (
    <div className='workspace-file-editor__editor' data-dock-panel-no-resize='true'>
      <Editor
        path={`workspace:///${path}`}
        value={content}
        language={language}
        theme={themeName}
        loading={null}
        onChange={value => onChange(value ?? '')}
        onMount={handleMount}
        options={{
          automaticLayout: true,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 12,
          glyphMargin: false,
          lineHeight: 18,
          tabSize: 2
        }}
      />
    </div>
  )
}
