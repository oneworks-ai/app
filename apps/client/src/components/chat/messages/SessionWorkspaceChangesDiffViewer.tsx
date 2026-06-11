import { DiffEditor, Editor } from '@monaco-editor/react'
import type { editor as MonacoEditorNamespace } from 'monaco-editor'
import { useMemo } from 'react'

import { useMonacoTheme } from '#~/components/monaco/use-monaco-theme'

import { getWorkspaceFileEditorLanguage } from '../workspace-file-editor/workspace-file-editor-language'
import { parseUnifiedPatchForMonaco } from './session-workspace-diff'

const DIFF_LINE_HEIGHT = 18
const MIN_DIFF_HEIGHT = 132
const MAX_DIFF_HEIGHT = 420

const getLineCount = (value: string) => value === '' ? 1 : value.split('\n').length

const getEditorHeight = (...values: string[]) => {
  const lineCount = Math.max(...values.map(getLineCount))
  return Math.min(MAX_DIFF_HEIGHT, Math.max(MIN_DIFF_HEIGHT, lineCount * DIFF_LINE_HEIGHT + 30))
}

const editorFontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

export function SessionWorkspaceChangesDiffViewer({
  path,
  patch
}: {
  path: string
  patch: string
}) {
  const themeName = useMonacoTheme()
  const language = useMemo(() => getWorkspaceFileEditorLanguage(path), [path])
  const parsedPatch = useMemo(() => parseUnifiedPatchForMonaco(patch), [patch])
  const height = useMemo(() => (
    parsedPatch == null
      ? getEditorHeight(patch)
      : getEditorHeight(parsedPatch.original, parsedPatch.modified)
  ), [parsedPatch, patch])

  return (
    <div className='session-workspace-changes-card__monaco-diff' style={{ height: `${height}px` }}>
      {parsedPatch == null
        ? (
          <Editor
            value={patch}
            language='diff'
            theme={themeName}
            loading={null}
            options={{
              automaticLayout: true,
              contextmenu: false,
              domReadOnly: true,
              fontFamily: editorFontFamily,
              fontSize: 12,
              glyphMargin: false,
              lineDecorationsWidth: 8,
              lineHeight: DIFF_LINE_HEIGHT,
              lineNumbersMinChars: 3,
              minimap: { enabled: false },
              overviewRulerBorder: false,
              readOnly: true,
              renderLineHighlight: 'none',
              scrollBeyondLastLine: false,
              scrollbar: {
                alwaysConsumeMouseWheel: false,
                useShadows: false
              },
              wordWrap: 'off'
            } satisfies MonacoEditorNamespace.IStandaloneEditorConstructionOptions}
          />
        )
        : (
          <DiffEditor
            original={parsedPatch.original}
            modified={parsedPatch.modified}
            originalLanguage={language}
            modifiedLanguage={language}
            theme={themeName}
            loading={null}
            options={{
              automaticLayout: true,
              contextmenu: false,
              diffCodeLens: false,
              fontFamily: editorFontFamily,
              fontSize: 12,
              glyphMargin: false,
              hideUnchangedRegions: { enabled: false },
              lineDecorationsWidth: 8,
              lineHeight: DIFF_LINE_HEIGHT,
              lineNumbersMinChars: 3,
              minimap: { enabled: false },
              originalEditable: false,
              overviewRulerBorder: false,
              readOnly: true,
              renderIndicators: true,
              renderMarginRevertIcon: false,
              renderOverviewRuler: false,
              renderSideBySide: false,
              scrollBeyondLastLine: false,
              scrollbar: {
                alwaysConsumeMouseWheel: false,
                useShadows: false
              },
              wordWrap: 'off'
            } satisfies MonacoEditorNamespace.IDiffEditorConstructionOptions}
          />
        )}
    </div>
  )
}
