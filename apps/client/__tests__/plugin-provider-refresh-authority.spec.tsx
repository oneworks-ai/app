// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PublicPluginRuntimeEndpoint } from '@oneworks/types'

import { PluginProvider } from '#~/plugins/PluginProvider'
import type { PluginSnapshot } from '#~/plugins/api'
import {
  claimMarketplaceConvergenceAuthority,
  resolveMarketplaceServerKey
} from '#~/plugins/marketplace-mutation-authority'
import { usePluginContext } from '#~/plugins/plugin-context'
import type { PluginContextValue } from '#~/plugins/plugin-context'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

const mocks = vi.hoisted(() => ({
  createSocket: vi.fn(() => ({ readyState: WebSocket.CLOSED })),
  listPluginSnapshot: vi.fn(),
  notifications: {
    close: vi.fn(),
    isSourceMuted: vi.fn(() => false),
    muteSource: vi.fn(),
    show: vi.fn(),
    unmuteSource: vi.fn()
  }
}))

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
  initialLoad: ReturnType<typeof createDeferred<PluginSnapshot>>
) => {
  await act(async () => {
    root.render(
      <PluginProvider>
        <ContextProbe />
      </PluginProvider>
    )
  })
  await act(async () => {
    initialLoad.resolve(createSnapshot('runtime-base', createInstance('base')))
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
    Reflect.deleteProperty(globalThis, '__pluginProviderActivationStarted')
    Reflect.deleteProperty(globalThis, '__pluginProviderCleanupCount')
    Reflect.deleteProperty(globalThis, '__pluginProviderCurrentActivationCount')
    Reflect.deleteProperty(globalThis, '__pluginProviderRejectedRefreshGate')
    Reflect.deleteProperty(globalThis, '__pluginProviderRejectedRefreshStarted')
    Reflect.deleteProperty(globalThis, '__pluginProviderAuthorityRaceGate')
    Reflect.deleteProperty(globalThis, '__pluginProviderAuthorityRaceStarted')
  })

  it('preserves current same-key registrations when an older activation loses authority', async () => {
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
    let staleRefresh!: ReturnType<PluginContextValue['refreshPlugins']>
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
            ctx.routes.register({ id: 'shared-route', viewId: 'stale-view' })
            globalThis.__pluginProviderActivationStarted()
            await globalThis.__pluginProviderActivationGate
            await ctx.hot.reload()
            ctx.routes.register({ id: 'late-route', viewId: 'late-view' })
            return () => { globalThis.__pluginProviderCleanupCount += 1 }
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

    let currentRefresh!: ReturnType<PluginContextValue['refreshPlugins']>
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
          }
        `)
        )
      ))
      await currentLoad.promise
      await currentRefresh
    })
    await flushPromises()
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-current')
    expect(latestContext?.snapshot.routes).toEqual([
      expect.objectContaining({ id: 'shared-route', viewId: 'current-view' })
    ])

    await act(async () => {
      activationGate.resolve()
      await activationGate.promise
      await staleRefresh
    })
    await flushPromises()
    expect(latestContext?.snapshot.routes).toEqual([
      expect.objectContaining({ id: 'shared-route', viewId: 'current-view' })
    ])
    expect(Reflect.get(globalThis, '__pluginProviderCurrentActivationCount')).toBe(1)
    expect(Reflect.get(globalThis, '__pluginProviderCleanupCount')).toBe(0)
  })

  it('reports an older refresh superseded by an ordinary provider refresh as not applied', async () => {
    const initialLoad = createDeferred<PluginSnapshot>()
    const uninstallLoad = createDeferred<PluginSnapshot>()
    const ordinaryLoad = createDeferred<PluginSnapshot>()
    mocks.listPluginSnapshot
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(uninstallLoad.promise)
      .mockReturnValueOnce(ordinaryLoad.promise)

    await renderInitialSnapshot(initialLoad)
    const marketplaceAuthorityCurrent = vi.fn(() => true)
    const uninstallRefresh = latestContext!.refreshPlugins({
      isCurrent: marketplaceAuthorityCurrent
    })
    const ordinaryRefresh = latestContext!.refreshPlugins()

    await act(async () => {
      ordinaryLoad.resolve(createSnapshot('runtime-ordinary', createInstance('ordinary')))
      await expect(ordinaryRefresh).resolves.toEqual({ applied: true })
    })
    await act(async () => {
      uninstallLoad.resolve(createSnapshot('runtime-uninstall', createInstance('uninstall')))
      await expect(uninstallRefresh).resolves.toEqual({ applied: false })
    })

    expect(marketplaceAuthorityCurrent()).toBe(true)
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-ordinary')
    expect(latestContext?.snapshot.instances.map(item => item.scope)).toEqual(['ordinary'])
  })

  it('rejects an obsolete external scope before runtime and registry commits', async () => {
    const initialLoad = createDeferred<PluginSnapshot>()
    const obsoleteLoad = createDeferred<PluginSnapshot>()
    mocks.listPluginSnapshot
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(obsoleteLoad.promise)

    await renderInitialSnapshot(initialLoad)
    let authorityCurrent = true
    let refresh!: ReturnType<PluginContextValue['refreshPlugins']>
    await act(async () => {
      refresh = latestContext!.refreshPlugins({ isCurrent: () => authorityCurrent })
      authorityCurrent = false
      obsoleteLoad.resolve(createSnapshot('runtime-obsolete', createInstance('obsolete')))
      await obsoleteLoad.promise
      await refresh
    })
    await flushPromises()
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-base')
    expect(latestContext?.snapshot.instances.map(item => item.scope)).toEqual(['base'])
  })

  it('keeps the last successful activation authoritative when a newer snapshot request rejects', async () => {
    const initialLoad = createDeferred<PluginSnapshot>()
    const successfulLoad = createDeferred<PluginSnapshot>()
    const rejectedLoad = createDeferred<PluginSnapshot>()
    const activationGate = createDeferred<void>()
    const activationStarted = createDeferred<void>()
    Object.assign(globalThis, {
      __pluginProviderRejectedRefreshGate: activationGate.promise,
      __pluginProviderRejectedRefreshStarted: activationStarted.resolve
    })
    mocks.listPluginSnapshot
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(successfulLoad.promise)
      .mockReturnValueOnce(rejectedLoad.promise)

    await renderInitialSnapshot(initialLoad)
    let successfulRefresh!: ReturnType<PluginContextValue['refreshPlugins']>
    await act(async () => {
      successfulRefresh = latestContext!.refreshPlugins()
      successfulLoad.resolve(createSnapshot(
        'runtime-successful',
        createInstance(
          'retained',
          encodeModule(`
            export async function activatePlugin(ctx) {
              ctx.routes.register({ id: 'before-rejection', viewId: 'before-view' })
              globalThis.__pluginProviderRejectedRefreshStarted()
              await globalThis.__pluginProviderRejectedRefreshGate
              ctx.routes.register({ id: 'after-rejection', viewId: 'after-view' })
            }
          `)
        )
      ))
      await successfulLoad.promise
      await activationStarted.promise
    })
    await flushPromises()

    const requestError = new Error('snapshot request failed')
    let rejectedRefresh!: ReturnType<PluginContextValue['refreshPlugins']>
    await act(async () => {
      rejectedRefresh = latestContext!.refreshPlugins()
      rejectedLoad.reject(requestError)
      await expect(rejectedRefresh).rejects.toBe(requestError)
    })

    await act(async () => {
      activationGate.resolve()
      await activationGate.promise
      await successfulRefresh
    })
    await flushPromises()
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-successful')
    expect(latestContext?.snapshot.routes).toEqual([
      expect.objectContaining({ id: 'before-rejection', viewId: 'before-view' }),
      expect.objectContaining({ id: 'after-rejection', viewId: 'after-view' })
    ])
  })

  it('ignores an older rejection after a newer snapshot has committed ready status', async () => {
    const olderLoad = createDeferred<PluginSnapshot>()
    const newerLoad = createDeferred<PluginSnapshot>()
    mocks.listPluginSnapshot
      .mockReturnValueOnce(olderLoad.promise)
      .mockReturnValueOnce(newerLoad.promise)

    await act(async () => {
      root.render(
        <PluginProvider>
          <ContextProbe />
        </PluginProvider>
      )
    })
    let newerRefresh!: ReturnType<PluginContextValue['refreshPlugins']>
    await act(async () => {
      newerRefresh = latestContext!.refreshPlugins()
      newerLoad.resolve(createSnapshot('runtime-newer', createInstance('newer')))
      await newerLoad.promise
      await newerRefresh
    })
    expect(latestContext?.pluginSnapshotStatus).toBe('ready')
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-newer')

    await act(async () => {
      olderLoad.reject(new Error('obsolete snapshot failure'))
      await olderLoad.promise.catch(() => undefined)
    })
    await flushPromises()
    expect(latestContext?.pluginSnapshotStatus).toBe('ready')
    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-newer')
    expect(latestContext?.snapshot.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('obsolete snapshot failure') })
    ]))
  })

  it('finishes a staged last-good activation when a later source claim fails', async () => {
    const initialLoad = createDeferred<PluginSnapshot>()
    const stagedLoad = createDeferred<PluginSnapshot>()
    const activationGate = createDeferred<void>()
    const activationStarted = createDeferred<void>()
    Object.assign(globalThis, {
      __pluginProviderAuthorityRaceGate: activationGate.promise,
      __pluginProviderAuthorityRaceStarted: activationStarted.resolve
    })
    mocks.listPluginSnapshot
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(stagedLoad.promise)

    await renderInitialSnapshot(initialLoad)
    const serverKey = resolveMarketplaceServerKey(latestContext?.pluginServerBaseUrl)
    const stagedAuthority = claimMarketplaceConvergenceAuthority(serverKey)
    let stagedRefresh!: ReturnType<PluginContextValue['refreshPlugins']>
    await act(async () => {
      stagedRefresh = latestContext!.refreshPlugins({ isCurrent: stagedAuthority.runtime.isCurrent })
      stagedLoad.resolve({
        plugins: [
          createInstance(
            'retained-a',
            encodeModule(`
            export async function activatePlugin(ctx) {
              ctx.routes.register({ id: 'retained-a-before', viewId: 'retained-a-before-view' })
              globalThis.__pluginProviderAuthorityRaceStarted()
              await globalThis.__pluginProviderAuthorityRaceGate
              ctx.routes.register({ id: 'retained-a-after', viewId: 'retained-a-after-view' })
            }
          `)
          ),
          createInstance(
            'retained-b',
            encodeModule(`
            export function activatePlugin(ctx) {
              ctx.routes.register({ id: 'retained-b', viewId: 'retained-b-view' })
            }
          `)
          )
        ],
        runtime: createRuntime('runtime-last-good')
      })
      await stagedLoad.promise
      await activationStarted.promise
    })

    claimMarketplaceConvergenceAuthority(serverKey)
    expect(stagedAuthority.runtime.isCurrent()).toBe(false)
    await expect(Promise.reject(new Error('source config patch failed'))).rejects.toThrow(
      'source config patch failed'
    )
    await act(async () => {
      activationGate.resolve()
      await activationGate.promise
      await stagedRefresh
    })
    await flushPromises()

    expect(latestContext?.runtimeEndpoint?.id).toBe('runtime-last-good')
    expect(latestContext?.snapshot.instances.map(instance => instance.scope)).toEqual([
      'retained-a',
      'retained-b'
    ])
    expect(latestContext?.snapshot.routes.map(route => route.id).sort()).toEqual([
      'retained-a-after',
      'retained-a-before',
      'retained-b'
    ])
  })
})
