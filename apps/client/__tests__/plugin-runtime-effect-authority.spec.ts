/* eslint-disable max-lines -- effect authority races share one activation and owner-lifecycle fixture. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '#~/i18n'
import type {
  NotificationApi,
  UiNotificationActionContext,
  UiNotificationInput
} from '#~/notifications/notification-types'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'
import { PluginRegistry } from '#~/plugins/plugin-registry'
import type { PluginClientContext } from '#~/plugins/plugin-runtime'
import { activatePluginClient } from '#~/plugins/plugin-runtime'

const encodeModule = (source: string) => `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const createInstance = (
  contextKey = '__pluginRuntimeEffectContext',
  requestId = 'effect-authority',
  scope = 'effect-authority'
): PluginRuntimeInstance => ({
  clientEntryUrl: encodeModule(`
    export function activatePlugin(ctx) {
      globalThis[${JSON.stringify(contextKey)}] = ctx
    }
  `),
  requestId,
  scope
})

const readContext = (key = '__pluginRuntimeEffectContext') => Reflect.get(globalThis, key) as PluginClientContext

const createNotificationApi = (show: NotificationApi['show']): NotificationApi => ({
  close: vi.fn(),
  isSourceMuted: vi.fn(() => false),
  muteSource: vi.fn(),
  show,
  unmuteSource: vi.fn()
})

describe('plugin runtime effect authority', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(globalThis, '__pluginRuntimeEffectContext')
    Reflect.deleteProperty(globalThis, '__pluginRuntimeOldContext')
    Reflect.deleteProperty(globalThis, '__pluginRuntimeNewContext')
    Reflect.deleteProperty(globalThis, '__pluginRuntimePluginAContext')
    Reflect.deleteProperty(globalThis, '__pluginRuntimePluginBContext')
    Reflect.deleteProperty(globalThis, '__pendingRollbackPluginApiCall')
  })

  const activate = async ({
    instance = createInstance(),
    notifications,
    registry = new PluginRegistry(),
    reloadPlugin = vi.fn(async () => undefined)
  }: {
    instance?: PluginRuntimeInstance
    notifications?: NotificationApi
    registry?: PluginRegistry
    reloadPlugin?: (scope: string) => Promise<void>
  } = {}) => {
    await activatePluginClient({
      getImportVersion: () => 0,
      instance,
      notifications,
      registry,
      reloadPlugin
    })
    return { ctx: readContext(), registry, reloadPlugin }
  }

  it('rejects every effectful activation API after its owner is disposed', async () => {
    const { ctx, registry, reloadPlugin } = await activate()
    registry.disposeScope('effect-authority')

    await expect(ctx.api.fetch('/late')).rejects.toThrow('no longer active')
    await expect(ctx.commands.execute('late')).rejects.toThrow('no longer active')
    await expect(ctx.pluginApis.call('target/api')).rejects.toThrow('no longer active')
    await expect(ctx.runtime.invokeChannel('late')).rejects.toThrow('no longer active')
    await expect(ctx.runtime.listEndpoints()).rejects.toThrow('no longer active')
    await expect(ctx.hot.reload()).rejects.toThrow('no longer active')
    expect(fetch).not.toHaveBeenCalled()
    expect(reloadPlugin).not.toHaveBeenCalled()
  })

  it('resolves a self-invalidating reload and leaves only the replacement activation authoritative', async () => {
    const registry = new PluginRegistry()
    const replacementReload = vi.fn(async () => undefined)
    const reloadPlugin = vi.fn(async (scope: string) => {
      registry.disposeScope(scope)
      await activatePluginClient({
        getImportVersion: () => 1,
        instance: createInstance('__pluginRuntimeNewContext', 'reload-replacement'),
        registry,
        reloadPlugin: replacementReload
      })
    })
    const { ctx: oldContext } = await activate({ registry, reloadPlugin })

    await expect(oldContext.hot.reload()).resolves.toBeUndefined()
    const newContext = readContext('__pluginRuntimeNewContext')
    expect(reloadPlugin).toHaveBeenCalledWith('effect-authority')
    await expect(oldContext.hot.reload()).rejects.toThrow('no longer active')
    expect(reloadPlugin).toHaveBeenCalledTimes(1)
    await expect(newContext.hot.reload()).resolves.toBeUndefined()
    expect(replacementReload).toHaveBeenCalledTimes(1)
  })

  it('does not emit an unhandled rejection when a successful self-invalidating reload is discarded', async () => {
    const registry = new PluginRegistry()
    const reloaded = createDeferred<void>()
    const reloadPlugin = vi.fn(async (scope: string) => {
      registry.disposeScope(scope)
      reloaded.resolve()
    })
    const { ctx } = await activate({ registry, reloadPlugin })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      void ctx.hot.reload()
      await reloaded.promise
      await Promise.resolve()
      await Promise.resolve()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('propagates a hot reload implementation failure without invalidating its owner', async () => {
    const failure = new Error('reload implementation failed')
    const reloadPlugin = vi.fn(async () => {
      throw failure
    })
    const { ctx } = await activate({ reloadPlugin })

    await expect(ctx.hot.reload()).rejects.toBe(failure)
    await expect(ctx.api.fetch('/still-current')).resolves.toBeUndefined()
    expect(reloadPlugin).toHaveBeenCalledTimes(1)
  })

  it('aborts in-flight fetch and command results when activation authority is revoked', async () => {
    const { ctx, registry } = await activate()
    const fetchResult = createDeferred<Response>()
    const endpointsResult = createDeferred<Response>()
    const commandResult = createDeferred<unknown>()
    let requestSignal: AbortSignal | undefined
    let endpointsSignal: AbortSignal | undefined
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/plugins/runtime/endpoints')) {
        endpointsSignal = init?.signal ?? undefined
        return await endpointsResult.promise
      }
      requestSignal = init?.signal ?? undefined
      return await fetchResult.promise
    })
    ctx.commands.register('slow', () => commandResult.promise)

    const request = ctx.api.fetch('/slow')
    const endpoints = ctx.runtime.listEndpoints()
    const command = ctx.commands.execute('slow')
    const requestRejection = expect(request).rejects.toThrow('no longer active')
    const endpointsRejection = expect(endpoints).rejects.toThrow('no longer active')
    const commandRejection = expect(command).rejects.toThrow('no longer active')
    await Promise.resolve()
    await Promise.resolve()
    registry.disposeScope('effect-authority')

    expect(requestSignal?.aborted).toBe(true)
    expect(endpointsSignal?.aborted).toBe(true)
    await Promise.all([requestRejection, endpointsRejection, commandRejection])
    fetchResult.resolve(new Response('{}'))
    endpointsResult.resolve(new Response('{}'))
    commandResult.resolve(undefined)
  })

  it('owns i18n subscriptions and refuses new listeners after activation disposal', async () => {
    const { ctx, registry } = await activate()
    const listener = vi.fn()
    const lateListener = vi.fn()
    ctx.i18n.subscribe(listener)

    i18n.emit('languageChanged', 'fr')
    expect(listener).toHaveBeenCalledTimes(1)
    registry.disposeScope('effect-authority')
    ctx.i18n.subscribe(lateListener)
    i18n.emit('languageChanged', 'de')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(lateListener).not.toHaveBeenCalled()
  })

  it('closes persistent owned notifications during invalidation and leaves their actions inert', async () => {
    const close = vi.fn()
    const show = vi.fn((_input: UiNotificationInput) => ({ close, id: 'persistent' }))
    const notifications = createNotificationApi(show)
    const { ctx, registry } = await activate({ notifications })
    const action = vi.fn()
    const handle = ctx.notifications.show({
      actions: [{ id: 'run', onClick: action, title: 'Run' }],
      id: 'persistent',
      title: 'Persistent',
      ttlMs: null
    })
    const shown = show.mock.calls[0]?.[0]
    const actionContext = {
      close: vi.fn(),
      id: 'persistent',
      muteSource: vi.fn(),
      source: shown?.source ?? { id: 'fallback', kind: 'host' as const, title: 'Fallback' }
    }

    expect(shown?.ttlMs).toBeNull()
    registry.disposeScope('effect-authority')
    expect(close).toHaveBeenCalledTimes(1)
    await shown?.actions?.[0]?.onClick?.(actionContext)
    handle.close()
    ctx.notifications.close('persistent')
    ctx.notifications.muteCurrentPlugin()
    ctx.notifications.show({ title: 'Stale' })

    expect(action).not.toHaveBeenCalled()
    expect(actionContext.close).not.toHaveBeenCalled()
    expect(actionContext.muteSource).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
    expect(notifications.close).not.toHaveBeenCalled()
    expect(notifications.muteSource).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('prevents stale cleanup from closing a newer activation notification with the same id', async () => {
    const registry = new PluginRegistry()
    const oldClose = vi.fn()
    const newClose = vi.fn()
    const show = vi.fn()
      .mockReturnValueOnce({ close: oldClose, id: 'shared' })
      .mockReturnValueOnce({ close: newClose, id: 'shared' })
    const notifications = createNotificationApi(show)
    const checkpoint = vi.spyOn(registry, 'createScopeRegistrationCheckpoint')
    await activatePluginClient({
      getImportVersion: () => 0,
      instance: createInstance('__pluginRuntimeOldContext', 'old-authority'),
      notifications,
      registry,
      reloadPlugin: vi.fn()
    })
    const oldOwner = checkpoint.mock.results[0]?.value
    const oldContext = readContext('__pluginRuntimeOldContext')
    const oldHandle = oldContext.notifications.show({ id: 'shared', title: 'Old' })
    const newAction = vi.fn()
    await activatePluginClient({
      getImportVersion: () => 0,
      instance: createInstance('__pluginRuntimeNewContext', 'new-authority'),
      notifications,
      registry,
      reloadPlugin: vi.fn()
    })
    const newContext = readContext('__pluginRuntimeNewContext')
    newContext.notifications.show({
      actions: [{ id: 'run', onClick: newAction, title: 'Run' }],
      id: 'shared',
      title: 'New'
    })
    const shownNew = show.mock.calls[1]?.[0]

    if (oldOwner == null) throw new Error('Expected old activation owner')
    registry.rollbackScopeRegistrations('effect-authority', oldOwner)
    oldHandle.close()
    oldContext.notifications.close('shared')
    expect(oldClose).not.toHaveBeenCalled()
    expect(newClose).not.toHaveBeenCalled()
    await shownNew?.actions?.[0]?.onClick?.({
      close: vi.fn(),
      id: 'shared',
      muteSource: vi.fn(),
      source: shownNew.source ?? { id: 'fallback', kind: 'host', title: 'Fallback' }
    })
    expect(newAction).toHaveBeenCalledTimes(1)

    registry.disposeScope('effect-authority')
    expect(newClose).toHaveBeenCalledTimes(1)
    await shownNew?.actions?.[0]?.onClick?.({
      close: vi.fn(),
      id: 'shared',
      muteSource: vi.fn(),
      source: shownNew.source ?? { id: 'fallback', kind: 'host', title: 'Fallback' }
    })
    expect(newAction).toHaveBeenCalledTimes(1)
  })

  it('isolates identical plugin-local notification ids across activation owners', async () => {
    const registry = new PluginRegistry()
    const visible = new Map<string, { close: () => void; input: UiNotificationInput }>()
    const show = vi.fn((input: UiNotificationInput) => {
      if (input.id == null) throw new Error('Expected an owner-scoped host notification id')
      const close = vi.fn(() => {
        if (visible.get(input.id!)?.close === close) visible.delete(input.id!)
      })
      visible.set(input.id, { close, input })
      return { close, id: input.id }
    })
    const notifications = createNotificationApi(show)
    await activatePluginClient({
      getImportVersion: () => 0,
      instance: createInstance('__pluginRuntimePluginAContext', 'plugin-a', 'plugin-a'),
      notifications,
      registry,
      reloadPlugin: vi.fn()
    })
    await activatePluginClient({
      getImportVersion: () => 0,
      instance: createInstance('__pluginRuntimePluginBContext', 'plugin-b', 'plugin-b'),
      notifications,
      registry,
      reloadPlugin: vi.fn()
    })
    const pluginA = readContext('__pluginRuntimePluginAContext')
    const pluginB = readContext('__pluginRuntimePluginBContext')
    const actionA = vi.fn()
    const actionB = vi.fn()
    const handleA = pluginA.notifications.show({
      actions: [{ id: 'run-a', onClick: actionA, title: 'Run A' }],
      id: 'shared',
      title: 'Plugin A',
      ttlMs: null
    })
    const handleB = pluginB.notifications.show({
      actions: [{ closeOnClick: false, id: 'run-b', onClick: actionB, title: 'Run B' }],
      id: 'shared',
      title: 'Plugin B',
      ttlMs: null
    })
    const shownA = show.mock.calls[0]?.[0]
    const shownB = show.mock.calls[1]?.[0]

    expect(handleA.id).toBe('shared')
    expect(handleB.id).toBe('shared')
    expect(shownA?.id).not.toBe('shared')
    expect(shownB?.id).not.toBe('shared')
    expect(shownB?.id).not.toBe(shownA?.id)
    expect(visible.size).toBe(2)

    registry.disposeScope('plugin-a')
    expect(visible.has(shownA?.id ?? '')).toBe(false)
    expect(visible.has(shownB?.id ?? '')).toBe(true)
    await shownA?.actions?.[0]?.onClick?.({
      close: vi.fn(),
      id: shownA.id ?? '',
      muteSource: vi.fn(),
      source: shownA.source ?? { id: 'fallback', kind: 'host', title: 'Fallback' }
    })
    handleA.close()
    pluginA.notifications.close('shared')
    expect(actionA).not.toHaveBeenCalled()
    expect(visible.has(shownB?.id ?? '')).toBe(true)

    await shownB?.actions?.[0]?.onClick?.({
      close: vi.fn(),
      id: shownB.id ?? '',
      muteSource: vi.fn(),
      source: shownB.source ?? { id: 'fallback', kind: 'host', title: 'Fallback' }
    })
    expect(actionB).toHaveBeenCalledTimes(1)
    expect(visible.has(shownB?.id ?? '')).toBe(true)
    pluginB.notifications.close('shared')
    expect(visible.size).toBe(0)
    registry.disposeScope('plugin-b')
  })

  it('prevents stale same-id async actions from closing or muting their replacement', async () => {
    const closes: Array<ReturnType<typeof vi.fn>> = []
    const show = vi.fn((input: UiNotificationInput) => {
      const close = vi.fn()
      closes.push(close)
      return { close, id: input.id ?? `generated-${closes.length}` }
    })
    const notifications = createNotificationApi(show)
    const { ctx, registry } = await activate({ notifications })
    const runHostAction = async (shown: UiNotificationInput | undefined) => {
      const action = shown?.actions?.[0]
      if (shown == null || action == null) throw new Error('Expected notification action')
      const closeById = vi.fn()
      const muteBySource = vi.fn()
      let error: unknown
      try {
        await action.onClick?.({
          close: closeById,
          id: shown.id ?? 'shared',
          muteSource: muteBySource,
          source: shown.source ?? { id: 'fallback', kind: 'host', title: 'Fallback' }
        })
        if (action.closeOnClick !== false) closeById()
      } catch (caught) {
        error = caught
      }
      return { closeById, error, muteBySource }
    }

    const resolveAction = createDeferred<void>()
    const oldResolveAction = vi.fn(async (actionContext: UiNotificationActionContext) => {
      await resolveAction.promise
      actionContext.muteSource()
      actionContext.close()
    })
    ctx.notifications.show({
      actions: [{ id: 'old-resolve', onClick: oldResolveAction, title: 'Old resolve' }],
      id: 'shared',
      title: 'Old resolve'
    })
    const oldResolveRun = runHostAction(show.mock.calls[0]?.[0])
    await Promise.resolve()
    expect(oldResolveAction).toHaveBeenCalledTimes(1)
    ctx.notifications.show({ id: 'shared', title: 'First replacement' })
    resolveAction.resolve()
    const oldResolveHost = await oldResolveRun

    expect(oldResolveHost.closeById).not.toHaveBeenCalled()
    expect(oldResolveHost.muteBySource).not.toHaveBeenCalled()
    expect(notifications.muteSource).not.toHaveBeenCalled()
    expect(closes[0]).not.toHaveBeenCalled()
    expect(closes[1]).not.toHaveBeenCalled()

    const rejectAction = createDeferred<void>()
    const oldRejectAction = vi.fn(async () => {
      await rejectAction.promise
      throw new Error('stale rejection')
    })
    ctx.notifications.show({
      actions: [{ id: 'old-reject', onClick: oldRejectAction, title: 'Old reject' }],
      id: 'shared',
      title: 'Old reject'
    })
    const oldRejectRun = runHostAction(show.mock.calls[2]?.[0])
    await Promise.resolve()
    expect(oldRejectAction).toHaveBeenCalledTimes(1)
    const newAction = vi.fn()
    ctx.notifications.show({
      actions: [{ id: 'new', onClick: newAction, title: 'New', tone: 'primary' }],
      id: 'shared',
      title: 'New'
    })
    const newShown = show.mock.calls[3]?.[0]
    rejectAction.resolve()
    const oldRejectHost = await oldRejectRun

    expect(oldRejectHost.error).toBeUndefined()
    expect(oldRejectHost.closeById).not.toHaveBeenCalled()
    expect(closes[2]).not.toHaveBeenCalled()
    expect(closes[3]).not.toHaveBeenCalled()

    const newHost = await runHostAction(newShown)
    expect(newShown?.actions?.[0]?.tone).toBe('primary')
    expect(newAction).toHaveBeenCalledTimes(1)
    expect(closes[3]).toHaveBeenCalledTimes(1)
    expect(newHost.closeById).not.toHaveBeenCalled()

    const stayAction = vi.fn()
    const stayHandle = ctx.notifications.show({
      actions: [{ closeOnClick: false, id: 'stay', onClick: stayAction, title: 'Stay' }],
      id: 'stay',
      title: 'Stay'
    })
    await runHostAction(show.mock.calls[4]?.[0])
    expect(stayAction).toHaveBeenCalledTimes(1)
    expect(closes[4]).not.toHaveBeenCalled()
    stayHandle.close()
    expect(closes[4]).toHaveBeenCalledTimes(1)

    ctx.notifications.show({
      actions: [{
        id: 'mute',
        onClick: actionContext => actionContext.muteSource(),
        title: 'Mute'
      }],
      id: 'mute',
      title: 'Mute'
    })
    await runHostAction(show.mock.calls[5]?.[0])
    expect(notifications.muteSource).toHaveBeenCalledTimes(1)
    registry.disposeScope('effect-authority')
  })

  it('bounds notification ownership across finite churn, muted no-ops, replacement, and disposal', async () => {
    const registry = new PluginRegistry()
    const hostCloses: Array<ReturnType<typeof vi.fn>> = []
    const show = vi.fn((input: UiNotificationInput) => {
      const close = vi.fn()
      hostCloses.push(close)
      return { close, id: input.id ?? `generated-${hostCloses.length}` }
    })
    const notifications = createNotificationApi(show)
    const addDisposable = vi.spyOn(registry, 'addDisposable')
    const { ctx } = await activate({ notifications, registry })
    const disposableCount = addDisposable.mock.calls.length
    const staleAction = vi.fn()
    const finiteHandles = Array.from({ length: 200 }, (_, index) =>
      ctx.notifications.show({
        ...(index === 0
          ? { actions: [{ id: 'stale', onClick: staleAction, title: 'Stale' }] }
          : {}),
        id: `finite-${index}`,
        title: `Finite ${index}`,
        ttlMs: 1
      }))
    const staleShown = show.mock.calls[0]?.[0]

    expect(addDisposable).toHaveBeenCalledTimes(disposableCount)
    finiteHandles.slice(-10).forEach(handle => handle.close())
    hostCloses.slice(190, 200).forEach(close => expect(close).toHaveBeenCalledTimes(1))

    const replacementHandles = Array.from(
      { length: 100 },
      (_, index) => ctx.notifications.show({ id: 'shared', title: `Replacement ${index}`, ttlMs: null })
    )
    replacementHandles[0]?.close()
    expect(hostCloses[200]).not.toHaveBeenCalled()
    expect(hostCloses[299]).not.toHaveBeenCalled()

    vi.mocked(notifications.isSourceMuted).mockReturnValue(true)
    const mutedHandles = Array.from(
      { length: 200 },
      (_, index) => ctx.notifications.show({ id: `muted-${index}`, title: `Muted ${index}` })
    )
    expect(mutedHandles.every(handle => handle.id !== '')).toBe(true)
    expect(addDisposable).toHaveBeenCalledTimes(disposableCount)
    vi.mocked(notifications.isSourceMuted).mockReturnValue(false)

    const explicit = ctx.notifications.show({ id: 'explicit', title: 'Explicit' })
    explicit.close()
    explicit.close()
    expect(hostCloses[500]).toHaveBeenCalledTimes(1)

    registry.disposeScope('effect-authority')
    await staleShown?.actions?.[0]?.onClick?.({
      close: vi.fn(),
      id: 'finite-0',
      muteSource: vi.fn(),
      source: staleShown.source ?? { id: 'fallback', kind: 'host', title: 'Fallback' }
    })
    expect(staleAction).not.toHaveBeenCalled()
    hostCloses.slice(176, 190).forEach(close => expect(close).toHaveBeenCalledTimes(1))
    expect(hostCloses[299]).toHaveBeenCalledTimes(1)
    hostCloses.slice(300, 500).forEach(close => expect(close).not.toHaveBeenCalled())
    expect(addDisposable).toHaveBeenCalledTimes(disposableCount)

    const { ctx: nextContext } = await activate({ notifications, registry })
    const newSharedHandle = nextContext.notifications.show({ id: 'shared', title: 'New owner' })
    const newSharedClose = hostCloses[501]
    replacementHandles.at(-1)?.close()
    finiteHandles[0]?.close()
    expect(newSharedClose).not.toHaveBeenCalled()
    newSharedHandle.close()
    expect(newSharedClose).toHaveBeenCalledTimes(1)
    registry.disposeScope('effect-authority')
  })

  it('removes a queued plugin API call when its activation owner is disposed', async () => {
    const { ctx, registry } = await activate()
    const handler = vi.fn(() => 'late result')
    const pending = ctx.pluginApis.call('target/late')
    const rejection = expect(pending).rejects.toThrow('no longer active')

    registry.disposeScope('effect-authority')
    registry.registerPluginApi('target', { handler, id: 'late' })

    await rejection
    expect(handler).not.toHaveBeenCalled()
  })

  it('preserves target API late registration, rejection, and disposal semantics', async () => {
    const { ctx, registry } = await activate()
    const readyHandler = vi.fn(() => 'ready result')
    const ready = ctx.pluginApis.call('target/ready')
    registry.registerPluginApi('target', { handler: readyHandler, id: 'ready' })
    await expect(ready).resolves.toBe('ready result')
    expect(readyHandler).toHaveBeenCalledTimes(1)

    const rejected = ctx.pluginApis.call('target/rejected')
    registry.registerPluginApi('target', {
      handler: () => Promise.reject(new Error('target rejected')),
      id: 'rejected'
    })
    await expect(rejected).rejects.toThrow('target rejected')

    const disposedHandler = vi.fn(() => 'disposed result')
    const disposable = registry.registerPluginApi('target', {
      handler: disposedHandler,
      id: 'disposed'
    })
    disposable.dispose()
    await expect(ctx.pluginApis.call('target/disposed', undefined, { timeoutMs: 1 }))
      .rejects.toThrow('Timed out waiting for plugin API')
    expect(disposedHandler).not.toHaveBeenCalled()
  })

  it('removes a queued plugin API call when activation rolls back', async () => {
    const registry = new PluginRegistry()
    const handler = vi.fn(() => 'late result')
    const instance: PluginRuntimeInstance = {
      clientEntryUrl: encodeModule(`
        export function activatePlugin(ctx) {
          const pending = ctx.pluginApis.call('target/late')
          pending.catch(() => undefined)
          globalThis.__pendingRollbackPluginApiCall = pending
          throw new Error('rollback activation')
        }
      `),
      requestId: 'rollback-authority',
      scope: 'rollback-authority'
    }
    await activatePluginClient({
      getImportVersion: () => 0,
      instance,
      registry,
      reloadPlugin: vi.fn()
    })
    const pending = Reflect.get(globalThis, '__pendingRollbackPluginApiCall') as Promise<unknown>

    registry.registerPluginApi('target', { handler, id: 'late' })

    await expect(pending).rejects.toThrow('no longer active')
    expect(handler).not.toHaveBeenCalled()
  })
})
