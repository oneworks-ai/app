// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PluginProvider } from '#~/plugins/PluginProvider'
import type { PluginSnapshot } from '#~/plugins/api'
import { usePluginContext } from '#~/plugins/plugin-context'
import type { PluginContextValue } from '#~/plugins/plugin-context'

const reloadState = globalThis as typeof globalThis & {
  __pluginProviderCommittedReload?: () => Promise<void>
  __pluginProviderCommittedReloadActivationCount?: number
  __pluginProviderCommittedReloadCleanupCount?: number
}

const mocks = vi.hoisted(() => {
  const socketConnections: Array<{
    handlers: {
      onClose?: (event: CloseEvent) => void
      onOpen?: () => Promise<void> | void
    }
  }> = []
  return {
    createSocket: vi.fn((handlers: {
      onClose?: (event: CloseEvent) => void
      onOpen?: () => Promise<void> | void
    }) => {
      socketConnections.push({ handlers })
      return {
        addEventListener: vi.fn(),
        close: vi.fn(),
        readyState: WebSocket.OPEN
      }
    }),
    listPluginSnapshot: vi.fn(),
    notifications: {
      close: vi.fn(),
      isSourceMuted: vi.fn(() => false),
      muteSource: vi.fn(),
      show: vi.fn(),
      unmuteSource: vi.fn()
    },
    socketConnections
  }
})

vi.mock('#~/notifications/NotificationProvider', () => ({
  useNotifications: () => mocks.notifications
}))
vi.mock('#~/plugins/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/plugins/api')>(),
  listPluginSnapshot: mocks.listPluginSnapshot
}))
vi.mock('#~/runtime-config', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/runtime-config')>(),
  getRuntimeWorkspaceId: () => 'workspace-a',
  isServerManagerRole: () => false
}))
vi.mock('#~/ws.js', () => ({ createSocket: mocks.createSocket }))

const encodeModule = (source: string) => `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`

let container: HTMLDivElement
let latestContext: PluginContextValue | undefined
let root: Root

function ContextProbe() {
  latestContext = usePluginContext()
  return null
}

describe('plugin provider committed watch reload', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    Object.assign(reloadState, {
      __pluginProviderCommittedReloadActivationCount: 0,
      __pluginProviderCommittedReloadCleanupCount: 0
    })
    latestContext = undefined
    mocks.createSocket.mockClear()
    mocks.listPluginSnapshot.mockReset()
    mocks.socketConnections.length = 0
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(reloadState, '__pluginProviderCommittedReload')
    Reflect.deleteProperty(reloadState, '__pluginProviderCommittedReloadActivationCount')
    Reflect.deleteProperty(reloadState, '__pluginProviderCommittedReloadCleanupCount')
  })

  it('keeps the published registry reloadable while reconnect is pending', async () => {
    const snapshot: PluginSnapshot = {
      plugins: [{
        clientEntryUrl: encodeModule(`
          export function activatePlugin(ctx) {
            globalThis.__pluginProviderCommittedReloadActivationCount += 1
            globalThis.__pluginProviderCommittedReload = () => ctx.hot.reload()
            ctx.slots.register('nav.items', {
              id: 'oneworks-channel',
              title: 'Chat Rooms recovered'
            })
            return () => { globalThis.__pluginProviderCommittedReloadCleanupCount += 1 }
          }
        `),
        requestId: 'channel-oneworks',
        scope: 'channel-oneworks'
      }],
      runtime: {
        id: 'runtime-recovered',
        role: 'workspace',
        status: 'online'
      }
    }
    mocks.listPluginSnapshot
      .mockRejectedValueOnce(new Error('workspace server is starting'))
      .mockResolvedValueOnce(snapshot)

    await act(async () => {
      root.render(
        <PluginProvider>
          <ContextProbe />
        </PluginProvider>
      )
    })
    await vi.waitFor(() => {
      expect(latestContext?.pluginSnapshotStatus).toBe('error')
      expect(mocks.socketConnections).toHaveLength(1)
    })
    await act(async () => {
      await mocks.socketConnections[0]?.handlers.onOpen?.()
    })
    expect(latestContext?.snapshot.slots['nav.items']).toHaveLength(1)

    vi.useFakeTimers()
    await act(async () => {
      mocks.socketConnections[0]?.handlers.onClose?.({ code: 1006 } as CloseEvent)
      await reloadState.__pluginProviderCommittedReload?.()
    })

    expect(mocks.socketConnections).toHaveLength(1)
    expect(latestContext?.snapshot.slots['nav.items']).toEqual([
      expect.objectContaining({ title: 'Chat Rooms recovered' })
    ])
    expect(latestContext?.registry.getSnapshot().slots['nav.items']).toEqual([
      expect.objectContaining({ title: 'Chat Rooms recovered' })
    ])
    expect(reloadState.__pluginProviderCommittedReloadActivationCount).toBe(2)
    expect(reloadState.__pluginProviderCommittedReloadCleanupCount).toBe(1)
  })
})
