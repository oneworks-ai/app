import { Tag, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import type { SkillHubRegistrySummary } from '#~/api.js'

export function SkillRegistryErrors({ registries }: { registries: SkillHubRegistrySummary[] }) {
  const { t } = useTranslation()
  const registryErrors = registries.filter(item => item.error != null)
  if (registryErrors.length === 0) return null

  return (
    <div className='knowledge-base-view__skill-registry-errors'>
      {registryErrors.map(item => (
        <Tooltip key={item.id} title={item.error}>
          <Tag color='warning' className='knowledge-base-view__skill-registry-error'>
            <span className='material-symbols-rounded knowledge-base-view__tag-icon'>warning</span>
            <span>
              {item.name} · {item.builtIn ? t('knowledge.skills.builtInRegistry') : item.configLabel}
            </span>
          </Tag>
        </Tooltip>
      ))}
    </div>
  )
}
