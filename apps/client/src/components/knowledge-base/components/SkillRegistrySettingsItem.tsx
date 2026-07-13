import { Button, List, Popconfirm, Switch, Tag, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type { ManagedSkillRegistry } from './skill-registry-settings-utils'

interface SkillRegistrySettingsItemProps {
  registry: ManagedSkillRegistry
  writesDisabled: boolean
  writingKey?: string
  onRemove: (registry: ManagedSkillRegistry) => void
  onToggle: (registry: ManagedSkillRegistry, enabled: boolean) => void
}

const CONFIG_SOURCE_LABELS = {
  global: '~/.oneworks/.oo.config.json',
  project: '.oo.config.json',
  user: '.oo.dev.config.json'
} as const

export const getSkillRegistrySearchText = (registry: ManagedSkillRegistry) => (
  `${registry.title ?? ''} ${registry.description ?? ''} ${registry.source} ${registry.registry ?? ''} ${
    CONFIG_SOURCE_LABELS[registry.configSource]
  }`
)

export function SkillRegistrySettingsItem({
  registry,
  writesDisabled,
  writingKey,
  onRemove,
  onToggle
}: SkillRegistrySettingsItemProps) {
  const { t } = useTranslation()
  const actions = registry.kind === 'builtIn'
    ? [
      <Switch
        key='enabled'
        size='small'
        checked={registry.enabled}
        loading={writingKey === registry.key}
        disabled={writesDisabled}
        aria-label={t(
          registry.enabled
            ? 'knowledge.skills.disableBuiltInRegistryNamed'
            : 'knowledge.skills.enableBuiltInRegistryNamed',
          { source: registry.source }
        )}
        onChange={enabled => onToggle(registry, enabled)}
      />
    ]
    : [
      <Popconfirm
        key='remove'
        title={t('knowledge.skills.removeRegistryConfirm')}
        okText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={() => onRemove(registry)}
      >
        <Tooltip title={t('knowledge.skills.removeRegistryNamed', { source: registry.source })}>
          <Button
            danger
            type='text'
            aria-label={t('knowledge.skills.removeRegistryNamed', { source: registry.source })}
            icon={<MaterialSymbol name='delete' />}
            loading={writingKey === registry.key}
            disabled={writesDisabled}
          />
        </Tooltip>
      </Popconfirm>
    ]

  return (
    <List.Item className='knowledge-base-view__registry-settings-item' actions={actions}>
      <div className='knowledge-base-view__registry-settings-main'>
        <div className='knowledge-base-view__registry-settings-title'>
          <span>{registry.title ?? registry.source}</span>
          <Tag>
            {registry.kind === 'builtIn'
              ? t('knowledge.skills.builtInRegistry')
              : CONFIG_SOURCE_LABELS[registry.configSource]}
          </Tag>
          {registry.kind === 'legacy' && <Tag>{t('knowledge.skills.legacyRegistry')}</Tag>}
        </div>
        <div className='knowledge-base-view__registry-settings-source'>{registry.source}</div>
        {registry.description != null && (
          <div className='knowledge-base-view__registry-settings-registry'>{registry.description}</div>
        )}
        {registry.registry != null && (
          <div className='knowledge-base-view__registry-settings-registry'>{registry.registry}</div>
        )}
      </div>
    </List.Item>
  )
}
