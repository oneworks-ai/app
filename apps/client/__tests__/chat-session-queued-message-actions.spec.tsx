import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessageContent, Session, SessionMessageQueueState, SessionQueuedMessageMode } from '@oneworks/core'

import { useChatSessionActions } from '#~/hooks/chat/use-chat-session-actions'
import * as chatSessionMessages from '#~/hooks/chat/use-chat-session-messages'

const mocks = vi.hoisted(() => ({
  branchSessionFromMessage: vi.fn(),
  createQueuedMessage: vi.fn(),
  createSession: vi.fn(),
  deleteQueuedMessage: vi.fn(),
  deleteSession: vi.fn(),
  getSessionMessages: vi.fn(),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
  moveQueuedMessage: vi.fn(),
  mutate: vi.fn(),
  navigate: vi.fn(),
  reorderQueuedMessages: vi.fn(),
  sendSessionMessage: vi.fn(),
  setHeaderCollapsed: vi.fn(),
  setOptimisticCreations: vi.fn(),
  t: (key: string) => key,
  updateQueuedMessage: vi.fn()
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: mocks.messageError,
        warning: mocks.messageWarning
      }
    })
  }
}))

vi.mock('jotai', () => ({
  atom: (value: unknown) => ({ value }),
  useAtomValue: () => ({}),
  useSetAtom: () => mocks.setOptimisticCreations
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.t
  })
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ search: '' }),
  useNavigate: () => mocks.navigate
}))

vi.mock('swr', () => ({
  useSWRConfig: () => ({
    mutate: mocks.mutate
  })
}))

vi.mock('#~/api.js', () => ({
  branchSessionFromMessage: mocks.branchSessionFromMessage,
  createQueuedMessage: mocks.createQueuedMessage,
  createSession: mocks.createSession,
  deleteQueuedMessage: mocks.deleteQueuedMessage,
  deleteSession: mocks.deleteSession,
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getSessionMessages: mocks.getSessionMessages,
  moveQueuedMessage: mocks.moveQueuedMessage,
  reorderQueuedMessages: mocks.reorderQueuedMessages,
  sendSessionMessage: mocks.sendSessionMessage,
  updateQueuedMessage: mocks.updateQueuedMessage
}))

vi.mock('#~/connectionManager.js', () => ({
  connectionManager: {
    close: vi.fn(),
    connect: vi.fn(() => vi.fn()),
    send: vi.fn()
  }
}))

vi.mock('#~/hooks/use-sender-header-query-state.js', () => ({
  useSenderHeaderQueryState: () => ({
    setHeaderCollapsed: mocks.setHeaderCollapsed
  })
}))

vi.mock('#~/ws.js', () => ({
  createSocket: vi.fn()
}))

const session = {
  id: 'session-1',
  createdAt: 1,
  status: 'completed',
  title: 'Queued messages'
} as Session

const textContent = (text: string): ChatMessageContent[] => [{ type: 'text', text }]

const queueItem = (
  id: string,
  mode: SessionQueuedMessageMode,
  text: string,
  order = 0,
  sessionId = session.id
): SessionMessageQueueState[SessionQueuedMessageMode][number] => ({
  id,
  sessionId,
  mode,
  content: textContent(text),
  createdAt: order + 1,
  updatedAt: order + 2,
  order
})

const queueState = (
  steer: Array<ReturnType<typeof queueItem>>,
  next: Array<ReturnType<typeof queueItem>>
): SessionMessageQueueState => ({
  steer,
  next
})

const renderActions = () => {
  let actions: ReturnType<typeof useChatSessionActions> | undefined

  function Harness() {
    actions = useChatSessionActions({
      session,
      modelForQuery: 'codex/test',
      hasAvailableModels: true,
      effort: 'default',
      permissionMode: 'default',
      onClearMessages: vi.fn()
    })
    return null
  }

  renderToStaticMarkup(<Harness />)

  if (actions == null) {
    throw new Error('useChatSessionActions did not render')
  }

  return actions
}

interface HookDispatcher {
  readContext: (...args: unknown[]) => unknown
  useCallback: (callback: unknown, deps: unknown[] | undefined) => unknown
  useContext: (...args: unknown[]) => unknown
  useDebugValue: (...args: unknown[]) => void
  useDeferredValue: (value: unknown) => unknown
  useEffect: (effect: () => void | (() => void), deps: unknown[] | undefined) => void
  useId: () => string
  useImperativeHandle: (...args: unknown[]) => void
  useInsertionEffect: (...args: unknown[]) => void
  useLayoutEffect: (effect: () => void | (() => void), deps: unknown[] | undefined) => void
  useMemo: (factory: () => unknown, deps: unknown[] | undefined) => unknown
  useReducer: (
    reducer: (state: unknown, action: unknown) => unknown,
    initialArg: unknown
  ) => [unknown, (action: unknown) => void]
  useRef: (initialValue: unknown) => { current: unknown }
  useState: (initialValue: unknown) => [unknown, (value: unknown) => void]
  useSyncExternalStore: (...args: unknown[]) => unknown
  useTransition: () => [boolean, (callback: () => void) => void]
}

interface ReactDispatcherInternals {
  ReactCurrentDispatcher: {
    current: HookDispatcher | null
  }
}

interface EffectSlot {
  cleanup?: () => void
  deps?: unknown[]
  effect?: () => void | (() => void)
  pending: boolean
}

const depsChanged = (previous: unknown[] | undefined, next: unknown[] | undefined) => {
  if (previous == null || next == null) {
    return true
  }
  if (previous.length !== next.length) {
    return true
  }
  return next.some((value, index) => !Object.is(value, previous[index]))
}

const getReactDispatcherRef = () => {
  return (React as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: ReactDispatcherInternals
  }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
}

const createHookHarness = <T,>(renderHook: () => T) => {
  const dispatcherRef = getReactDispatcherRef()
  const previousDispatcher = dispatcherRef.current
  const states: unknown[] = []
  const refs: Array<{ current: unknown }> = []
  const callbacks: Array<{ deps?: unknown[]; value: unknown }> = []
  const effects: EffectSlot[] = []
  let stateIndex = 0
  let refIndex = 0
  let callbackIndex = 0
  let effectIndex = 0
  let isMounted = false
  let isRendering = false
  let isFlushingEffects = false
  let isDirty = false
  let result: T

  const render = () => {
    stateIndex = 0
    refIndex = 0
    callbackIndex = 0
    effectIndex = 0
    isRendering = true
    dispatcherRef.current = dispatcher
    try {
      result = renderHook()
    } finally {
      dispatcherRef.current = previousDispatcher
      isRendering = false
    }
  }

  const flushEffects = () => {
    isFlushingEffects = true
    try {
      for (const effect of effects) {
        if (!effect.pending || effect.effect == null) {
          continue
        }
        effect.pending = false
        effect.cleanup?.()
        const cleanup = effect.effect()
        effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      }
    } finally {
      isFlushingEffects = false
    }
  }

  const rerender = () => {
    do {
      isDirty = false
      render()
      flushEffects()
    } while (isDirty)
  }

  const dispatcher: HookDispatcher = {
    readContext: () => null,
    useCallback: (callback: unknown, deps: unknown[] | undefined) => {
      const index = callbackIndex++
      const current = callbacks[index]
      if (current == null || depsChanged(current.deps, deps)) {
        callbacks[index] = { deps, value: callback }
      }
      return callbacks[index]?.value
    },
    useContext: () => null,
    useDebugValue: () => undefined,
    useDeferredValue: (value: unknown) => value,
    useEffect: (effect: () => void | (() => void), deps: unknown[] | undefined) => {
      const index = effectIndex++
      const current = effects[index]
      if (current == null) {
        effects[index] = { deps, effect, pending: true }
        return
      }
      if (!depsChanged(current.deps, deps)) {
        return
      }
      current.deps = deps
      current.effect = effect
      current.pending = true
    },
    useId: () => 'test-id',
    useImperativeHandle: () => undefined,
    useInsertionEffect: () => undefined,
    useLayoutEffect: (effect: () => void | (() => void), deps: unknown[] | undefined) => {
      dispatcher.useEffect(effect, deps)
    },
    useMemo: (factory: () => unknown, deps: unknown[] | undefined) => {
      return dispatcher.useCallback(factory(), deps)
    },
    useReducer: (reducer: (state: unknown, action: unknown) => unknown, initialArg: unknown) => {
      const [value, setValue] = dispatcher.useState(initialArg)
      return [value, (action: unknown) => setValue((current: unknown) => reducer(current, action))]
    },
    useRef: (initialValue: unknown) => {
      const index = refIndex++
      if (refs[index] == null) {
        refs[index] = { current: initialValue }
      }
      return refs[index]
    },
    useState: (initialValue: unknown) => {
      const index = stateIndex++
      if (!Object.hasOwn(states, index)) {
        states[index] = typeof initialValue === 'function'
          ? (initialValue as () => unknown)()
          : initialValue
      }
      const setValue = (value: unknown) => {
        const next = typeof value === 'function'
          ? (value as (current: unknown) => unknown)(states[index])
          : value
        if (Object.is(states[index], next)) {
          return
        }
        states[index] = next
        if (!isMounted || isRendering || isFlushingEffects) {
          isDirty = true
          return
        }
        rerender()
      }
      return [states[index], setValue]
    },
    useSyncExternalStore: () => undefined,
    useTransition: () => [false, (callback: () => void) => callback()]
  } as HookDispatcher

  rerender()
  isMounted = true

  return {
    cleanup: () => {
      for (const effect of effects) {
        effect.cleanup?.()
      }
      dispatcherRef.current = previousDispatcher
      isMounted = false
    },
    get result() {
      return result
    }
  }
}

describe('chat session queued message actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionMessages.mockReturnValue(new Promise(() => {}))
  })

  it('syncs the current session queue from successful queued message API responses', async () => {
    const actions = renderActions()
    const syncSessionQueuedMessagesSpy = vi.spyOn(chatSessionMessages, 'syncSessionQueuedMessages')
    const createQueue = queueState([queueItem('api-created', 'steer', 'created by server')], [])
    const updateQueue = queueState([queueItem('queued-1', 'steer', 'updated by server')], [])
    const deleteQueue = queueState([], [queueItem('server-kept-next', 'next', 'kept after delete')])
    const moveQueue = queueState([], [queueItem('queued-1', 'next', 'moved by server')])
    const reorderQueue = queueState(
      [queueItem('queued-b', 'steer', 'second from server', 0), queueItem('queued-a', 'steer', 'first from server', 1)],
      []
    )

    mocks.createQueuedMessage.mockResolvedValueOnce({ queuedMessages: createQueue })
    mocks.updateQueuedMessage.mockResolvedValueOnce({ queuedMessages: updateQueue })
    mocks.deleteQueuedMessage.mockResolvedValueOnce({ queuedMessages: deleteQueue })
    mocks.moveQueuedMessage.mockResolvedValueOnce({ queuedMessages: moveQueue })
    mocks.reorderQueuedMessages.mockResolvedValueOnce({ queuedMessages: reorderQueue })

    await expect(actions.enqueueContent('steer', textContent('draft create text'))).resolves.toBe(true)
    expect(mocks.createQueuedMessage).toHaveBeenCalledWith(session.id, 'steer', textContent('draft create text'))
    expect(syncSessionQueuedMessagesSpy).toHaveBeenLastCalledWith(session.id, createQueue)

    await expect(actions.updateQueuedContent('queued-1', textContent('draft update text'))).resolves.toBe(true)
    expect(mocks.updateQueuedMessage).toHaveBeenCalledWith(session.id, 'queued-1', textContent('draft update text'))
    expect(syncSessionQueuedMessagesSpy).toHaveBeenLastCalledWith(session.id, updateQueue)

    await expect(actions.removeQueuedContent('queued-1')).resolves.toBe(true)
    expect(mocks.deleteQueuedMessage).toHaveBeenCalledWith(session.id, 'queued-1')
    expect(syncSessionQueuedMessagesSpy).toHaveBeenLastCalledWith(session.id, deleteQueue)

    await expect(actions.moveQueuedContent('queued-1', 'next')).resolves.toBe(true)
    expect(mocks.moveQueuedMessage).toHaveBeenCalledWith(session.id, 'queued-1', 'next')
    expect(syncSessionQueuedMessagesSpy).toHaveBeenLastCalledWith(session.id, moveQueue)

    await expect(actions.reorderQueuedContent('steer', ['queued-b', 'queued-a'])).resolves.toBe(true)
    expect(mocks.reorderQueuedMessages).toHaveBeenCalledWith(session.id, 'steer', ['queued-b', 'queued-a'])
    expect(syncSessionQueuedMessagesSpy).toHaveBeenLastCalledWith(session.id, reorderQueue)
    expect(syncSessionQueuedMessagesSpy).toHaveBeenCalledTimes(5)
  })

  it('updates the mounted session queuedMessages from direct queue sync without leaking other sessions', () => {
    const setInteractionRequest = vi.fn()
    const harness = createHookHarness(() =>
      chatSessionMessages.useChatSessionMessages({
        session,
        modelForQuery: 'codex/test',
        effort: 'default',
        permissionMode: 'default',
        setInteractionRequest
      })
    )

    try {
      const syncedQueue = queueState([queueItem('synced-steer', 'steer', 'fresh steer card')], [
        queueItem('synced-next', 'next', 'fresh next card')
      ])
      const otherSessionQueue = queueState([queueItem('other-steer', 'steer', 'wrong session', 0, 'session-other')], [])

      expect(harness.result.queuedMessages).toEqual(queueState([], []))

      chatSessionMessages.syncSessionQueuedMessages('session-other', otherSessionQueue)
      expect(harness.result.queuedMessages).toEqual(queueState([], []))

      chatSessionMessages.syncSessionQueuedMessages(session.id, syncedQueue)
      expect(harness.result.queuedMessages).toEqual(syncedQueue)

      chatSessionMessages.syncSessionQueuedMessages('session-other', otherSessionQueue)
      expect(harness.result.queuedMessages).toEqual(syncedQueue)
    } finally {
      harness.cleanup()
    }
  })
})
