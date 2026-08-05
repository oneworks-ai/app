import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  PluginUninstallConfirmContent,
  PluginUninstallIntentConfirmContent
} from '#~/components/plugins/PluginUninstallConfirmContent'
import { PRIVATE_PLUGIN_PRESENTATION_VALUE } from '#~/plugins/plugin-presentation'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (
      key === 'pluginStore.uninstall.projectScope'
        ? `${key}:${String(values?.marketplace)}:${String(values?.plugin)}`
        : key
    )
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

  it('projects raw identity in both intent and quoted-plan presentation', () => {
    const marketplaceSentinel = 'synthetic-confirm-credential-sentinel'
    const pluginSentinel = 'synthetic-confirm-private-sentinel'
    const identity = {
      adapter: 'claude' as const,
      marketplace: `credential://${marketplaceSentinel}:secret@public.invalid/catalog`,
      plugin: `/synthetic-confirm-root/${pluginSentinel}`,
      scope: 'synthetic-confirm-scope'
    }
    const intentMarkup = renderToStaticMarkup(
      <PluginUninstallIntentConfirmContent identity={identity} />
    )
    const planMarkup = renderToStaticMarkup(
      <PluginUninstallConfirmContent
        plan={{
          available: true,
          deleteItems: ['managed-install'],
          identity,
          retainItems: ['sibling-plugins'],
          token: 'b'.repeat(64)
        }}
      />
    )

    for (const markup of [intentMarkup, planMarkup]) {
      expect(markup).not.toContain(marketplaceSentinel)
      expect(markup).not.toContain(pluginSentinel)
      expect(markup).toContain(PRIVATE_PLUGIN_PRESENTATION_VALUE)
    }
  })
})
