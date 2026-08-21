// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PublicPluginRuntimeEndpoint } from '@oneworks/types'

import { PluginProvider } from '#~/plugins/PluginProvider'
import type { PluginSnapshot } from '#~/plugins/api'
import { usePluginContext } from '#~/plugins/plugin-context'
import type { PluginContextValue } from '#~/plugins/plugin-context'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

const recoveryState = globalThis as typeof globalThis & {
  __pluginProviderWatchRecoveryActivationCount?: number
  __pluginProviderWatchRecoveryCleanupCount?: number
  __pluginProviderWatchStaleActivationGate?: Promise<void>
  __pluginProviderWatchStaleActivationStarted?: () => void
}

const mocks = vi.hoisted(() => {
  const socketConnections: Array<{
    handlers: {
      onClose?: (event: CloseEvent) => void
      onMessage?: (event: { scope: string; type: 'plugin.changed' }) => void
      onOpen?: () => Promise<void> | void
    }
    socket: {
      addEventListener: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
      readyState: number
    }
  }> = []
  return {
    createSocket: vi.fn((handlers: {
      onClose?: (event: CloseEvent) => void
      onMessage?: (event: { scope: string; type: 'plugin.changed' }) => void
      onOpen?: () => Promise<void> | void
    }) => {
      const socket = {
        addEventListener: vi.fn(),
        close: vi.fn(),
        readyState: WebSocket.OPEN
      }
      socketConnections.push({ handlers, socket })
      return socket
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

const createDeferred = <T,>() => {
  let reject!: (reason: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

const createRuntime = (id: string): PublicPluginRuntimeEndpoint => ({
  id,
  role: 'workspace',
  status: 'online'
})

const createInstance = (scope: string, clientEntryUrl?: string): PluginRuntimeInstance => ({
  ...(clientEntryUrl == null ? {} : { clientEntryUrl }),
  requestId: scope,
  scope
})

const createSnapshot = (runtimeId: string, instance: PluginRuntimeInstance): PluginSnapshot => ({
  plugins: [instance],
  runtime: createRuntime(runtimeId)
})

let container: HTMLDivElement
let latestContext: PluginContextValue | undefined
let renderedNavItemCounts: number[]
let root: Root

function ContextProbe() {
  latestContext = usePluginContext()
  renderedNavItemCounts.push(latestContext.snapshot.slots['nav.items']?.length ?? 0)
  return null
}

const renderProvider = async (runtimeServerBaseUrl?: string) => {
  await act(async () => {
    root.render(
      <PluginProvider runtimeServerBaseUrl={runtimeServerBaseUrl}>
        <ContextProbe />
      </PluginProvider>
    )
  })
}

describe('plugin provider watch recovery', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    latestContext = undefined
    renderedNavItemCounts = []
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
    Reflect.deleteProperty(recoveryState, '__pluginProviderWatchRecoveryActivationCount')
    Reflect.deleteProperty(recoveryState, '__pluginProviderWatchRecoveryCleanupCount')
    Reflect.deleteProperty(recoveryState, '__pluginProviderWatchStaleActivationGate')
    Reflect.deleteProperty(recoveryState, '__pluginProviderWatchStaleActivationStarted')
  })

  it('recovers a failed bootstrap on open and revalidates once per reconnect', async () => {
    Object.assign(recoveryState, {
      __pluginProviderWatchRecoveryActivationCount: 0,
      __pluginProviderWatchRecoveryCleanupCount: 0
    })
    mocks.listPluginSnapshot
      .mockRejectedValueOnce(new Error('workspace server is starting'))
      .mockResolvedValueOnce(createSnapshot(
        'runtime-recovered',
        createInstance(
          'channel-oneworks',
          encodeModule(`
            export function activatePlugin(ctx) {
              globalThis.__pluginProviderWatchRecoveryActivationCount += 1
              ctx.slots.register('nav.items', {
                id: 'oneworks-channel',
                title: 'Chat Rooms recovered'
              })
              return () => { globalThis.__pluginProviderWatchRecoveryCleanupCount += 1 }
            }
          `)
        )
      ))
      .mockResolvedValueOnce(createSnapshot(
        'runtime-reconnected',
        createInstance(
          'channel-oneworks',
          encodeModule(`
            export function activatePlugin(ctx) {
              globalThis.__pluginProviderWatchRecoveryActivationCount += 1
              ctx.slots.register('nav.items', {
                id: 'oneworks-channel',
                title: 'Chat Rooms reconnected'
              })
              return () => { globalThis.__pluginProviderWatchRecoveryCleanupCount += 1 }
            }
          `)
        )
      ))
    await renderProvider()
    await vi.waitFor(() => {
      expect(latestContext?.pluginSnapshotStatus).toBe('error')
      expect(mocks.socketConnections).toHaveLength(1)
    })
    await act(async () => {
      await mocks.socketConnections[0]?.handlers.onOpen?.()
    })
    expect(latestContext?.pluginSnapshotStatus).toBe('ready')
    expect(latestContext?.snapshot.slots['nav.items']).toEqual([
      expect.objectContaining({ title: 'Chat Rooms recovered' })
    ])
    expect(recoveryState.__pluginProviderWatchRecoveryActivationCount).toBe(1)
    expect(mocks.listPluginSnapshot).toHaveBeenCalledTimes(2)
    renderedNavItemCounts = []
    vi.useFakeTimers()
    await act(async () => {
      mocks.socketConnections[0]?.handlers.onClose?.({ code: 1006 } as CloseEvent)
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mocks.socketConnections).toHaveLength(2)
    await act(async () => {
      await mocks.socketConnections[1]?.handlers.onOpen?.()
    })
    expect(mocks.listPluginSnapshot).toHaveBeenCalledTimes(3)
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-reconnected')
    expect(latestContext?.snapshot.slots['nav.items']).toEqual([
      expect.objectContaining({ title: 'Chat Rooms reconnected' })
    ])
    expect(latestContext?.registry.getSnapshot().slots['nav.items']).toEqual([
      expect.objectContaining({ title: 'Chat Rooms reconnected' })
    ])
    expect(renderedNavItemCounts).not.toContain(0)
    expect(recoveryState.__pluginProviderWatchRecoveryActivationCount).toBe(2)
    expect(recoveryState.__pluginProviderWatchRecoveryCleanupCount).toBe(1)
  })
  it('does not duplicate a pending successful bootstrap load on the first open', async () => {
    const bootstrapLoad = createDeferred<PluginSnapshot>()
    mocks.listPluginSnapshot.mockReturnValue(bootstrapLoad.promise)

    await renderProvider()
    await vi.waitFor(() => {
      expect(latestContext?.pluginSnapshotStatus).toBe('loading')
      expect(mocks.socketConnections).toHaveLength(1)
    })

    let firstOpen: Promise<void> | void
    await act(async () => {
      firstOpen = mocks.socketConnections[0]?.handlers.onOpen?.()
      await Promise.resolve()
    })
    await act(async () => {
      bootstrapLoad.resolve(createSnapshot('runtime-ready', createInstance('ready')))
      await firstOpen
    })
    expect(latestContext?.pluginSnapshotStatus).toBe('ready')
    expect(mocks.listPluginSnapshot).toHaveBeenCalledTimes(1)
  })

  it('does not let an obsolete refresh close a newer connection', async () => {
    const obsoleteRefresh = createDeferred<PluginSnapshot>()
    mocks.listPluginSnapshot
      .mockRejectedValueOnce(new Error('workspace server is starting'))
      .mockReturnValueOnce(obsoleteRefresh.promise)
      .mockResolvedValue(createSnapshot('runtime-current', createInstance('current')))

    await renderProvider()
    await vi.waitFor(() => {
      expect(latestContext?.pluginSnapshotStatus).toBe('error')
      expect(mocks.socketConnections).toHaveLength(1)
    })
    let obsoleteOpen: Promise<void> | void
    await act(async () => {
      obsoleteOpen = mocks.socketConnections[0]?.handlers.onOpen?.()
      await Promise.resolve()
    })
    expect(mocks.listPluginSnapshot).toHaveBeenCalledTimes(2)

    vi.useFakeTimers()
    await act(async () => {
      mocks.socketConnections[0]?.handlers.onClose?.({ code: 1006 } as CloseEvent)
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mocks.socketConnections).toHaveLength(2)
    await act(async () => {
      obsoleteRefresh.reject(new Error('obsolete connection failed'))
      await obsoleteOpen
    })
    expect(mocks.socketConnections[1]?.socket.close).not.toHaveBeenCalled()

    await act(async () => {
      await mocks.socketConnections[1]?.handlers.onOpen?.()
    })
    expect(latestContext?.pluginSnapshotStatus).toBe('ready')
  })

  it('does not let an obsolete connection finish registering a staged activation', async () => {
    const activationGate = createDeferred<void>()
    const activationStarted = createDeferred<void>()
    Object.assign(recoveryState, {
      __pluginProviderWatchStaleActivationGate: activationGate.promise,
      __pluginProviderWatchStaleActivationStarted: activationStarted.resolve
    })
    mocks.listPluginSnapshot
      .mockRejectedValueOnce(new Error('workspace server is starting'))
      .mockResolvedValueOnce(createSnapshot(
        'runtime-obsolete',
        createInstance(
          'obsolete',
          encodeModule(`
            export async function activatePlugin(ctx) {
              globalThis.__pluginProviderWatchStaleActivationStarted()
              await globalThis.__pluginProviderWatchStaleActivationGate
              ctx.slots.register('nav.items', {
                id: 'obsolete-nav',
                title: 'Obsolete navigation'
              })
            }
          `)
        )
      ))
      .mockRejectedValueOnce(new Error('new connection snapshot failed'))
      .mockResolvedValueOnce(createSnapshot(
        'runtime-current',
        createInstance(
          'current',
          encodeModule(`
            export function activatePlugin(ctx) {
              ctx.slots.register('nav.items', {
                id: 'current-nav',
                title: 'Current navigation'
              })
            }
          `)
        )
      ))

    await renderProvider()
    await vi.waitFor(() => {
      expect(latestContext?.pluginSnapshotStatus).toBe('error')
      expect(mocks.socketConnections).toHaveLength(1)
    })

    let obsoleteOpen: Promise<void> | void
    await act(async () => {
      obsoleteOpen = mocks.socketConnections[0]?.handlers.onOpen?.()
      await activationStarted.promise
    })
    vi.useFakeTimers()
    await act(async () => {
      mocks.socketConnections[0]?.handlers.onClose?.({ code: 1006 } as CloseEvent)
      activationGate.resolve()
      await obsoleteOpen
    })
    expect(mocks.socketConnections).toHaveLength(1)
    expect(latestContext?.snapshot.slots['nav.items']).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'obsolete-nav' })
    ]))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mocks.socketConnections).toHaveLength(2)
    await act(async () => {
      await mocks.socketConnections[1]?.handlers.onOpen?.()
    })
    expect(latestContext?.snapshot.slots['nav.items']).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'obsolete-nav' })
    ]))

    await act(async () => {
      await latestContext?.refreshPlugins()
    })
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-current')
    expect(latestContext?.snapshot.slots['nav.items']).toEqual([
      expect.objectContaining({ id: 'current-nav' })
    ])
    expect(latestContext?.registry.getSnapshot().slots['nav.items']).toEqual([
      expect.objectContaining({ id: 'current-nav' })
    ])
  })

  it('keeps an ordinary refresh authoritative over an in-flight watch activation', async () => {
    const watchActivationGate = createDeferred<void>()
    const watchActivationStarted = createDeferred<void>()
    Object.assign(recoveryState, {
      __pluginProviderWatchStaleActivationGate: watchActivationGate.promise,
      __pluginProviderWatchStaleActivationStarted: watchActivationStarted.resolve
    })
    mocks.listPluginSnapshot
      .mockResolvedValueOnce(createSnapshot(
        'runtime-base',
        createInstance(
          'base',
          encodeModule(`
            export function activatePlugin(ctx) {
              ctx.commands.register('ping', () => 'base-active')
            }
          `)
        )
      ))
      .mockResolvedValueOnce(createSnapshot(
        'runtime-watch',
        createInstance(
          'watch',
          encodeModule(`
            export async function activatePlugin(ctx) {
              globalThis.__pluginProviderWatchStaleActivationStarted()
              await globalThis.__pluginProviderWatchStaleActivationGate
              ctx.slots.register('nav.items', { id: 'watch-nav', title: 'Watch navigation' })
            }
          `)
        )
      ))
      .mockResolvedValueOnce(createSnapshot(
        'runtime-ordinary',
        createInstance(
          'ordinary',
          encodeModule(`
            export function activatePlugin(ctx) {
              ctx.slots.register('nav.items', { id: 'ordinary-nav', title: 'Ordinary navigation' })
            }
          `)
        )
      ))

    await renderProvider()
    await vi.waitFor(() => {
      expect(latestContext?.pluginSnapshotStatus).toBe('ready')
      expect(mocks.socketConnections).toHaveLength(1)
    })
    await act(async () => {
      mocks.socketConnections[0]?.handlers.onMessage?.({ scope: '*', type: 'plugin.changed' })
      await watchActivationStarted.promise
    })
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-base')
    expect(latestContext?.snapshot.instances.map(instance => instance.scope)).toEqual(['base'])
    expect(latestContext?.registry.getSnapshot().instances.map(instance => instance.scope)).toEqual(['base'])
    await expect(latestContext?.registry.executeCommand('base', 'ping')).resolves.toBe('base-active')
    await act(async () => {
      await latestContext?.refreshPlugins()
    })
    await act(async () => {
      watchActivationGate.resolve()
      await watchActivationGate.promise
    })
    await vi.waitFor(() => expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-ordinary'))

    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-ordinary')
    expect(latestContext?.snapshot.slots['nav.items']).toEqual([
      expect.objectContaining({ id: 'ordinary-nav' })
    ])
    expect(latestContext?.registry.getSnapshot().slots['nav.items']).toEqual([
      expect.objectContaining({ id: 'ordinary-nav' })
    ])
  })

  it('does not publish an old watch activation after the provider source changes', async () => {
    const watchActivationGate = createDeferred<void>()
    const watchActivationStarted = createDeferred<void>()
    Object.assign(recoveryState, {
      __pluginProviderWatchStaleActivationGate: watchActivationGate.promise,
      __pluginProviderWatchStaleActivationStarted: watchActivationStarted.resolve
    })
    mocks.listPluginSnapshot
      .mockResolvedValueOnce(createSnapshot('runtime-old-base', createInstance('old-base')))
      .mockResolvedValueOnce(createSnapshot(
        'runtime-old-watch',
        createInstance(
          'old-watch',
          encodeModule(`
            export async function activatePlugin(ctx) {
              globalThis.__pluginProviderWatchStaleActivationStarted()
              await globalThis.__pluginProviderWatchStaleActivationGate
              ctx.slots.register('nav.items', { id: 'old-watch-nav', title: 'Old watch navigation' })
            }
          `)
        )
      ))
      .mockResolvedValueOnce(createSnapshot(
        'runtime-new-source',
        createInstance(
          'new-source',
          encodeModule(`
            export function activatePlugin(ctx) {
              ctx.slots.register('nav.items', { id: 'new-source-nav', title: 'New source navigation' })
            }
          `)
        )
      ))

    await renderProvider('http://127.0.0.1:39001')
    await vi.waitFor(() => {
      expect(latestContext?.pluginSnapshotStatus).toBe('ready')
      expect(mocks.socketConnections).toHaveLength(1)
    })
    await act(async () => {
      mocks.socketConnections[0]?.handlers.onMessage?.({ scope: '*', type: 'plugin.changed' })
      await watchActivationStarted.promise
    })
    await renderProvider('http://127.0.0.1:39002')
    await vi.waitFor(() => expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-new-source'))
    await act(async () => {
      watchActivationGate.resolve()
      await watchActivationGate.promise
    })
    expect(latestContext?.snapshot.slots['nav.items']).toEqual([
      expect.objectContaining({ id: 'new-source-nav' })
    ])
    expect(latestContext?.registry.getSnapshot().slots['nav.items']).toEqual([
      expect.objectContaining({ id: 'new-source-nav' })
    ])
  })
})
