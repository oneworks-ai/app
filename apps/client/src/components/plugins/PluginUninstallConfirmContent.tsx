import { useTranslation } from 'react-i18next'

import type {
  PluginMarketplaceUninstallDeleteItem,
  PluginMarketplaceUninstallPlan,
  PluginMarketplaceUninstallRetainItem
} from '@oneworks/types'

type AvailableUninstallPlan = Extract<PluginMarketplaceUninstallPlan, { available: true }>

const deleteItemKey: Record<PluginMarketplaceUninstallDeleteItem, string> = {
  'managed-install': 'pluginStore.uninstall.deleteManagedInstall',
  'project-marketplace-declaration': 'pluginStore.uninstall.deleteProjectDeclaration',
  'project-runtime-override': 'pluginStore.uninstall.deleteProjectRuntimeOverride'
}

const retainItemKey: Record<PluginMarketplaceUninstallRetainItem, string> = {
  'global-config': 'pluginStore.uninstall.retainGlobalConfig',
  'managed-plugin-data': 'pluginStore.uninstall.retainManagedPluginData',
  'shared-package-cache': 'pluginStore.uninstall.retainSharedPackageCache',
  'sibling-plugins': 'pluginStore.uninstall.retainSiblingPlugins',
  'user-config': 'pluginStore.uninstall.retainUserConfig',
  'user-data-and-accounts': 'pluginStore.uninstall.retainUserDataAndAccounts'
}

export function PluginUninstallConfirmContent(props: {
  plan: AvailableUninstallPlan
}) {
  const { t } = useTranslation()
  return (
    <div data-testid='plugin-uninstall-confirm-content'>
      <p>{t('pluginStore.uninstall.disableDifference')}</p>
      <p>
        {t('pluginStore.uninstall.projectScope', {
          marketplace: props.plan.identity.marketplace,
          plugin: props.plan.identity.plugin
        })}
      </p>
      <section aria-labelledby='plugin-uninstall-delete-heading'>
        <strong id='plugin-uninstall-delete-heading'>
          {t('pluginStore.uninstall.willDelete')}
        </strong>
        <ul>
          {props.plan.deleteItems.map(item => (
            <li key={item}>{t(deleteItemKey[item])}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby='plugin-uninstall-retain-heading'>
        <strong id='plugin-uninstall-retain-heading'>
          {t('pluginStore.uninstall.willRetain')}
        </strong>
        <ul>
          {props.plan.retainItems.map(item => (
            <li key={item}>{t(retainItemKey[item])}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
