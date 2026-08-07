import { describe, expect, it, vi } from 'vitest'

import { listPluginSnapshot } from '#~/plugins/api'
import { parsePublicJsonValue } from '#~/plugins/plugin-public-api-generic'
import { createPublicParseState } from '#~/plugins/plugin-public-api-values'

const apiMocks = vi.hoisted(() => ({
  fetchApiJson: vi.fn(),
  fetchApiResponse: vi.fn()
}))

vi.mock('#~/api/base', () => ({
  buildApiUrl: (path: string) => path,
  ...apiMocks
}))

const snapshotFromContributions = async (contributions: Record<string, unknown>) => {
  apiMocks.fetchApiResponse.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        plugins: [{ contributions, requestId: 'contributions', scope: 'contributions' }]
      }),
      { status: 200 }
    )
  )
  return listPluginSnapshot()
}

describe('public plugin contribution projection', () => {
  it('preserves every declared non-CLI contribution shape and intentional extension metadata', async () => {
    const contributions = {
      chatHeaderActions: [{ command: 'chat', icon: 'chat', id: 'chat', title: 'Chat' }],
      chatHeaderMoreMenu: [{
        children: [{ id: 'child', title: 'Child' }],
        id: 'chat-more',
        title: 'More'
      }],
      chatInteractionPanelEmptyActions: [{ id: 'empty', shortcut: 'E', title: 'Empty' }],
      extensionContributions: [{
        customMetadata: { mode: 'safe' },
        id: 'consumer',
        target: 'owner/point',
        title: { en: 'Consumer' }
      }],
      extensionPoints: [{
        contributionSchema: { type: 'object' },
        id: 'point',
        title: { en: 'Point' }
      }],
      launcherSearchProviders: [{ command: 'search', id: 'search', title: 'Search' }],
      navFooterBefore: [{
        accountPopover: {
          accounts: [{
            actions: [{ id: 'sign-out', title: 'Sign out' }],
            id: 'account',
            name: 'Account'
          }],
          actions: [{ id: 'add', title: 'Add' }],
          groups: [{ accounts: [], id: 'group', title: 'Group' }]
        },
        id: 'account',
        title: 'Account'
      }],
      navItems: [{
        descriptionI18n: { en: 'Navigation' },
        id: 'nav',
        payload: { mode: 'safe' },
        title: 'Navigation'
      }],
      navMoreMenu: [{ danger: true, id: 'nav-more', title: 'More' }],
      roles: ['manager'],
      routeHeaderActions: [{
        active: true,
        activeIcon: 'check',
        command: 'toggle',
        id: 'toggle',
        targetRoutes: ['/plugins/*'],
        title: 'Toggle'
      }],
      routeMoreMenu: [{ active: true, id: 'legacy-more', targetRoute: 'plugins', title: 'Legacy' }],
      routeMoreMenuItems: [{ id: 'route-more', selected: true, title: 'Route more' }],
      routes: [{ clientView: 'home', icon: 'home', id: 'home', routeId: 'plugin-home', title: 'Home' }],
      routeSidebarContextMenu: [{ disabled: true, id: 'context', title: 'Context' }],
      routeWindowBarActions: [{ command: 'window', id: 'window', title: 'Window' }],
      sessionGroups: [{
        actions: [{
          createSession: { tags: ['relay'], title: 'Relay session' },
          id: 'create',
          title: 'Create'
        }],
        id: 'relay',
        match: {
          anyOf: [{ accounts: ['work'] }],
          tags: ['relay']
        },
        showWhenEmpty: true,
        title: 'Relay'
      }],
      settingsPages: [{
        group: 'external-control',
        id: 'settings',
        schema: { type: 'object' },
        title: 'Settings',
        uiSchema: { mode: 'form' }
      }],
      surfaces: ['launcher'],
      toolUsePresentations: [{
        id: 'tool',
        input: {
          fields: [{
            format: 'records',
            item: { detailPath: 'detail', titlePath: 'title' },
            path: 'items',
            title: 'Items'
          }],
          mode: 'declared'
        },
        result: {
          fields: [{ path: 'result', title: 'Result' }],
          format: 'json',
          mode: 'declared'
        },
        title: 'Tool',
        tools: ['run']
      }],
      usageSources: [{
        command: 'usage.collect',
        description: 'Collect usage',
        id: 'usage',
        kind: 'collector',
        title: 'Usage'
      }],
      workbenchAddMenu: [{ id: 'add-tab', tab: 'tab', title: 'Add tab' }],
      workbenchTabs: [{ clientView: 'tab', id: 'tab', placement: 'right', title: 'Tab' }],
      workspaceDrawerTabs: [{ clientView: 'drawer', id: 'drawer', placement: 'bottom', title: 'Drawer' }]
    }

    const snapshot = await snapshotFromContributions(contributions)

    expect(snapshot.plugins[0]?.contributions).toEqual(contributions)
  })

  it('rejects undeclared fields instead of copying them into public contribution entries', async () => {
    const snapshot = await snapshotFromContributions({
      routes: [{
        id: 'unsafe',
        title: 'Unsafe',
        unknownPrivateMetadata: '/private/unknown'
      }]
    })

    expect(snapshot.plugins).toEqual([{
      requestId: 'contributions',
      scope: 'contributions'
    }])
    expect(JSON.stringify(snapshot.plugins)).not.toContain('/private/')
  })

  it('rejects undeclared private metadata in usage sources', async () => {
    const snapshot = await snapshotFromContributions({
      usageSources: [{
        command: 'usage.collect',
        id: 'usage',
        title: 'Usage',
        unknownPrivateMetadata: '/private/usage'
      }]
    })

    expect(snapshot.plugins).toEqual([{
      requestId: 'contributions',
      scope: 'contributions'
    }])
    expect(JSON.stringify(snapshot.plugins)).not.toContain('/private/')
  })

  it('fails closed for prototype-control keys and rebuilds safe extensible JSON graphs', async () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const value = JSON.parse(`{"${key}":{"polluted":true},"safe":{"nested":true}}`) as unknown
      expect(parsePublicJsonValue(value, createPublicParseState())).toBeUndefined()
    }

    const safe = parsePublicJsonValue(
      JSON.parse('{"custom":{"nested":true},"items":[{"id":"one"}]}') as unknown,
      createPublicParseState()
    ) as Record<string, unknown>
    expect(safe).toEqual({
      custom: { nested: true },
      items: [{ id: 'one' }]
    })
    expect(Object.getPrototypeOf(safe)).toBeNull()
    expect(Object.getPrototypeOf(safe.custom as object)).toBeNull()
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('rejects prototype-control keys inside intentionally extensible contributions', async () => {
    const contributions = JSON.parse(
      '{"extensionContributions":[{"id":"consumer","target":"owner/point","__proto__":{"polluted":true}}]}'
    ) as Record<string, unknown>

    const snapshot = await snapshotFromContributions(contributions)

    expect(snapshot.plugins).toEqual([{
      requestId: 'contributions',
      scope: 'contributions'
    }])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
})
