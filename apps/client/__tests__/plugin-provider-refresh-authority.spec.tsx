// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginRuntimeEndpoint } from '@oneworks/types'

import { PluginProvider } from '#~/plugins/PluginProvider'
import type { PluginSnapshot } from '#~/plugins/api'
import { usePluginContext } from '#~/plugins/plugin-context'
import type { PluginContextValue } from '#~/plugins/plugin-context'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

const mocks = vi.hoisted(() => ({
  createSocket: vi.fn(() => ({ readyState: WebSocket.CLOSED })),
  listPluginSnapshot: vi.fn()
}))

vi.mock('#~/notifications/NotificationProvider', () => ({
  useNotifications: () => ({
    close: vi.fn(),
    isSourceMuted: vi.fn(() => false),
    muteSource: vi.fn(),
    show: vi.fn(),
    unmuteSource: vi.fn()
  })
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

const createRuntime = (id: string): PluginRuntimeEndpoint => ({
  id,
  role: 'workspace',
  status: 'online'
})

const createInstance = (
  scope: string,
  clientEntryUrl?: string
): PluginRuntimeInstance => ({
  ...(clientEntryUrl == null ? {} : { clientEntryUrl }),
  requestId: scope,
  scope
})

const createSnapshot = (
  runtimeId: string,
  instance: PluginRuntimeInstance
): PluginSnapshot => ({
  plugins: [instance],
  runtime: createRuntime(runtimeId)
})

let container: HTMLDivElement
let latestContext: PluginContextValue | undefined
let root: Root

function ContextProbe() {
  latestContext = usePluginContext()
  return null
}

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const renderInitialSnapshot = async (
  initialLoad: ReturnType<typeof createDeferred<PluginSnapshot>>,
  snapshot = createSnapshot('runtime-base', createInstance('base'))
) => {
  await act(async () => {
    root.render(
      <PluginProvider>
        <ContextProbe />
      </PluginProvider>
    )
  })
  await act(async () => {
    initialLoad.resolve(snapshot)
    await initialLoad.promise
  })
  await flushPromises()
}

describe('plugin provider refresh authority', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    latestContext = undefined
    mocks.createSocket.mockClear()
    mocks.listPluginSnapshot.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(globalThis, '__pluginProviderActivationGate')
    Reflect.deleteProperty(globalThis, '__pluginProviderActivationFailureGate')
    Reflect.deleteProperty(globalThis, '__pluginProviderActivationStarted')
    Reflect.deleteProperty(globalThis, '__pluginProviderAuthorityActivationCount')
    Reflect.deleteProperty(globalThis, '__pluginProviderCleanupCount')
    Reflect.deleteProperty(globalThis, '__pluginProviderCurrentActivationCount')
  })

  it('rolls back a successful activation owner when external authority expires mid-activation', async () => {
    const initialLoad = createDeferred<PluginSnapshot>()
    const activationLoad = createDeferred<PluginSnapshot>()
    const activationGate = createDeferred<void>()
    const activationStarted = createDeferred<void>()
    Object.assign(globalThis, {
      __pluginProviderActivationGate: activationGate.promise,
      __pluginProviderActivationStarted: activationStarted.resolve,
      __pluginProviderAuthorityActivationCount: 0,
      __pluginProviderCleanupCount: 0
    })
    mocks.listPluginSnapshot
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(activationLoad.promise)

    await renderInitialSnapshot(initialLoad)
    let authorityCurrent = true
    let refresh!: Promise<void>
    await act(async () => {
      refresh = latestContext!.refreshPlugins({
        isCurrent: () => authorityCurrent
      })
      activationLoad.resolve(createSnapshot(
        'runtime-authority',
        createInstance(
          'shared',
          encodeModule(`
            export async function activatePlugin(ctx) {
              globalThis.__pluginProviderAuthorityActivationCount += 1
              ctx.routes.register({ id: 'early', viewId: 'early-view' })
              ctx.slots.register('chat.header.actions', { id: 'early-slot', title: 'Early' })
              ctx.pluginApis.register({ id: 'early-api', handler: () => 'early' })
              globalThis.__pluginProviderActivationStarted()
              await globalThis.__pluginProviderActivationGate
              if (globalThis.__pluginProviderAuthorityActivationCount === 1) {
                await ctx.hot.reload()
              }
              ctx.routes.register({ id: 'late', viewId: 'late-view' })
              ctx.slots.register('chat.header.actions', { id: 'late-slot', title: 'Late' })
              ctx.pluginApis.register({ id: 'late-api', handler: () => 'late' })
              return () => {
                globalThis.__pluginProviderCleanupCount += 1
              }
            }
          `)
        )
      ))
      await activationLoad.promise
      await activationStarted.promise
    })
    await flushPromises()
    expect(latestContext?.snapshot.routes.map(route => route.id)).toEqual(['early'])
    expect(latestContext?.snapshot.slots['chat.header.actions']?.map(item => item.id)).toEqual(['early-slot'])
    expect(latestContext?.snapshot.pluginApis.map(api => api.id)).toEqual(['early-api'])

    await act(async () => {
      authorityCurrent = false
      activationGate.resolve()
      await activationGate.promise
      await refresh
    })
    await flushPromises()
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-authority')
    expect(latestContext?.snapshot.instances.map(item => item.scope)).toEqual(['shared'])
    expect(latestContext?.snapshot.routes).toEqual([])
    expect(latestContext?.snapshot.slots['chat.header.actions']).toEqual([])
    expect(latestContext?.snapshot.pluginApis).toEqual([])
    expect(Reflect.get(globalThis, '__pluginProviderAuthorityActivationCount')).toBe(1)
    expect(Reflect.get(globalThis, '__pluginProviderCleanupCount')).toBe(1)
  })

  it('rolls back an activation owner when stale activation rejects', async () => {
    const initialLoad = createDeferred<PluginSnapshot>()
    const activationLoad = createDeferred<PluginSnapshot>()
    const activationFailureGate = createDeferred<void>()
    const activationStarted = createDeferred<void>()
    Object.assign(globalThis, {
      __pluginProviderActivationFailureGate: activationFailureGate.promise,
      __pluginProviderActivationStarted: activationStarted.resolve
    })
    mocks.listPluginSnapshot
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(activationLoad.promise)

    await renderInitialSnapshot(initialLoad)
    let authorityCurrent = true
    let refresh!: Promise<void>
    await act(async () => {
      refresh = latestContext!.refreshPlugins({
        isCurrent: () => authorityCurrent
      })
      activationLoad.resolve(createSnapshot(
        'runtime-error',
        createInstance(
          'shared',
          encodeModule(`
            export async function activatePlugin(ctx) {
              ctx.routes.register({ id: 'early-error', viewId: 'early-error-view' })
              globalThis.__pluginProviderActivationStarted()
              await globalThis.__pluginProviderActivationFailureGate
            }
          `)
        )
      ))
      await activationLoad.promise
      await activationStarted.promise
    })
    await flushPromises()
    expect(latestContext?.snapshot.routes.map(route => route.id)).toEqual(['early-error'])

    await act(async () => {
      authorityCurrent = false
      activationFailureGate.reject(new Error('stale activation failed'))
      await refresh
    })
    await flushPromises()
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-error')
    expect(latestContext?.snapshot.instances.map(item => item.scope)).toEqual(['shared'])
    expect(latestContext?.snapshot.routes).toEqual([])
    expect(latestContext?.snapshot.diagnostics).toEqual([])
  })

  it('preserves same-key newer registrations and ignores stale hot reload', async () => {
    const initialLoad = createDeferred<PluginSnapshot>()
    const staleLoad = createDeferred<PluginSnapshot>()
    const currentLoad = createDeferred<PluginSnapshot>()
    const activationGate = createDeferred<void>()
    const activationStarted = createDeferred<void>()
    Object.assign(globalThis, {
      __pluginProviderActivationGate: activationGate.promise,
      __pluginProviderActivationStarted: activationStarted.resolve,
      __pluginProviderCleanupCount: 0,
      __pluginProviderCurrentActivationCount: 0
    })
    mocks.listPluginSnapshot
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(staleLoad.promise)
      .mockReturnValueOnce(currentLoad.promise)

    await renderInitialSnapshot(initialLoad)
    let staleAuthorityCurrent = true
    let staleRefresh!: Promise<void>
    await act(async () => {
      staleRefresh = latestContext!.refreshPlugins({
        isCurrent: () => staleAuthorityCurrent
      })
      staleLoad.resolve(createSnapshot(
        'runtime-stale',
        createInstance(
          'shared',
          encodeModule(`
            export async function activatePlugin(ctx) {
              const staleRoute = ctx.routes.register({ id: 'shared-route', viewId: 'stale-view' })
              const staleSlot = ctx.slots.register(
                'chat.header.actions',
                { id: 'shared-slot', title: 'Stale' }
              )
              globalThis.__pluginProviderActivationStarted()
              await globalThis.__pluginProviderActivationGate
              await ctx.hot.reload()
              return () => {
                staleRoute.dispose()
                staleSlot.dispose()
                globalThis.__pluginProviderCleanupCount += 1
              }
            }
          `)
        )
      ))
      await staleLoad.promise
      await activationStarted.promise
    })
    await flushPromises()
    expect(latestContext?.snapshot.routes).toEqual([
      expect.objectContaining({ id: 'shared-route', viewId: 'stale-view' })
    ])
    expect(latestContext?.snapshot.slots['chat.header.actions']).toEqual([
      expect.objectContaining({ id: 'shared-slot', title: 'Stale' })
    ])

    let currentRefresh!: Promise<void>
    await act(async () => {
      staleAuthorityCurrent = false
      currentRefresh = latestContext!.refreshPlugins()
      currentLoad.resolve(createSnapshot(
        'runtime-current',
        createInstance(
          'shared',
          encodeModule(`
            export function activatePlugin(ctx) {
              globalThis.__pluginProviderCurrentActivationCount += 1
              ctx.routes.register({ id: 'shared-route', viewId: 'current-view' })
              ctx.slots.register(
                'chat.header.actions',
                { id: 'shared-slot', title: 'Current' }
              )
            }
          `)
        )
      ))
      await currentLoad.promise
      await currentRefresh
    })
    await flushPromises()
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-current')
    expect(latestContext?.snapshot.instances.map(item => item.scope)).toEqual(['shared'])
    expect(latestContext?.snapshot.routes).toEqual([
      expect.objectContaining({ id: 'shared-route', viewId: 'current-view' })
    ])
    expect(latestContext?.snapshot.slots['chat.header.actions']).toEqual([
      expect.objectContaining({ id: 'shared-slot', title: 'Current' })
    ])
    expect(Reflect.get(globalThis, '__pluginProviderCurrentActivationCount')).toBe(1)

    await act(async () => {
      activationGate.resolve()
      await activationGate.promise
      await staleRefresh
    })
    await flushPromises()
    expect(latestContext?.snapshot.routes).toEqual([
      expect.objectContaining({ id: 'shared-route', viewId: 'current-view' })
    ])
    expect(latestContext?.snapshot.slots['chat.header.actions']).toEqual([
      expect.objectContaining({ id: 'shared-slot', title: 'Current' })
    ])
    expect(Reflect.get(globalThis, '__pluginProviderCurrentActivationCount')).toBe(1)
    expect(Reflect.get(globalThis, '__pluginProviderCleanupCount')).toBe(1)
  })

  it('rejects an obsolete external scope before runtime and registry snapshot commits', async () => {
    const initialLoad = createDeferred<PluginSnapshot>()
    const obsoleteLoad = createDeferred<PluginSnapshot>()
    mocks.listPluginSnapshot
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(obsoleteLoad.promise)

    await renderInitialSnapshot(initialLoad)
    let authorityCurrent = true
    let refresh!: Promise<void>
    await act(async () => {
      refresh = latestContext!.refreshPlugins({
        isCurrent: () => authorityCurrent
      })
      authorityCurrent = false
      obsoleteLoad.resolve(createSnapshot('runtime-obsolete', createInstance('obsolete')))
      await obsoleteLoad.promise
      await refresh
    })
    await flushPromises()
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-base')
    expect(latestContext?.snapshot.instances.map(item => item.scope)).toEqual(['base'])
  })
})
