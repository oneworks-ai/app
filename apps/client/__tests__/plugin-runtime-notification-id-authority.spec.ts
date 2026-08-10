import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  NotificationApi,
  UiNotificationActionContext,
  UiNotificationInput
} from '#~/notifications/notification-types'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'
import { PluginRegistry } from '#~/plugins/plugin-registry'
import type { PluginClientContext } from '#~/plugins/plugin-runtime'
import { activatePluginClient } from '#~/plugins/plugin-runtime'

const contextKey = '__pluginRuntimeBlankNotificationContext'
const encodeModule = (source: string) => `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('plugin runtime blank notification identity authority', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, contextKey)
  })

  it('generates distinct tracked ids and preserves exact action and cleanup authority', async () => {
    let generatedId = 0
    const visible = new Map<string, { close: () => void; input: UiNotificationInput }>()
    const closes: Array<ReturnType<typeof vi.fn>> = []
    const hostInputs: UiNotificationInput[] = []
    const show = vi.fn((input: UiNotificationInput) => {
      const id = input.id ?? `generated-${++generatedId}`
      const hostInput = { ...input, id }
      const close = vi.fn(() => {
        if (visible.get(id)?.close === close) visible.delete(id)
      })
      closes.push(close)
      hostInputs.push(hostInput)
      visible.set(id, { close, input: hostInput })
      return { close, id }
    })
    const notifications: NotificationApi = {
      close: vi.fn(),
      isSourceMuted: vi.fn(() => false),
      muteSource: vi.fn(),
      show,
      unmuteSource: vi.fn()
    }
    const registry = new PluginRegistry()
    const instance: PluginRuntimeInstance = {
      clientEntryUrl: encodeModule(`
        export function activatePlugin(ctx) {
          globalThis[${JSON.stringify(contextKey)}] = ctx
        }
      `),
      requestId: 'blank-notification-id',
      scope: 'blank-notification-id'
    }
    await activatePluginClient({
      getImportVersion: () => 0,
      instance,
      notifications,
      registry,
      reloadPlugin: vi.fn()
    })
    const ctx = Reflect.get(globalThis, contextKey) as PluginClientContext
    const runHostAction = async (input: UiNotificationInput | undefined) => {
      const action = input?.actions?.[0]
      if (input == null || action == null) throw new Error('Expected notification action')
      const closeById = vi.fn(() => visible.delete(input.id ?? ''))
      const muteBySource = vi.fn()
      await action.onClick?.({
        close: closeById,
        id: input.id ?? '',
        muteSource: muteBySource,
        source: input.source ?? { id: 'fallback', kind: 'host', title: 'Fallback' }
      })
      if (action.closeOnClick !== false) closeById()
      return { closeById, muteBySource }
    }

    const deferred = createDeferred<void>()
    const staleAction = vi.fn(async (actionContext: UiNotificationActionContext) => {
      await deferred.promise
      actionContext.muteSource()
      actionContext.close()
    })
    const firstHandle = ctx.notifications.show({
      actions: [{ id: 'stale', onClick: staleAction, title: 'Stale' }],
      id: '',
      title: 'First',
      ttlMs: null
    })
    const firstRun = runHostAction(hostInputs[0])
    await Promise.resolve()
    const stayAction = vi.fn()
    ctx.notifications.show({
      actions: [{ closeOnClick: false, id: 'stay', onClick: stayAction, title: 'Stay' }],
      id: ' \t ',
      title: 'Second',
      ttlMs: null
    })

    expect(show.mock.calls[0]?.[0].id).toBeUndefined()
    expect(show.mock.calls[1]?.[0].id).toBeUndefined()
    expect(firstHandle.id).toBe('generated-1')
    expect([...visible.keys()]).toEqual(['generated-1', 'generated-2'])
    firstHandle.close()
    deferred.resolve()
    const staleHost = await firstRun
    expect(staleHost.closeById).not.toHaveBeenCalled()
    expect(staleHost.muteBySource).not.toHaveBeenCalled()
    expect(notifications.muteSource).not.toHaveBeenCalled()
    expect([...visible.keys()]).toEqual(['generated-2'])

    await runHostAction(hostInputs[1])
    expect(stayAction).toHaveBeenCalledTimes(1)
    expect(visible.has('generated-2')).toBe(true)

    const defaultAction = vi.fn()
    ctx.notifications.show({
      actions: [{ id: 'default', onClick: defaultAction, title: 'Default' }],
      id: '\n',
      title: 'Third'
    })
    expect(show.mock.calls[2]?.[0].id).toBeUndefined()
    await runHostAction(hostInputs[2])
    expect(defaultAction).toHaveBeenCalledTimes(1)
    expect(closes[2]).toHaveBeenCalledTimes(1)
    expect(visible.has('generated-3')).toBe(false)

    vi.mocked(notifications.isSourceMuted).mockReturnValue(true)
    show.mockImplementationOnce(input => ({ close: vi.fn(), id: input.id ?? 'muted-generated' }))
    const mutedHandle = ctx.notifications.show({ id: '  ', title: 'Muted' })
    expect(show.mock.calls[3]?.[0].id).toBeUndefined()
    expect(mutedHandle.id).toBe('muted-generated')
    expect(mutedHandle.id).not.toBe('')

    registry.disposeScope('blank-notification-id')
    expect(closes[1]).toHaveBeenCalledTimes(1)
    expect(visible.size).toBe(0)
    const hostCallCount = show.mock.calls.length
    const staleHandle = ctx.notifications.show({ id: '', title: 'Stale' })
    const secondStaleHandle = ctx.notifications.show({ id: '\t', title: 'Second stale' })
    expect(staleHandle.id).not.toBe('')
    expect(secondStaleHandle.id).not.toBe('')
    expect(secondStaleHandle.id).not.toBe(staleHandle.id)
    expect(show).toHaveBeenCalledTimes(hostCallCount)
    staleHandle.close()
    secondStaleHandle.close()
  })

  it('returns unique non-empty inert ids from the active private no-op adapter', async () => {
    const registry = new PluginRegistry()
    const instance: PluginRuntimeInstance = {
      clientEntryUrl: encodeModule(`
        export function activatePlugin(ctx) {
          globalThis[${JSON.stringify(contextKey)}] = ctx
        }
      `),
      requestId: 'private-noop-notification-id',
      scope: 'private-noop-notification-id'
    }
    await activatePluginClient({
      getImportVersion: () => 0,
      instance,
      registry,
      reloadPlugin: vi.fn()
    })
    const ctx = Reflect.get(globalThis, contextKey) as PluginClientContext
    const first = ctx.notifications.show({ id: '', title: 'First no-op' })
    const second = ctx.notifications.show({ id: ' ', title: 'Second no-op' })

    expect(first.id).not.toBe('')
    expect(second.id).not.toBe('')
    expect(second.id).not.toBe(first.id)
    first.close()
    second.close()
    registry.disposeScope('private-noop-notification-id')
  })
})
