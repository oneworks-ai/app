/* eslint-disable max-lines -- plugin host registry coverage keeps shared setup and runtime contract cases together. */
import { describe, expect, it, vi } from 'vitest'

import { mergeRouteMoreMenuOverrides, mergeRouteWindowBarOverrides } from '#~/components/layout/route-sidebar-context'
import { getPluginContributions } from '#~/components/plugins/PluginDetailSections'
import { resolvePluginReadmeAssetPath } from '#~/components/plugins/plugin-readme-links'
import i18n from '#~/i18n'
import { createPluginI18nContext, localizePluginContributionItem } from '#~/plugins/plugin-i18n'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'
import { PluginRegistry } from '#~/plugins/plugin-registry'
import { activatePluginClient } from '#~/plugins/plugin-runtime'
import {
  buildRoutePluginSidebarContextMenu,
  resolveRouteContributionText,
  routeTargetMatches
} from '#~/plugins/route-plugin-chrome'

const encodeModule = (source: string) => `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`

describe('client plugin host registry', () => {
  it('loads manifest contributions with scoped slot ids', () => {
    const registry = new PluginRegistry()

    registry.setInstances([{
      requestId: 'demo',
      scope: 'demo',
      plugin: {
        contributions: {
          extensionPoints: [{ id: 'quick-actions', title: 'Quick actions' }],
          extensionContributions: [{
            id: 'quick-action-addon',
            target: 'demo/quick-actions',
            title: 'Quick action add-on'
          }],
          navItems: [{ id: 'dashboard', title: 'Dashboard', icon: 'dashboard', route: '/plugins/demo/dashboard' }],
          navFooterBefore: [{
            icon: 'route',
            id: 'footer-status',
            route: '/plugins/demo/status',
            title: 'Footer status'
          }],
          sessionGroups: [{
            actions: [{
              createSession: {
                tags: ['ow:plugin:demo:server:local']
              },
              icon: 'add',
              id: 'new-session',
              title: 'New session'
            }],
            icon: 'hub',
            id: 'local-relay',
            match: {
              tags: ['ow:plugin:demo:server:local']
            },
            showWhenEmpty: true,
            title: 'Local Relay'
          }],
          chatInteractionPanelEmptyActions: [{
            command: 'create-empty-card',
            icon: 'dashboard_customize',
            id: 'empty-card',
            shortcut: 'mod+shift+n',
            title: 'Create card'
          }],
          routeHeaderActions: [{
            active: true,
            activeIcon: 'check_circle',
            activeLabel: 'Marked',
            command: 'mark',
            danger: true,
            disabled: true,
            id: 'mark',
            shortcut: 'mod+m',
            targetRoute: 'requests',
            title: 'Mark',
            titleI18n: { zh: '标记' }
          }],
          routeMoreMenuItems: [{
            command: 'follow-up',
            id: 'follow-up',
            targetRoutes: ['requests', '/ui/__interaction-structure/requests'],
            title: 'Follow up'
          }],
          routeSidebarContextMenu: [{
            id: 'hide-entry',
            route: '/plugins/demo/hide-entry',
            targetRoute: 'requests',
            title: 'Hide entry'
          }],
          routeWindowBarActions: [{
            active: true,
            activeIcon: 'keep',
            command: 'pin',
            danger: true,
            id: 'pin',
            targetRoute: 'requests',
            title: 'Pin'
          }],
          workbenchAddMenu: [{ id: 'demo', title: 'Demo', icon: 'layers', tab: 'bottom' }],
          workbenchTabs: [{ id: 'bottom', title: 'Bottom', clientView: 'bottom-view' }],
          workspaceDrawerTabs: [{ id: 'right', title: 'Right', clientView: 'right-view' }]
        }
      }
    }])

    const snapshot = registry.getSnapshot()
    expect(snapshot.extensionPoints[0]).toMatchObject({
      id: 'quick-actions',
      pluginScope: 'demo',
      title: 'Quick actions'
    })
    expect(snapshot.extensionContributions['demo/quick-actions']?.[0]).toMatchObject({
      extensionPoint: 'demo/quick-actions',
      id: 'quick-action-addon',
      pluginScope: 'demo',
      target: 'demo/quick-actions',
      title: 'Quick action add-on'
    })
    expect(snapshot.slots['nav.items']?.[0]).toMatchObject({
      id: 'dashboard',
      pluginScope: 'demo'
    })
    expect(snapshot.slots['nav.footer.before']?.[0]).toMatchObject({
      id: 'footer-status',
      pluginScope: 'demo',
      route: '/plugins/demo/status'
    })
    expect(snapshot.slots['sessions.groups']?.[0]).toMatchObject({
      id: 'local-relay',
      pluginScope: 'demo',
      match: {
        tags: ['ow:plugin:demo:server:local']
      },
      actions: [
        expect.objectContaining({
          id: 'new-session',
          createSession: {
            tags: ['ow:plugin:demo:server:local']
          }
        })
      ]
    })
    expect(snapshot.slots['workbench.addMenu']?.[0]).toMatchObject({
      id: 'demo',
      tab: 'bottom',
      pluginScope: 'demo'
    })
    expect(snapshot.slots['chat.interactionPanel.emptyActions']?.[0]).toMatchObject({
      id: 'empty-card',
      pluginScope: 'demo',
      shortcut: 'mod+shift+n'
    })
    expect(snapshot.slots['route.header.actions']?.[0]).toMatchObject({
      id: 'mark',
      pluginScope: 'demo',
      active: true,
      activeIcon: 'check_circle',
      activeLabel: 'Marked',
      danger: true,
      disabled: true,
      shortcut: 'mod+m',
      targetRoute: 'requests'
    })
    expect(snapshot.slots['route.moreMenu.items']?.[0]).toMatchObject({
      id: 'follow-up',
      pluginScope: 'demo',
      targetRoutes: ['requests', '/ui/__interaction-structure/requests']
    })
    expect(snapshot.slots['route.sidebar.contextMenu']?.[0]).toMatchObject({
      id: 'hide-entry',
      pluginScope: 'demo',
      route: '/plugins/demo/hide-entry'
    })
    expect(snapshot.slots['route.windowBar.actions']?.[0]).toMatchObject({
      id: 'pin',
      pluginScope: 'demo',
      active: true,
      activeIcon: 'keep',
      danger: true,
      targetRoute: 'requests'
    })
    expect(snapshot.slots['workbench.tabs']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'bottom', pluginScope: 'demo' }),
        expect.objectContaining({ id: 'right', placement: 'right', pluginScope: 'demo' })
      ])
    )
  })

  it('canonicalizes legacy route more menu manifest contributions', () => {
    const registry = new PluginRegistry()

    registry.setInstances([
      {
        requestId: 'legacy-route-menu',
        scope: 'legacy-route-menu',
        plugin: {
          contributions: {
            routeMoreMenu: [{ id: 'legacy-menu', title: 'Legacy route menu' }]
          }
        }
      },
      {
        requestId: 'canonical-route-menu',
        scope: 'canonical-route-menu',
        plugin: {
          contributions: {
            routeMoreMenu: [{ id: 'ignored-legacy-menu', title: 'Ignored legacy route menu' }],
            routeMoreMenuItems: [{ id: 'canonical-menu', title: 'Canonical route menu' }]
          }
        }
      }
    ])

    const items = registry.getSnapshot().slots['route.moreMenu.items'] ?? []
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'legacy-menu',
        pluginScope: 'legacy-route-menu',
        title: 'Legacy route menu'
      }),
      expect.objectContaining({
        id: 'canonical-menu',
        pluginScope: 'canonical-route-menu',
        title: 'Canonical route menu'
      })
    ]))
    expect(items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ignored-legacy-menu',
        pluginScope: 'canonical-route-menu'
      })
    ]))
  })

  it('merges route-owned chrome overrides with plugin-provided route chrome', () => {
    expect(mergeRouteWindowBarOverrides({
      plugin: {
        actions: [{ icon: 'extension', key: 'plugin-action', label: 'Plugin' }],
        key: 'plugin'
      },
      route: {
        actions: [{ icon: 'add', key: 'route-action', label: 'Route' }],
        key: 'route'
      }
    })).toMatchObject({
      actions: [
        { key: 'plugin-action' },
        { key: 'route-action' }
      ],
      key: 'plugin|route'
    })

    const mergedMenu = mergeRouteMoreMenuOverrides({
      plugin: {
        contextMenuSections: [{ items: [{ key: 'plugin-context', label: 'Plugin context' }], key: 'plugin-context' }],
        key: 'plugin',
        sections: [{ items: [{ key: 'plugin-menu', label: 'Plugin menu' }], key: 'plugin-section' }],
        selectedKeys: ['plugin-menu']
      },
      route: {
        contextMenuSections: [{ items: [{ key: 'route-context', label: 'Route context' }], key: 'route-context' }],
        key: 'route',
        sections: [{ items: [{ key: 'route-menu', label: 'Route menu' }], key: 'route-section' }],
        selectedKeys: ['route-menu', 'plugin-menu']
      }
    })

    expect(mergedMenu?.sections.map(section => section.key)).toEqual(['plugin-section', 'route-section'])
    expect(mergedMenu?.contextMenuSections?.map(section => section.key)).toEqual(['plugin-context', 'route-context'])
    expect(mergedMenu?.selectedKeys).toEqual(['plugin-menu', 'route-menu'])
  })

  it('matches route contribution targets by route key, pathname, and wildcard path', () => {
    expect(routeTargetMatches({
      contribution: { targetRoute: 'requests' },
      pathname: '/__interaction-structure/requests',
      routeKey: 'requests'
    })).toBe(true)
    expect(routeTargetMatches({
      contribution: { targetRoute: '/ui/__interaction-structure/requests' },
      pathname: '/__interaction-structure/requests',
      routeKey: 'requests'
    })).toBe(true)
    expect(routeTargetMatches({
      contribution: { targetRoute: '/__interaction-structure/requests' },
      pathname: '/ui/__interaction-structure/requests',
      routeKey: 'requests'
    })).toBe(true)
    expect(routeTargetMatches({
      contribution: { targetRoutes: ['/ui/__interaction-structure/*'] },
      pathname: '/__interaction-structure/requests',
      routeKey: 'requests'
    })).toBe(true)
    expect(routeTargetMatches({
      contribution: { targetRoute: 'settings' },
      pathname: '/config',
      routeKey: 'config'
    })).toBe(true)
    expect(routeTargetMatches({
      contribution: { targetRoute: 'config' },
      pathname: '/config',
      routeKey: 'settings'
    })).toBe(true)
    expect(routeTargetMatches({
      contribution: { targetRoute: '/ui/config' },
      pathname: '/config',
      routeKey: 'config'
    })).toBe(true)
    expect(routeTargetMatches({
      contribution: { targetRoutes: ['/ui/plugins/*'] },
      pathname: '/plugins/demo',
      routeKey: 'plugins'
    })).toBe(true)
    expect(routeTargetMatches({
      contribution: { targetRoute: '/plugins/demo/home' },
      pathname: '/plugins/demo/home',
      routeKey: 'plugin-route'
    })).toBe(true)
    expect(routeTargetMatches({
      contribution: { targetRoute: '/plugins/demo/home' },
      pathname: '/plugins/relay/home',
      routeKey: 'plugin-route'
    })).toBe(false)
    expect(routeTargetMatches({
      contribution: { targetRoute: 'operations' },
      pathname: '/__interaction-structure/requests',
      routeKey: 'requests'
    })).toBe(false)
  })

  it('builds route sidebar context menu state with selected keys and shortcuts', () => {
    const onRun = vi.fn()
    const contextMenu = buildRoutePluginSidebarContextMenu({
      contributions: [{
        command: 'hide',
        id: 'hide-entry',
        pluginScope: 'demo',
        selected: true,
        shortcut: 'mod+k',
        targetRoute: 'requests',
        title: 'Hide entry'
      }],
      isMac: true,
      language: 'en',
      pathname: '/ui/__interaction-structure/requests',
      routeKey: 'requests',
      target: { groupKey: 'group-a', itemKey: 'item-a', kind: 'item' },
      onRun
    })

    expect(Array.isArray(contextMenu)).toBe(false)
    if (Array.isArray(contextMenu)) return

    expect(contextMenu.selectedKeys).toEqual(['plugin:demo:hide-entry'])
    const firstItem = contextMenu.items[0] as { key?: string; label?: unknown }
    expect(firstItem).toMatchObject({
      key: 'plugin:demo:hide-entry'
    })
    expect(typeof firstItem.label).not.toBe('string')
    ;(firstItem as { onClick?: () => void }).onClick?.()
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'hide', id: 'hide-entry' }),
      {
        kind: 'routeSidebarContextMenu',
        pathname: '/ui/__interaction-structure/requests',
        routeKey: 'requests',
        target: { groupKey: 'group-a', itemKey: 'item-a', kind: 'item' }
      }
    )
  })

  it('resolves route contribution text from current language candidates', () => {
    const contribution = {
      description: 'Default description',
      i18n: {
        'zh-CN': { description: '中文说明' }
      },
      title: 'Default title',
      titleI18n: {
        en: 'English title',
        'zh-Hans': '中文标题'
      }
    }

    expect(resolveRouteContributionText(contribution, 'title', 'zh')).toBe('中文标题')
    expect(resolveRouteContributionText(contribution, 'title', 'zh-CN')).toBe('中文标题')
    expect(resolveRouteContributionText(contribution, 'description', 'zh-CN')).toBe('中文说明')
    expect(resolveRouteContributionText(contribution, 'title', 'en-US')).toBe('English title')
  })

  it('resolves plugin detail contributions from runtime, legacy, and manifest shapes', () => {
    const runtimeContributions = { routes: [{ id: 'runtime', clientView: 'runtime-view' }] }
    const legacyContributions = { navItems: [{ id: 'legacy', title: 'Legacy' }] }
    const manifestContributions = { workbenchTabs: [{ id: 'manifest', title: 'Manifest' }] }

    expect(getPluginContributions({
      contributions: legacyContributions,
      manifest: { plugin: { contributions: manifestContributions } },
      plugin: { contributions: runtimeContributions },
      requestId: 'demo',
      scope: 'demo'
    })).toBe(runtimeContributions)
    expect(getPluginContributions({
      contributions: legacyContributions,
      requestId: 'legacy',
      scope: 'legacy'
    })).toBe(legacyContributions)
    expect(getPluginContributions({
      manifest: { plugin: { contributions: manifestContributions } },
      requestId: 'manifest',
      scope: 'manifest'
    })).toBe(manifestContributions)
    expect(
      getPluginContributions({
        requestId: 'route-menu-alias',
        scope: 'route-menu-alias',
        plugin: {
          contributions: {
            routeMoreMenu: [{ id: 'legacy-menu', title: 'Legacy route menu' }]
          }
        }
      }).routeMoreMenuItems
    ).toEqual([{ id: 'legacy-menu', title: 'Legacy route menu' }])
  })

  it('resolves plugin README relative asset paths without external URLs', () => {
    expect(resolvePluginReadmeAssetPath('README.md', 'assets/logo.svg')).toBe('assets/logo.svg')
    expect(resolvePluginReadmeAssetPath('docs/README.md', '../assets/logo.svg')).toBe('assets/logo.svg')
    expect(resolvePluginReadmeAssetPath('docs/README.md', '/media/cover.png')).toBe('media/cover.png')
    expect(resolvePluginReadmeAssetPath('README.md', '#setup')).toBeUndefined()
    expect(resolvePluginReadmeAssetPath('README.md', 'https://example.com/logo.svg')).toBeUndefined()
  })

  it('reports duplicate scoped registrations clearly', () => {
    const registry = new PluginRegistry()

    registry.registerCommand('demo', 'run', () => 'first')
    registry.registerCommand('demo', 'run', () => 'second')
    registry.registerSlot('demo', 'nav.items', { id: 'dash', title: 'Dash' })
    registry.registerSlot('demo', 'nav.items', { id: 'dash', title: 'Dash Duplicate' })

    expect(registry.getSnapshot().diagnostics.map(item => item.message)).toEqual([
      'Duplicate plugin command registration "demo/run" in scope "demo".',
      'Duplicate plugin slot nav.items registration "demo/dash" in scope "demo".'
    ])
  })

  it('disposes one plugin scope without touching another scope', async () => {
    const registry = new PluginRegistry()
    const first = registry.registerCommand('one', 'ping', () => 'one')
    registry.registerCommand('two', 'ping', () => 'two')

    first.dispose()

    await expect(registry.executeCommand('two', 'ping')).resolves.toBe('two')
  })

  it('runs extension point listeners when the target point becomes available', async () => {
    const registry = new PluginRegistry()
    const listener = vi.fn(point =>
      registry.contributeExtensionPoint('addon', 'demo/actions', {
        id: 'late-action',
        pointTitle: point.title,
        title: 'Late action'
      })
    )

    registry.onExtensionPointAvailable('addon', 'demo/actions', listener)

    expect(listener).not.toHaveBeenCalled()
    expect(registry.getSnapshot().extensionContributions['demo/actions']).toBeUndefined()

    const point = registry.registerExtensionPoint('demo', {
      id: 'actions',
      title: 'Actions'
    })

    await Promise.resolve()

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      id: 'actions',
      pluginScope: 'demo',
      title: 'Actions'
    }))
    expect(registry.getSnapshot().extensionContributions['demo/actions']?.[0]).toMatchObject({
      extensionPoint: 'demo/actions',
      id: 'late-action',
      pluginScope: 'addon',
      pointTitle: 'Actions'
    })

    point.dispose()

    expect(registry.getSnapshot().extensionContributions['demo/actions']).toEqual([])
  })

  it('keeps manifest extension contributions pending until dynamic points register', async () => {
    const registry = new PluginRegistry()

    registry.setInstances([{
      requestId: 'addon',
      scope: 'addon',
      plugin: {
        contributions: {
          extensionContributions: [{
            id: 'manifest-action',
            target: 'demo/actions',
            title: 'Manifest action'
          }]
        }
      }
    }])

    expect(registry.getSnapshot().extensionContributions['demo/actions']).toBeUndefined()

    registry.registerExtensionPoint('demo', { id: 'actions', title: 'Actions' })
    await Promise.resolve()

    expect(registry.getSnapshot().extensionContributions['demo/actions']?.[0]).toMatchObject({
      extensionPoint: 'demo/actions',
      id: 'manifest-action',
      pluginScope: 'addon',
      title: 'Manifest action'
    })
  })

  it('waits for plugin APIs before resolving cross-plugin calls', async () => {
    const registry = new PluginRegistry()
    const pending = registry.callPluginApi('addon', 'demo/describe', { from: 'addon' })

    registry.registerPluginApi('demo', {
      handler: (input, meta) => ({ input, meta }),
      id: 'describe',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      title: 'Describe'
    })

    await expect(pending).resolves.toEqual({
      input: { from: 'addon' },
      meta: {
        apiId: 'describe',
        callerScope: 'addon',
        targetScope: 'demo'
      }
    })
    expect(registry.getSnapshot().pluginApis).toEqual([
      expect.objectContaining({
        id: 'describe',
        pluginScope: 'demo',
        title: 'Describe'
      })
    ])
  })

  it('activates client entries and cleans scoped runtime registrations on reload', async () => {
    const registry = new PluginRegistry()
    const instance: PluginRuntimeInstance = {
      requestId: 'demo',
      scope: 'demo',
      clientEntryUrl: encodeModule(`
        export function activatePlugin(ctx) {
          ctx.commands.register('hello', () => 'world')
          ctx.commands.register('call-api', payload => ctx.pluginApis.call('describe', payload))
          ctx.pluginApis.register({
            id: 'describe',
            title: 'Describe',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            handler: (input, meta) => ({ input, meta })
          })
          ctx.slots.register('chat.header.actions', { id: 'snap', title: 'Snapshot' })
          ctx.routes.register({ id: 'panel', viewId: 'panel-view' })
          ctx.extensionPoints.register({ id: 'actions', title: 'Actions' })
          ctx.extensionPoints.onAvailable('actions', () =>
            ctx.extensionPoints.contribute('actions', { id: 'extra-action', title: 'Extra action' })
          )
          ctx.views.register('panel-view', (container) => {
            container.textContent = 'plugin view'
          })
          ctx.views.register('node-view', {
            renderNode: (view) => ctx.react.createElement(view.ui.Icon, { name: 'extension' })
          })
        }
      `)
    }

    await activatePluginClient({
      getImportVersion: () => 0,
      instance,
      registry,
      reloadPlugin: vi.fn()
    })

    await expect(registry.executeCommand('demo', 'hello')).resolves.toBe('world')
    await expect(registry.executeCommand('demo', 'call-api', { ok: true })).resolves.toEqual({
      input: { ok: true },
      meta: {
        apiId: 'describe',
        callerScope: 'demo',
        targetScope: 'demo'
      }
    })
    expect(registry.findRoute('demo', 'panel')).toMatchObject({ viewId: 'panel-view' })
    const nodeView = registry.findView('demo', 'node-view')
    expect(nodeView?.renderNode).toEqual(expect.any(Function))
    expect(nodeView?.renderNode?.({ ui: { Icon: 'span' } } as never)).toMatchObject({
      props: { name: 'extension' },
      type: 'span'
    })
    expect(registry.getSnapshot().slots['chat.header.actions']?.[0]).toMatchObject({
      id: 'snap',
      pluginScope: 'demo'
    })
    expect(registry.getSnapshot().extensionPoints[0]).toMatchObject({
      id: 'actions',
      pluginScope: 'demo'
    })
    expect(registry.getSnapshot().extensionContributions['demo/actions']?.[0]).toMatchObject({
      extensionPoint: 'demo/actions',
      id: 'extra-action',
      pluginScope: 'demo',
      title: 'Extra action'
    })
    expect(registry.getSnapshot().pluginApis[0]).toMatchObject({
      id: 'describe',
      pluginScope: 'demo',
      title: 'Describe'
    })

    registry.disposeScope('demo')

    expect(registry.findRoute('demo', 'panel')).toBeUndefined()
    expect(registry.getSnapshot().slots['chat.header.actions']).toEqual([])
    expect(registry.getSnapshot().extensionPoints).toEqual([])
    expect(registry.getSnapshot().extensionContributions['demo/actions']).toBeUndefined()
    expect(registry.getSnapshot().pluginApis).toEqual([])
  })

  it('rejects plugin api.fetch paths that try to leave the scoped proxy', async () => {
    const registry = new PluginRegistry()
    const instance: PluginRuntimeInstance = {
      requestId: 'demo',
      scope: 'demo',
      clientEntryUrl: encodeModule(`
        export function activatePlugin(ctx) {
          ctx.commands.register('check', async () => {
            try {
              await ctx.api.fetch('../config')
              return 'allowed'
            } catch (error) {
              return error.message
            }
          })
        }
      `)
    }

    await activatePluginClient({
      getImportVersion: () => 0,
      instance,
      registry,
      reloadPlugin: vi.fn()
    })

    await expect(registry.executeCommand('demo', 'check')).resolves.toContain(
      'only accepts scoped relative paths'
    )
  })

  it('injects plugin source when plugin client publishes host notifications', async () => {
    const registry = new PluginRegistry()
    const show = vi.fn(() => ({ close: vi.fn(), id: 'notice-1' }))
    const instance: PluginRuntimeInstance = {
      displayName: 'Demo Plugin',
      name: '@local/demo',
      requestId: 'demo',
      scope: 'demo',
      clientEntryUrl: encodeModule(`
        export function activatePlugin(ctx) {
          ctx.notifications.show({
            title: 'Done',
            description: '**Finished**',
            actions: [{ id: 'open', title: 'Open' }]
          })
        }
      `)
    }

    await activatePluginClient({
      getImportVersion: () => 0,
      instance,
      notifications: {
        close: vi.fn(),
        isSourceMuted: vi.fn(() => false),
        muteSource: vi.fn(),
        show,
        unmuteSource: vi.fn()
      },
      registry,
      reloadPlugin: vi.fn()
    })

    expect(show).toHaveBeenCalledWith({
      actions: [{ id: 'open', title: 'Open' }],
      description: '**Finished**',
      source: {
        icon: 'extension',
        kind: 'plugin',
        name: '@local/demo',
        scope: 'demo',
        title: 'Demo Plugin'
      },
      title: 'Done'
    })
  })

  it('exposes host language and localized text helpers to client plugins', async () => {
    await i18n.changeLanguage('en')
    const registry = new PluginRegistry()
    const instance: PluginRuntimeInstance = {
      requestId: 'demo',
      scope: 'demo',
      clientEntryUrl: encodeModule(`
        export function activatePlugin(ctx) {
          let changes = 0
          const languageSubscription = ctx.i18n.subscribe(() => {
            changes += 1
          })
          ctx.commands.register('language', () => ({
            changes,
            greeting: ctx.i18n.t({ en: 'Hello {{name}}', 'zh-Hans': '你好 {{name}}' }, { name: 'Plugin' }),
            language: ctx.i18n.language,
            selected: ctx.i18n.select({ en: 'English value', 'zh-Hans': '中文值' })
          }))
          return {
            dispose() {
              languageSubscription.dispose()
            }
          }
        }
      `)
    }

    await activatePluginClient({
      getImportVersion: () => 0,
      instance,
      registry,
      reloadPlugin: vi.fn()
    })

    await expect(registry.executeCommand('demo', 'language')).resolves.toMatchObject({
      greeting: 'Hello Plugin',
      language: 'en',
      selected: 'English value'
    })

    await i18n.changeLanguage('zh')

    await expect(registry.executeCommand('demo', 'language')).resolves.toMatchObject({
      greeting: '你好 Plugin',
      language: 'zh',
      selected: '中文值'
    })
  })

  it('localizes plugin contribution fields through host i18n helpers', async () => {
    await i18n.changeLanguage('zh')

    expect(
      localizePluginContributionItem({
        description: 'Open the plugin page',
        descriptionI18n: {
          en: 'Open the plugin page',
          'zh-Hans': '打开插件页面'
        },
        id: 'home',
        title: 'Plugin Demo home',
        titleI18n: {
          en: 'Plugin Demo home',
          'zh-Hans': '插件 Demo 首页'
        }
      }, createPluginI18nContext())
    ).toMatchObject({
      description: '打开插件页面',
      title: '插件 Demo 首页'
    })

    await i18n.changeLanguage('en')
  })
})
