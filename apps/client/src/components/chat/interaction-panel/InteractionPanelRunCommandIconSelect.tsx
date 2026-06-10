import { Input } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'

const RUN_COMMAND_ICON_OPTIONS = [
  'terminal',
  'slideshow',
  'play_arrow',
  'code',
  'deployed_code',
  'build',
  'rocket_launch',
  'data_object',
  'integration_instructions',
  'sync',
  'refresh',
  'bug_report',
  'science',
  'web',
  'storage',
  'database',
  'cloud',
  'settings',
  'tune',
  'bolt',
  'task_alt'
]

export function InteractionPanelRunCommandIconSelect({
  onChange,
  value
}: {
  onChange: (icon: string) => void
  value?: string
}) {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const currentIcon = value?.trim() || 'terminal'
  const options = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase()
    const icons = RUN_COMMAND_ICON_OPTIONS.includes(currentIcon)
      ? RUN_COMMAND_ICON_OPTIONS
      : [currentIcon, ...RUN_COMMAND_ICON_OPTIONS]

    return icons
      .filter(icon => normalizedSearch === '' || icon.toLowerCase().includes(normalizedSearch))
      .map(icon => ({
        value: icon,
        label: (
          <span className='chat-header-run-command-editor__icon-option'>
            <span className='material-symbols-rounded'>{icon}</span>
            <span>{icon}</span>
          </span>
        )
      }))
  }, [currentIcon, searchText])

  return (
    <Select
      className='chat-header-run-command-editor__icon'
      value={currentIcon}
      suffixIcon={null}
      optionFilterProp='value'
      popupMatchSelectWidth={220}
      popupClassName='chat-header-run-command-editor__icon-popup'
      mobileTitle={t('chat.interactionPanel.runCommandIcon')}
      options={options}
      optionRender={(option) => {
        const icon = String(option.value)

        return (
          <span className='chat-header-run-command-editor__icon-option'>
            <span className='material-symbols-rounded'>{icon}</span>
            <span>{icon}</span>
          </span>
        )
      }}
      labelRender={() => <span className='material-symbols-rounded'>{currentIcon}</span>}
      popupRender={menu => (
        <div className='chat-header-run-command-editor__icon-panel'>
          <Input
            autoFocus
            value={searchText}
            placeholder={t('chat.interactionPanel.runCommandIconPlaceholder')}
            className='chat-header-run-command-editor__icon-search'
            onChange={event => setSearchText(event.target.value)}
            onKeyDown={event => event.stopPropagation()}
            onMouseDown={event => event.stopPropagation()}
          />
          {menu}
        </div>
      )}
      aria-label={t('chat.interactionPanel.runCommandIcon')}
      onChange={onChange}
      onOpenChange={(open) => {
        if (!open) {
          setSearchText('')
        }
      }}
    />
  )
}
