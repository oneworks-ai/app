// @vitest-environment happy-dom
import { App } from 'antd'
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { NativeHostPlugin, PluginMarketplaceCatalogPlugin, PluginRuntimeInstance } from '@oneworks/types'

import { MarketplaceCapabilityTags, MarketplaceCard } from '#~/components/marketplace/MarketplaceCard'
import { MarketplacePluginDetailPanel } from '#~/components/plugins/MarketplacePluginDetailPanel'
import { NativePluginDetailPanel } from '#~/components/plugins/NativePluginDetailPanel'
import { PluginAssetSection } from '#~/components/plugins/PluginAssetSection'
import { PluginConfigSection } from '#~/components/plugins/PluginConfigSection'
import { PluginDetailPanel } from '#~/components/plugins/PluginDetailPanel'
import { PluginRows } from '#~/components/plugins/PluginDetailSections'
import { PluginDiagnostics } from '#~/components/plugins/PluginDiagnostics'
import { buildMarketplaceCapabilityGroups } from '#~/components/plugins/PluginMarketplaceLanding'
import { PluginReadmeSection } from '#~/components/plugins/PluginReadmeSection'
import { PluginRuntimeListCard } from '#~/components/plugins/PluginRuntimeListCard'
import { PluginSettingsPage } from '#~/components/plugins/PluginSettingsPage'
import {
  buildPluginListItems,
  resolveNativePluginPresentationIcon
} from '#~/components/plugins/plugin-runtime-list-items'
import { NotificationCard } from '#~/notifications/NotificationCard'
import type { UiNotification } from '#~/notifications/notification-types'
import {
  projectPluginPresentationValue,
  resolveMarketplacePluginDescription,
  resolveMarketplacePluginDisplayName
} from '#~/plugins/plugin-presentation'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const testState = vi.hoisted(() => ({
  assets: [] as unknown[],
  instances: [] as PluginRuntimeInstance[]
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: 'en', resolvedLanguage: 'en' },
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
  })
}))

vi.mock('swr', () => ({
  default: () => ({ data: testState.assets, error: undefined, isLoading: false })
}))

vi.mock('#~/plugins/plugin-context', () => ({
  usePluginContext: () => ({
    pluginServerBaseUrl: 'https://workspace.example',
    refreshPlugins: vi.fn(),
    snapshot: { instances: testState.instances }
  })
}))

const renderProduction = (element: ReactElement) =>
  renderToStaticMarkup(
    <App>
      <MemoryRouter>{element}</MemoryRouter>
    </App>
  )

const configLabels = {
  instance: 'Instance',
  manifest: 'Manifest',
  noSchema: 'No schema',
  options: 'Options',
  saved: 'Saved',
  saveFailed: 'Save failed',
  saving: 'Saving'
}

describe('plugin public-envelope presentation boundary', () => {
  it('routes production card, detail, readme, config, list, diagnostic and notification surfaces through projection', () => {
    const sentinel = 'public-envelope-private-sentinel'
    const privatePath = `/${sentinel}/managed/plugin`
    const angleWrappedPrivatePath = `failed at </Users/${sentinel}/managed/plugin>; retry`
    const encodedFile = `file:%2F%2F%2F${sentinel}%2Ficon.svg`
    const encodedTraversal = `/plugins/%2e%2e/${sentinel}/icon.svg`
    const hostileAssetQuery = `/assets/plugin.svg?source=%3C%2F${sentinel}%2Fmanaged%3E`
    const hostileAssetFragment = `/plugins/plugin.svg#source=%3C%2F${sentinel}%2Fmanaged%3E`
    const safePublicAsset = '/assets/public-plugin-icon.svg'
    const marketplacePlugin = {
      agents: [privatePath, 'safe-agent'],
      commands: [privatePath, 'safe-command'],
      declared: true,
      description: `Safe description from ${privatePath}`,
      displayName: privatePath,
      enabled: true,
      icon: { kind: 'url', url: encodedFile },
      installable: true,
      marketplace: 'official',
      marketplaceEnabled: true,
      marketplaceTitle: privatePath,
      marketplaceType: 'codex',
      name: 'safe-plugin',
      skills: [privatePath, '中文技能'],
      sourceLabel: privatePath,
      sourceType: 'path',
      version: privatePath
    } satisfies PluginMarketplaceCatalogPlugin
    const runtimePlugin = {
      client: { devServer: privatePath, entry: privatePath },
      enabled: true,
      icon: hostileAssetQuery,
      manifest: {
        config: {
          schema: {
            properties: {
              root: { title: privatePath, type: 'string' }
            },
            type: 'object'
          }
        },
        displayName: privatePath,
        plugin: { server: { entry: privatePath, roles: [] } }
      },
      name: privatePath,
      options: { roots: ['before', privatePath, 'after'] },
      packageId: privatePath,
      pluginRoot: privatePath,
      requestId: privatePath,
      requestedVersion: privatePath,
      scope: 'safe-runtime',
      version: privatePath
    } satisfies PluginRuntimeInstance
    const nativePlugin = {
      adapter: privatePath,
      capabilities: {
        discover: 'available',
        disable: 'available',
        enable: 'available',
        import: 'unsupported',
        install: 'unsupported',
        uninstall: 'unsupported',
        update: 'unsupported'
      },
      description: `Native description ${privatePath}`,
      diagnostics: [{ code: 'private', level: 'error', message: `Failed at ${privatePath}` }],
      displayName: privatePath,
      icon: encodedFile,
      id: 'native-safe',
      marketplace: privatePath,
      name: 'native-safe',
      scope: 'project',
      source: { displayPath: privatePath, kind: 'managed' },
      state: 'enabled',
      version: privatePath
    } satisfies NativeHostPlugin
    const safeConfigPlugin = {
      enabled: true,
      manifest: {
        config: {
          schema: {
            properties: {
              ratio: { title: '中文设置', type: 'string' }
            },
            type: 'object'
          }
        }
      },
      options: { ratio: '1 / 2' },
      requestId: 'safe-config-runtime',
      scope: 'safe-config-runtime'
    } satisfies PluginRuntimeInstance
    const action = vi.fn()
    const notification = {
      actions: [{ icon: privatePath, id: 'open', onClick: action, title: `Open ${privatePath}` }],
      createdAt: 0,
      description: `Read [Guide](/docs/start.md), then ${privatePath}. ![bad](${encodedFile})`,
      descriptionFormat: 'markdown',
      id: 'notice',
      level: 'warning',
      source: { icon: privatePath, kind: 'plugin', scope: privatePath, title: privatePath },
      title: `Safe title ${privatePath}`
    } satisfies UiNotification

    const runtimeListItem = buildPluginListItems({
      language: 'en',
      nativePlugins: [nativePlugin],
      plugins: [runtimePlugin],
      serverBaseUrl: 'https://workspace.example'
    })
    const privateSettingsPage = {
      id: 'safe-settings',
      pluginConfig: true,
      pluginScope: runtimePlugin.scope,
      title: 'Safe settings'
    } as const
    const safeSettingsPage = {
      id: 'safe-config-settings',
      pluginConfig: true,
      pluginScope: safeConfigPlugin.scope,
      title: 'Safe config settings'
    } as const
    testState.instances = [runtimePlugin, safeConfigPlugin]

    const markup = [
      renderProduction(
        <MarketplaceCapabilityTags groups={buildMarketplaceCapabilityGroups(marketplacePlugin)} />
      ),
      renderProduction(
        <MarketplaceCard
          description={resolveMarketplacePluginDescription(marketplacePlugin)}
          icon={<span>extension</span>}
          title={resolveMarketplacePluginDisplayName(marketplacePlugin)}
          titleMeta={<span>{projectPluginPresentationValue(marketplacePlugin.version)}</span>}
        />
      ),
      renderProduction(<MarketplacePluginDetailPanel plugin={marketplacePlugin} />),
      renderProduction(<PluginConfigSection labels={configLabels} plugin={runtimePlugin} />),
      renderProduction(<PluginConfigSection labels={configLabels} plugin={safeConfigPlugin} />),
      renderProduction(<PluginSettingsPage page={privateSettingsPage} />),
      renderProduction(<PluginSettingsPage page={safeSettingsPage} />),
      renderProduction(
        <PluginReadmeSection
          emptyText='Empty'
          loading={false}
          pluginScope='safe-runtime'
          readme={{
            content: [
              '# Safe heading',
              '1 / 2',
              '<em>safe</em>',
              privatePath,
              `![bad](${encodedFile})`,
              `![escape](${encodedTraversal})`,
              `![query](${hostileAssetQuery})`,
              `![fragment](${hostileAssetFragment})`,
              `![public](${safePublicAsset})`
            ].join('\n\n'),
            path: 'docs/README.md'
          }}
          title='README'
        />
      ),
      renderProduction(
        <PluginAssetSection
          emptyText='Empty'
          group={{
            files: [{
              content: `Safe asset\n\n![bad](${encodedFile})\n\n${privatePath}`,
              contentKind: 'markdown',
              path: privatePath,
              size: 1
            }]
          }}
          loading={false}
          showHeading
          title='Assets'
        />
      ),
      ...runtimeListItem.map(item => renderProduction(<PluginRuntimeListCard item={item} onOpen={vi.fn()} />)),
      renderProduction(
        <PluginDiagnostics
          diagnostics={[
            { level: 'error', message: privatePath },
            { level: 'error', message: angleWrappedPrivatePath }
          ]}
          emptyText='Empty'
          title='Diagnostics'
        />
      ),
      renderProduction(<NativePluginDetailPanel plugin={nativePlugin} />),
      renderProduction(
        <NotificationCard
          index={0}
          isExiting={false}
          language='en'
          notification={notification}
          onClose={vi.fn()}
          onMuteSource={vi.fn()}
          onPauseAutoClose={vi.fn()}
          onResumeAutoClose={vi.fn()}
        />
      )
    ].join('\n')

    expect(markup).not.toContain(sentinel)
    expect(markup).not.toContain(encodedFile)
    expect(markup).not.toContain(encodedTraversal)
    expect(markup).not.toContain(hostileAssetQuery)
    expect(markup).not.toContain(hostileAssetFragment)
    expect(markup).not.toContain('%5Bprivate%5D')
    expect(markup).toContain('[private]')
    expect(markup).toContain('safe-plugin')
    expect(markup).toContain('native-safe')
    expect(markup).toContain('中文技能')
    expect(markup).toContain('1 / 2')
    expect(markup).toContain('Safe heading')
    expect(markup).toContain(safePublicAsset)
    expect(markup).toContain('&lt;em&gt;safe&lt;/em&gt;')
    expect(resolveNativePluginPresentationIcon(nativePlugin)).toEqual({ name: 'extension', type: 'material' })
  })

  it('fails closed before a non-plain config option can reach the production editor', () => {
    const sentinel = 'nonplain-options-private-sentinel'
    let getterCalled = false
    class NonPlainOptions {
      get value() {
        getterCalled = true
        return `/${sentinel}/managed/plugin`
      }
    }
    const plugin = {
      enabled: true,
      manifest: {
        config: {
          schema: {
            properties: { value: { title: 'Value', type: 'string' } },
            type: 'object'
          }
        }
      },
      options: new NonPlainOptions(),
      requestId: 'nonplain-config-runtime',
      scope: 'nonplain-config-runtime'
    } as unknown as PluginRuntimeInstance

    const markup = renderProduction(<PluginConfigSection labels={configLabels} plugin={plugin} />)

    expect(getterCalled).toBe(false)
    expect(markup).not.toContain('config-view__record-fields')
    expect(markup).not.toContain(sentinel)
    expect(markup).toContain('[private]')
    expect(markup).toContain(configLabels.noSchema)
  })

  it('projects a contribution fallback without changing its preference action identity', async () => {
    const sentinel = 'contribution-private-sentinel'
    const unsafeHref = `ssh://credential-user:secret@example.invalid/${sentinel}`
    const rawItemId = `extensionPoints:${unsafeHref}`
    const plugin = {
      contributions: { extensionPoints: [{ href: unsafeHref }] },
      enabled: true,
      requestId: 'safe-contribution-runtime',
      scope: 'safe-contribution-runtime'
    } as unknown as PluginRuntimeInstance
    const snapshot = {
      extensionContributions: {},
      extensionPoints: [],
      instances: [plugin],
      launcherProviders: [],
      pluginApis: [],
      routes: [],
      slots: {},
      views: []
    }

    const detailMarkup = renderToStaticMarkup(
      <App>
        <MemoryRouter initialEntries={['/?tab=contributions']}>
          <PluginDetailPanel
            plugin={plugin}
            snapshot={snapshot as unknown as Parameters<typeof PluginDetailPanel>[0]['snapshot']}
            onContributionPreferencesChange={vi.fn()}
            onOptionsChange={vi.fn()}
          />
        </MemoryRouter>
      </App>
    )
    expect(detailMarkup).not.toContain(sentinel)
    expect(detailMarkup).not.toContain('credential-user')
    expect(detailMarkup).not.toContain('secret')
    expect(detailMarkup).toContain('[private]')

    const onItemEnabledChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <App>
          <PluginRows
            emptyText='Empty'
            fieldLabels={{ href: 'Link' }}
            language='en'
            noDescriptionText='No description'
            noMatchesText='No matches'
            rows={[{
              icon: 'extension',
              id: 'extensionPoints',
              items: [{ id: rawItemId, value: { href: unsafeHref } }],
              title: 'Extensions'
            }]}
            searchPlaceholder='Search'
            title='Contributions'
            onItemEnabledChange={onItemEnabledChange}
          />
        </App>
      )
    })
    expect(container.textContent).not.toContain(sentinel)
    expect(container.textContent).not.toContain('credential-user')
    expect(container.textContent).not.toContain('secret')
    expect(container.textContent).toContain('[private]')
    const toggle = container.querySelector<HTMLButtonElement>('.plugin-detail-route__contribution-item-toggle button')
    expect(toggle).not.toBeNull()
    await act(async () => toggle?.click())
    expect(onItemEnabledChange).toHaveBeenCalledWith(rawItemId, false)
    await act(async () => root.unmount())
    container.remove()
  })
})
