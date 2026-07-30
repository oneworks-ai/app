import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { PluginUninstallConfirmContent } from '#~/components/plugins/PluginUninstallConfirmContent'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('plugin uninstall confirmation content', () => {
  it('renders only the server-authoritative semantic delete and retain items', () => {
    const markup = renderToStaticMarkup(
      <PluginUninstallConfirmContent
        plan={{
          available: true,
          deleteItems: [
            'project-marketplace-declaration',
            'managed-install'
          ],
          identity: {
            adapter: 'claude',
            marketplace: 'team',
            plugin: 'reviewer',
            scope: 'review'
          },
          retainItems: [
            'global-config',
            'user-config',
            'managed-plugin-data',
            'user-data-and-accounts'
          ],
          token: 'a'.repeat(64)
        }}
      />
    )

    expect(markup).toContain('pluginStore.uninstall.disableDifference')
    expect(markup).toContain('pluginStore.uninstall.willDelete')
    expect(markup).toContain('pluginStore.uninstall.deleteProjectDeclaration')
    expect(markup).toContain('pluginStore.uninstall.deleteManagedInstall')
    expect(markup).not.toContain('pluginStore.uninstall.deleteProjectRuntimeOverride')
    expect(markup).toContain('pluginStore.uninstall.willRetain')
    expect(markup).toContain('pluginStore.uninstall.retainGlobalConfig')
    expect(markup).toContain('pluginStore.uninstall.retainUserConfig')
    expect(markup).toContain('pluginStore.uninstall.retainManagedPluginData')
    expect(markup).toContain('pluginStore.uninstall.retainUserDataAndAccounts')
    expect(markup).not.toContain('/managed/')
    expect(markup).not.toContain('aaaaaaaa')
  })
})
