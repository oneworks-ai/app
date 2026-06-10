import { Button, Input } from 'antd'
import { useTranslation } from 'react-i18next'

import type { InteractionPanelRunCommand, InteractionPanelRunCommandEnvVar } from './interaction-panel-run-commands'

const createEnvVar = (): InteractionPanelRunCommandEnvVar => ({ key: '', value: '' })

export function InteractionPanelRunCommandEnvironmentEditor({
  cwd,
  env,
  onChange
}: {
  cwd?: string
  env?: InteractionPanelRunCommandEnvVar[]
  onChange: (patch: Partial<Pick<InteractionPanelRunCommand, 'cwd' | 'env'>>) => void
}) {
  const { t } = useTranslation()
  const entries = env ?? []

  const updateEntry = (
    index: number,
    patch: Partial<InteractionPanelRunCommandEnvVar>
  ) => {
    onChange({ env: entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry) })
  }

  return (
    <details className='chat-header-run-command-env'>
      <summary className='chat-header-run-command-env__summary'>
        <span className='chat-header-run-command-env__summary-label'>
          <span className='material-symbols-rounded'>tune</span>
          <span>{t('chat.interactionPanel.runCommandAdvanced')}</span>
        </span>
        <span className='material-symbols-rounded chat-header-run-command-env__chevron'>
          keyboard_arrow_down
        </span>
      </summary>
      <div className='chat-header-run-command-env__body'>
        <Input
          className='chat-header-run-command-env__cwd'
          value={cwd ?? ''}
          placeholder={t('chat.interactionPanel.runCommandCwdPlaceholder')}
          aria-label={t('chat.interactionPanel.runCommandCwd')}
          onChange={event => onChange({ cwd: event.target.value })}
        />
        {entries.map((entry, index) => (
          <div key={index} className='chat-header-run-command-env__row'>
            <Input
              value={entry.key}
              placeholder={t('chat.interactionPanel.runCommandEnvKeyPlaceholder')}
              aria-label={t('chat.interactionPanel.runCommandEnvKey')}
              onChange={event => updateEntry(index, { key: event.target.value })}
            />
            <Input
              value={entry.value}
              placeholder={t('chat.interactionPanel.runCommandEnvValuePlaceholder')}
              aria-label={t('chat.interactionPanel.runCommandEnvValue')}
              onChange={event => updateEntry(index, { value: event.target.value })}
            />
            <Button
              type='text'
              size='small'
              className='chat-header-run-command-env__delete'
              icon={<span className='material-symbols-rounded'>delete</span>}
              title={t('chat.interactionPanel.removeRunCommandEnv')}
              aria-label={t('chat.interactionPanel.removeRunCommandEnv')}
              onClick={() => onChange({ env: entries.filter((_, entryIndex) => entryIndex !== index) })}
            />
          </div>
        ))}
        <Button
          type='text'
          className='chat-header-run-command-env__add'
          icon={<span className='material-symbols-rounded'>add</span>}
          onClick={() => onChange({ env: [...entries, createEnvVar()] })}
        >
          {t('chat.interactionPanel.addRunCommandEnv')}
        </Button>
      </div>
    </details>
  )
}
