import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

const visuallyHiddenStatusStyle: CSSProperties = {
  border: 0,
  clip: 'rect(0, 0, 0, 0)',
  height: 1,
  margin: -1,
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: 1
}

export const PluginMarketplaceUninstallStatus = ({ active }: { active: boolean }) => {
  const { t } = useTranslation()
  if (!active) return null
  return (
    <span
      aria-atomic='true'
      aria-live='polite'
      role='status'
      style={visuallyHiddenStatusStyle}
    >
      {t('pluginStore.uninstall.indeterminate')}
    </span>
  )
}
