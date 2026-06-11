import { describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '@oneworks/core'

import {
  LOCAL_USER_MESSAGE_ID_PREFIX,
  consumeStagedLocalUserMessages,
  reconcileLocalUserMessages,
  stageLocalUserMessage,
  subscribeStagedLocalUserMessages
} from '#~/hooks/chat/local-user-message'
import { OPTIMISTIC_USER_MESSAGE_ID_SUFFIX } from '#~/hooks/chat/optimistic-session-creation'

const userMessage = (
  id: string,
  content: ChatMessage['content'],
  createdAt: number
): ChatMessage => ({
  id,
  role: 'user',
  content,
  createdAt
})

describe('local user message reconciliation', () => {
  it('keeps a local user message when refreshed history has not projected it yet', () => {
    const localMessage = userMessage(`${LOCAL_USER_MESSAGE_ID_PREFIX}1`, 'hello', 100)

    expect(reconcileLocalUserMessages([], [localMessage])).toEqual([localMessage])
  })

  it('keeps an optimistic first user message until history projects it', () => {
    const optimisticMessage = userMessage(`session-1${OPTIMISTIC_USER_MESSAGE_ID_SUFFIX}`, 'hello', 100)

    expect(reconcileLocalUserMessages([], [optimisticMessage])).toEqual([optimisticMessage])
  })

  it('removes the local user message once the runtime user event arrives', () => {
    const localMessage = userMessage(`${LOCAL_USER_MESSAGE_ID_PREFIX}1`, 'hello', 100)
    const runtimeMessage = userMessage('evt_1', 'hello', 120)

    expect(reconcileLocalUserMessages([runtimeMessage], [localMessage])).toEqual([runtimeMessage])
  })

  it('removes the optimistic first user message once the runtime user event arrives', () => {
    const optimisticMessage = userMessage(`session-1${OPTIMISTIC_USER_MESSAGE_ID_SUFFIX}`, 'hello', 100)
    const runtimeMessage = userMessage('evt_1', 'hello', 120)

    expect(reconcileLocalUserMessages([runtimeMessage], [optimisticMessage])).toEqual([runtimeMessage])
  })

  it('matches text content items against string runtime messages', () => {
    const localMessage = userMessage(`${LOCAL_USER_MESSAGE_ID_PREFIX}1`, [{ type: 'text', text: 'hello' }], 100)
    const runtimeMessage = userMessage('evt_1', ' hello ', 120)

    expect(reconcileLocalUserMessages([runtimeMessage], [localMessage])).toEqual([runtimeMessage])
  })

  it('does not remove a repeated local message because of an older matching history item', () => {
    const previousRuntimeMessage = userMessage('evt_1', 'hello', 100)
    const localMessage = userMessage(`${LOCAL_USER_MESSAGE_ID_PREFIX}1`, 'hello', 120_000)

    expect(reconcileLocalUserMessages([previousRuntimeMessage], [previousRuntimeMessage, localMessage])).toEqual([
      previousRuntimeMessage,
      localMessage
    ])
  })

  it('stages the first optimistic user message for the created session route', () => {
    const localMessage = userMessage(`session-staged${OPTIMISTIC_USER_MESSAGE_ID_SUFFIX}`, 'hello', 100)

    stageLocalUserMessage('session-staged', localMessage)

    expect(consumeStagedLocalUserMessages('session-staged')).toEqual([localMessage])
    expect(consumeStagedLocalUserMessages('session-staged')).toEqual([])
  })

  it('notifies mounted session views when a local user message is staged', () => {
    const localMessage = userMessage(`${LOCAL_USER_MESSAGE_ID_PREFIX}live`, 'hello', 100)
    const listener = vi.fn()
    const unsubscribe = subscribeStagedLocalUserMessages('session-live', listener)

    stageLocalUserMessage('session-live', localMessage)
    unsubscribe()
    stageLocalUserMessage('session-live', userMessage(`${LOCAL_USER_MESSAGE_ID_PREFIX}ignored`, 'ignored', 200))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(localMessage)
    expect(consumeStagedLocalUserMessages('session-live')).toHaveLength(2)
  })
})
