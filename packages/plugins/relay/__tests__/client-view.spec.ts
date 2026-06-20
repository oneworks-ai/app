import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  activatePlugin,
  createRelayDeviceSessionGroupTag,
  createRelayDeviceSessionGroupTagPrefix,
  createRelaySessionGroupTag
} from '../src/client/index.js'

class FakeContainer {
  innerHTML = ''
  listeners = new Map<string, EventListener>()

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener)
  }

  removeEventListener(type: string, listener: EventListener) {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type)
    }
  }
}

const flushPromises = async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}

const createHostI18n = (language: 'en' | 'zh-Hans') => ({
  select: <T>(values: Partial<Record<string, T>>) => values[language] ?? values.en,
  subscribe: vi.fn(() => ({ dispose: vi.fn() }))
})

const installBrowser = (language = 'en') => {
  const location = new URL('http://127.0.0.1:5173/plugins/relay/home')
  location.searchParams.set('lang', language)
  vi.stubGlobal('window', {
    history: {
      replaceState: vi.fn()
    },
    location: {
      hash: location.hash,
      href: location.toString(),
      search: location.search
    },
    open: vi.fn()
  })
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({
      remove: vi.fn(),
      textContent: ''
    })),
    documentElement: {
      lang: language
    },
    head: {
      appendChild: vi.fn()
    }
  })
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem: vi.fn()
  })
  vi.stubGlobal('navigator', {
    language,
    languages: [language]
  })
}

const createClientHarness = async (
  apiFetch: ReturnType<typeof vi.fn>,
  i18n = createHostI18n('en'),
  options: Record<string, unknown> = {}
) => {
  let renderHome: ((container: HTMLElement) => { dispose: () => void } | void) | undefined
  const commands = new Map<string, (payload?: unknown) => unknown | Promise<unknown>>()
  const slots = new Map<string, Array<Record<string, unknown> & { id: string }>>()
  const cleanup = await activatePlugin({
    scope: 'relay',
    api: {
      fetch: apiFetch
    },
    commands: {
      register: vi.fn((commandId, handler) => {
        commands.set(commandId, handler)
        return { dispose: vi.fn() }
      })
    },
    i18n,
    options,
    slots: {
      register: vi.fn((slot, contribution) => {
        const values = slots.get(slot) ?? []
        values.push(contribution)
        slots.set(slot, values)
        return { dispose: vi.fn() }
      })
    },
    views: {
      register: vi.fn((viewId: string, renderer: typeof renderHome) => {
        if (viewId === 'home') renderHome = renderer
        return { dispose: vi.fn() }
      })
    }
  })
  expect(renderHome).toBeDefined()
  return {
    commands,
    cleanup,
    renderHome: renderHome as (container: HTMLElement) => { dispose: () => void } | void,
    slots
  }
}

const statusPayload = {
  connection: {
    activeServerId: 'local',
    remoteBaseUrl: 'http://127.0.0.1:48888',
    state: 'registered'
  },
  device: {
    hasToken: true,
    id: 'device-1',
    name: 'Mac UI Check'
  },
  servers: [{
    active: true,
    account: {
      email: 'owner@local.test'
    },
    hasToken: true,
    id: 'local',
    name: 'Local Relay SSO',
    platform: 'Cloudflare',
    sessionAuthenticated: true,
    sessionExpiresAt: '2999-01-01T00:00:00.000Z',
    devices: [{
      capabilities: {
        sessions: true,
        terminal: true,
        workspaceFiles: false
      },
      id: 'device-1',
      name: 'Office Mac',
      status: 'online'
    }, {
      capabilities: {
        sessions: true
      },
      id: 'device-2',
      name: 'Lab Linux',
      status: 'offline'
    }],
    registeredAt: '2026-05-29T16:26:48.563Z',
    remoteBaseUrl: 'http://127.0.0.1:48888'
  }]
}

const statusResponse = (payload: Record<string, unknown> = statusPayload) =>
  new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status: 200
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay plugin client view', () => {
  it('registers session groups for known relay devices', async () => {
    installBrowser()
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/status') return statusResponse()
      return new Response('{}', { status: 404 })
    })
    const { cleanup, slots } = await createClientHarness(apiFetch, createHostI18n('zh-Hans'), {
      servers: [{
        id: 'local',
        name: 'Local Relay SSO',
        protocol: 'http',
        server: '127.0.0.1',
        port: 48888
      }]
    })
    const serverTag = createRelaySessionGroupTag('relay', 'local')
    const currentDeviceTag = createRelayDeviceSessionGroupTag('relay', 'local', 'device-1')
    const otherDeviceTag = createRelayDeviceSessionGroupTag('relay', 'local', 'device-2')

    expect(slots.get('sessions.groups')).toEqual([
      expect.objectContaining({
        id: 'device-local-device-1',
        title: 'Office Mac',
        icon: 'computer',
        match: {
          anyOf: [
            { tags: [currentDeviceTag] },
            {
              excludedTagPrefixes: [createRelayDeviceSessionGroupTagPrefix('relay', 'local')],
              tags: [serverTag]
            }
          ]
        },
        showWhenEmpty: true,
        actions: [
          expect.objectContaining({
            id: 'new-session',
            title: '基于此连接新建会话',
            createSession: {
              tags: [serverTag, currentDeviceTag]
            }
          })
        ]
      }),
      expect.objectContaining({
        id: 'device-local-device-2',
        title: 'Lab Linux',
        icon: 'computer',
        match: {
          tags: [otherDeviceTag]
        },
        showWhenEmpty: true,
        actions: [
          expect.objectContaining({
            id: 'new-session',
            title: '基于此连接新建会话',
            createSession: {
              tags: [serverTag, otherDeviceTag]
            }
          })
        ]
      })
    ])
    cleanup?.dispose()
  })

  it('falls back to configured server groups before device status is available', async () => {
    installBrowser()
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/status') return new Response(JSON.stringify({ servers: [] }), { status: 200 })
      return new Response('{}', { status: 404 })
    })
    const { cleanup, slots } = await createClientHarness(apiFetch, createHostI18n('en'), {
      servers: [{
        id: 'local',
        name: 'Local Relay SSO'
      }]
    })
    const tag = createRelaySessionGroupTag('relay', 'local')

    expect(slots.get('sessions.groups')).toEqual([
      expect.objectContaining({
        id: 'server-local',
        title: 'Local Relay SSO',
        icon: 'hub',
        match: {
          tags: [tag]
        },
        showWhenEmpty: true
      })
    ])
    cleanup?.dispose()
  })

  it('renders a concise icon-led surface instead of the raw status payload', async () => {
    installBrowser()
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/status') return statusResponse()
      return new Response('{}', { status: 404 })
    })
    const { cleanup, renderHome } = await createClientHarness(apiFetch)
    const container = new FakeContainer()

    renderHome(container as unknown as HTMLElement)
    await flushPromises()

    expect(container.innerHTML).toContain('oneworks-relay__surface')
    expect(container.innerHTML).toContain('material-symbols-rounded')
    expect(container.innerHTML).toContain('cloud_sync')
    expect(container.innerHTML).toContain('key_off')
    expect(container.innerHTML).toContain('oneworks-relay__revealed-actions')
    expect(container.innerHTML).toContain('oneworks-relay__account')
    expect(container.innerHTML).toContain('<details class="oneworks-relay__account"')
    expect(container.innerHTML).toContain('oneworks-relay__account-summary')
    expect(container.innerHTML).toContain('oneworks-relay__account-avatar')
    expect(container.innerHTML).toContain('oneworks-relay__account-platform')
    expect(container.innerHTML).toContain('Cloudflare')
    expect(container.innerHTML).toContain('oneworks-relay__account-state')
    expect(container.innerHTML).toContain('registered')
    expect(container.innerHTML).toContain('Local Relay SSO')
    expect(container.innerHTML).toContain('owner@local.test')
    expect(container.innerHTML).toContain('Office Mac')
    expect(container.innerHTML).toContain('aria-label="online"')
    expect(container.innerHTML).toContain('This device')
    expect(container.innerHTML).toContain('sessions / terminal')
    expect(container.innerHTML).toContain('aria-label="Connect"')
    expect(container.innerHTML).toContain('aria-label="Disconnect"')
    expect(container.innerHTML).toContain('data-tooltip="Connect"')
    expect(container.innerHTML).toContain('data-server-id="local"')
    expect(container.innerHTML).not.toContain('<span>Connect</span>')
    expect(container.innerHTML).not.toContain('<span>Login</span>')
    expect(container.innerHTML).not.toContain('oneworks-relay__header')
    expect(container.innerHTML).not.toContain('oneworks-relay__pre')
    expect(container.innerHTML).not.toContain('Connect this local OneWorks service')
    expect(container.innerHTML).not.toContain('"connection"')
    cleanup?.dispose()
  })

  it('renders Relay configuration distribution details when status is synced', async () => {
    installBrowser()
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/status') {
        return statusResponse({
          ...statusPayload,
          configDistribution: {
            allowedFields: ['modelServices', 'models'],
            hash: 'sha256:abc123',
            lastAppliedAt: '2026-06-15T09:12:00.000Z',
            lastSyncedAt: '2026-06-15T09:10:00.000Z',
            matchedProject: true,
            modelServiceKeys: ['openai', 'anthropic'],
            sourceServerId: 'oneworks-cloudflare',
            sources: [{
              assignmentId: 'assignment-1',
              disabledBy: [],
              enabled: true,
              fields: ['modelServices'],
              mode: 'default',
              profileId: 'profile-1',
              profileName: 'Base Profile',
              teamId: 'team-1',
              teamName: 'Team One',
              version: 1,
              versionId: 'version-1'
            }],
            version: '2026.06.15'
          }
        })
      }
      return new Response('{}', { status: 404 })
    })
    const { cleanup, renderHome } = await createClientHarness(apiFetch)
    const container = new FakeContainer()

    renderHome(container as unknown as HTMLElement)
    await flushPromises()

    expect(container.innerHTML).toContain('Relay configuration')
    expect(container.innerHTML).toContain('synced')
    expect(container.innerHTML).toContain('2026-06-15T09:10:00.000Z')
    expect(container.innerHTML).toContain('2026-06-15T09:12:00.000Z')
    expect(container.innerHTML).toContain('2026.06.15')
    expect(container.innerHTML).toContain('sha256:abc123')
    expect(container.innerHTML).toContain('oneworks-cloudflare')
    expect(container.innerHTML).toContain('matched')
    expect(container.innerHTML).toContain('openai, anthropic')
    expect(container.innerHTML).toContain('modelServices, models')
    expect(container.innerHTML).toContain('Team One / Base Profile')
    expect(container.innerHTML).toContain('data-action="toggle-config-source"')
    expect(container.innerHTML).toContain('data-source-kind="team"')
    expect(container.innerHTML).toContain('data-source-kind="profile"')
    cleanup?.dispose()
  })

  it('renders an empty Relay configuration state before distribution is available', async () => {
    installBrowser()
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/status') return statusResponse()
      return new Response('{}', { status: 404 })
    })
    const { cleanup, renderHome } = await createClientHarness(apiFetch)
    const container = new FakeContainer()

    renderHome(container as unknown as HTMLElement)
    await flushPromises()

    expect(container.innerHTML).toContain('No Relay configuration received yet.')
    expect(container.innerHTML).toContain('aria-label="Refresh Relay configuration"')
    expect(container.innerHTML).toContain('data-action="refresh-config"')
    expect(container.innerHTML).toContain('published_with_changes')
    cleanup?.dispose()
  })

  it('renders explicit Relay config sharing controls', async () => {
    installBrowser()
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/status') return statusResponse()
      return new Response('{}', { status: 404 })
    })
    const { cleanup, renderHome } = await createClientHarness(apiFetch)
    const container = new FakeContainer()

    renderHome(container as unknown as HTMLElement)
    await flushPromises()

    expect(container.innerHTML).toContain('Team config share')
    expect(container.innerHTML).toContain('data-action="share-preview"')
    expect(container.innerHTML).toContain('data-action="share-load-targets"')
    expect(container.innerHTML).toContain('data-action="share-publish"')
    expect(container.innerHTML).toContain('data-field="share-config"')
    expect(container.innerHTML).toContain('data-field="share-team"')
    expect(container.innerHTML).toContain('data-field="share-profile-name"')
    cleanup?.dispose()
  })

  it('renders the last Relay configuration sync error', async () => {
    installBrowser()
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/status') {
        return statusResponse({
          ...statusPayload,
          configDistribution: {
            lastError: 'Project rules checksum mismatch.',
            lastSyncedAt: '2026-06-15T09:10:00.000Z',
            sourceServerId: 'oneworks-cloudflare'
          }
        })
      }
      return new Response('{}', { status: 404 })
    })
    const { cleanup, renderHome } = await createClientHarness(apiFetch)
    const container = new FakeContainer()

    renderHome(container as unknown as HTMLElement)
    await flushPromises()

    expect(container.innerHTML).toContain('Sync failed')
    expect(container.innerHTML).toContain('Project rules checksum mismatch.')
    expect(container.innerHTML).toContain('oneworks-cloudflare')
    cleanup?.dispose()
  })

  it('registers a Relay configuration refresh command with status fallback', async () => {
    installBrowser()
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/config-refresh') return new Response('{}', { status: 404 })
      if (path === 'relay/status') return statusResponse()
      return new Response('{}', { status: 404 })
    })
    const { cleanup, commands } = await createClientHarness(apiFetch)

    await expect(commands.get('config-refresh')?.()).resolves.toMatchObject({
      connection: {
        activeServerId: 'local'
      }
    })
    expect(apiFetch).toHaveBeenCalledWith('relay/config-refresh', { method: 'POST' })
    expect(apiFetch).toHaveBeenCalledWith('relay/status')
    cleanup?.dispose()
  })

  it('renders labels and tooltips with the active locale', async () => {
    installBrowser('en')
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/status') return statusResponse()
      return new Response('{}', { status: 404 })
    })
    const { cleanup, commands, renderHome } = await createClientHarness(apiFetch, createHostI18n('zh-Hans'))
    const container = new FakeContainer()

    renderHome(container as unknown as HTMLElement)
    await flushPromises()

    expect(container.innerHTML).toContain('aria-label="连接"')
    expect(container.innerHTML).toContain('data-tooltip="连接"')
    expect(container.innerHTML).toContain('aria-label="刷新"')
    expect(container.innerHTML).toContain('Local Relay SSO')
    expect(container.innerHTML).toContain('owner@local.test')
    expect(container.innerHTML).toContain('aria-label="在线"')
    expect(container.innerHTML).toContain('本机')
    expect(container.innerHTML).toContain('会话 / 终端')
    expect(container.innerHTML).not.toContain('作用域 relay')
    expect(container.innerHTML).not.toContain('data-tooltip="Connect"')
    expect(commands.get('search')?.()).toEqual([{
      icon: 'account_circle',
      id: 'status',
      title: '账号状态',
      titleI18n: {
        en: 'Account status',
        'zh-Hans': '账号状态'
      }
    }])
    cleanup?.dispose()
  })
})
