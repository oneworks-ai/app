import Editor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import { Button, Input } from 'antd'
import type { editor as MonacoEditorNamespace } from 'monaco-editor'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useMonacoTheme } from '#~/components/monaco/use-monaco-theme'

import { InteractionPanelRunCommandEnvironmentEditor } from './InteractionPanelRunCommandEnvironmentEditor'
import { InteractionPanelRunCommandIconSelect } from './InteractionPanelRunCommandIconSelect'
import type { InteractionPanelRunCommand } from './interaction-panel-run-commands'

const EDITOR_LINE_HEIGHT = 18
const EDITOR_MIN_LINES = 5
const EDITOR_MAX_LINES = 10

const EDITOR_OPTIONS: MonacoEditorNamespace.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  contextmenu: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 12,
  folding: false,
  glyphMargin: false,
  lineDecorationsWidth: 0,
  lineHeight: EDITOR_LINE_HEIGHT,
  lineNumbers: 'off',
  lineNumbersMinChars: 0,
  minimap: { enabled: false },
  overviewRulerBorder: false,
  padding: { top: 0, bottom: 0 },
  renderLineHighlight: 'line',
  scrollBeyondLastLine: false,
  scrollbar: {
    alwaysConsumeMouseWheel: false,
    useShadows: false
  },
  tabSize: 2,
  wordWrap: 'on'
}

export function InteractionPanelRunCommandEditor({
  canSave,
  command,
  hasCommands,
  onBack,
  onCancel,
  onChange,
  onDelete,
  onRun,
  onRunShortcut,
  onSave,
  onSaveShortcut
}: {
  canSave: boolean
  command: InteractionPanelRunCommand
  hasCommands: boolean
  onBack: () => void
  onCancel: () => void
  onChange: (patch: Partial<Pick<InteractionPanelRunCommand, 'cwd' | 'env' | 'icon' | 'name' | 'script'>>) => void
  onDelete: () => void
  onRun: () => void
  onRunShortcut: () => void
  onSave: () => void
  onSaveShortcut: () => void
}) {
  const { t } = useTranslation()
  const themeName = useMonacoTheme()
  const shortcutHandlersRef = useRef({
    canSave,
    onRunShortcut,
    onSaveShortcut
  })
  const scriptLineCount = command.script.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').length
  const visibleLineCount = Math.min(EDITOR_MAX_LINES, Math.max(EDITOR_MIN_LINES, scriptLineCount))

  useEffect(() => {
    shortcutHandlersRef.current = {
      canSave,
      onRunShortcut,
      onSaveShortcut
    }
  }, [canSave, onRunShortcut, onSaveShortcut])

  const handleEditorMount = useCallback<OnMount>((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (!shortcutHandlersRef.current.canSave) return

      shortcutHandlersRef.current.onSaveShortcut()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (!shortcutHandlersRef.current.canSave) return

      shortcutHandlersRef.current.onRunShortcut()
    })
  }, [])

  return (
    <div className='chat-header-run-command-panel chat-header-run-command-editor'>
      <div className='chat-header-run-command-editor__meta'>
        <InteractionPanelRunCommandIconSelect
          value={command.icon ?? ''}
          onChange={icon => onChange({ icon })}
        />
        <Input
          className='chat-header-run-command-editor__title'
          value={command.name}
          placeholder={t('chat.interactionPanel.runCommandNamePlaceholder')}
          aria-label={t('chat.interactionPanel.runCommandName')}
          onChange={event => onChange({ name: event.target.value })}
        />
      </div>
      <div
        className='chat-header-run-command-editor__monaco'
        style={{ height: visibleLineCount * EDITOR_LINE_HEIGHT }}
      >
        <Editor
          value={command.script}
          language='shell'
          theme={themeName}
          loading={null}
          onChange={nextValue => onChange({ script: nextValue ?? '' })}
          onMount={handleEditorMount}
          options={EDITOR_OPTIONS}
        />
        {command.script === '' && (
          <div className='chat-header-run-command-editor__placeholder'>
            {t('chat.interactionPanel.runCommandScriptPlaceholder')}
          </div>
        )}
      </div>
      <InteractionPanelRunCommandEnvironmentEditor
        cwd={command.cwd}
        env={command.env}
        onChange={onChange}
      />
      <div className='chat-header-run-command-editor__footer'>
        {hasCommands && (
          <Button
            type='text'
            size='small'
            className='chat-header-run-command-editor__icon-button'
            icon={<span className='material-symbols-rounded'>arrow_back</span>}
            title={t('chat.interactionPanel.runCommandBackToList')}
            aria-label={t('chat.interactionPanel.runCommandBackToList')}
            onClick={onBack}
          />
        )}
        <Button
          type='text'
          size='small'
          className='chat-header-run-command-editor__icon-button'
          icon={<span className='material-symbols-rounded'>delete</span>}
          title={t('chat.interactionPanel.removeRunCommand')}
          aria-label={t('chat.interactionPanel.removeRunCommand')}
          onClick={onDelete}
        />
        <div className='chat-header-run-command-editor__spacer' />
        <Button
          type='text'
          size='small'
          className='chat-header-run-command-editor__icon-button'
          icon={<span className='material-symbols-rounded'>close</span>}
          title={t('common.cancel')}
          aria-label={t('common.cancel')}
          onClick={onCancel}
        />
        <Button
          type='text'
          size='small'
          className='chat-header-run-command-editor__icon-button'
          disabled={!canSave}
          icon={<span className='material-symbols-rounded'>save</span>}
          title={t('config.actions.save')}
          aria-label={t('config.actions.save')}
          onClick={onSave}
        />
        <Button
          type='text'
          size='small'
          className='chat-header-run-command-editor__icon-button'
          disabled={!canSave}
          icon={<span className='material-symbols-rounded'>play_arrow</span>}
          title={t('chat.interactionPanel.runCommandRun')}
          aria-label={t('chat.interactionPanel.runCommandRun')}
          onClick={onRun}
        />
      </div>
    </div>
  )
}
