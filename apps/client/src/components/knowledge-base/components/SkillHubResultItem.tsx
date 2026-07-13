import { Button, Tag, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import type { SkillHubConfigSource, SkillHubInstallTarget, SkillHubItem } from '#~/api.js'
import { MarketplaceCapabilityTags, MarketplaceCard } from '#~/components/marketplace/MarketplaceCard'
import { joinValues } from './skill-hub-utils'

export function SkillHubResultItem({
  item,
  installDisabled,
  installingTarget,
  onInstall
}: {
  item: SkillHubItem
  installDisabled: boolean
  installingTarget: SkillHubInstallTarget | null
  onInstall: (item: SkillHubItem, target: SkillHubInstallTarget) => void
}) {
  const { t } = useTranslation()
  const subtitle = joinValues([
    item.registryName !== item.source ? item.registryName : '',
    item.source,
    item.builtIn ? t('knowledge.skills.builtInRegistry') : item.configLabel
  ])
  const sourceLabelKeys: Record<SkillHubConfigSource, string> = {
    global: 'knowledge.skills.sourceGlobalConfig',
    project: 'knowledge.skills.sourceProjectConfig',
    user: 'knowledge.skills.sourceUserConfig'
  }
  const installTargets: Array<{ icon: string; target: SkillHubInstallTarget }> = [
    { icon: 'folder', target: 'project' },
    { icon: 'public', target: 'global' }
  ]

  return (
    <MarketplaceCard
      icon={<span className='material-symbols-rounded'>extension</span>}
      title={item.name}
      titleMeta={
        <>
          {item.installed && <Tag>{t('knowledge.skills.installed')}</Tag>}
          {item.declaredSources.map(source => <Tag key={source}>{t(sourceLabelKeys[source])}</Tag>)}
        </>
      }
      subtitle={subtitle === '' ? undefined : subtitle}
      description={item.description?.trim() === '' ? undefined : item.description}
      footer={
        <MarketplaceCapabilityTags
          groups={[
            { key: 'skills', icon: 'psychology', values: item.skills },
            { key: 'commands', icon: 'terminal', values: item.commands },
            { key: 'agents', icon: 'groups', values: item.agents },
            { key: 'mcp', icon: 'account_tree', values: item.mcpServers },
            { key: 'hooks', icon: 'bolt', values: item.hasHooks ? [t('knowledge.skills.hooks')] : [] }
          ]}
        />
      }
      actions={installTargets.map(({ icon, target }) => {
        const declared = item.declaredSources.includes(target)
        const title = t(
          target === 'global'
            ? declared ? 'knowledge.skills.reinstallToGlobal' : 'knowledge.skills.installToGlobal'
            : declared
            ? 'knowledge.skills.reinstallToProject'
            : 'knowledge.skills.installToProject'
        )
        return (
          <Tooltip key={target} title={title}>
            <Button
              aria-label={title}
              type={declared ? 'default' : 'primary'}
              className='marketplace-card__icon-button'
              disabled={installDisabled || (installingTarget != null && installingTarget !== target)}
              loading={installingTarget === target}
              onClick={() => onInstall(item, target)}
              icon={<span className='material-symbols-rounded'>{icon}</span>}
            />
          </Tooltip>
        )
      })}
    />
  )
}
