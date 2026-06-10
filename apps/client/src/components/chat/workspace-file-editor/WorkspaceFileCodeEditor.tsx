import Editor from '@monaco-editor/react'
import type { editor as MonacoEditorNamespace } from 'monaco-editor'
import { useEffect, useRef } from 'react'

import { monacoApi } from '#~/components/monaco/monaco-runtime'
import { useMonacoTheme } from '#~/components/monaco/use-monaco-theme'

export function WorkspaceFileCodeEditor({
  content,
  language,
  path,
  onChange,
  onSave
}: {
  content: string
  language: string
  path: string
  onChange: (value: string) => void
  onSave: () => void
}) {
  const themeName = useMonacoTheme()
  const saveHandlerRef = useRef(onSave)

  useEffect(() => {
    saveHandlerRef.current = onSave
  }, [onSave])

  const handleMount = (
    editor: MonacoEditorNamespace.IStandaloneCodeEditor
  ) => {
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
      saveHandlerRef.current()
    })
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
          lineHeight: 18,
          tabSize: 2
        }}
      />
    </div>
  )
}
