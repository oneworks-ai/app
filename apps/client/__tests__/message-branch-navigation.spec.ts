import { describe, expect, it } from 'vitest'

import type { ChatMessage, Session } from '@oneworks/core'

import { buildMessageBranchNavigationMap } from '#~/components/chat/messages/message-branch-navigation'

const createSession = (session: Partial<Session> & Pick<Session, 'id'>): Session => {
  const { createdAt, id, ...rest } = session
  return {
    id,
    createdAt: createdAt ?? 1,
    ...rest
  }
}

const createUserMessage = (id: string, content: string): ChatMessage => ({
  id,
  role: 'user',
  content,
  createdAt: 1
})

describe('message branch navigation', () => {
  it('shows sibling edit sessions as versions on the source message', () => {
    const root = createSession({ id: 'root', createdAt: 1 })
    const firstEdit = createSession({
      id: 'edit-1',
      createdAt: 2,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 0,
      messageBranchGroupId: 'group-1',
      messageBranchSourceMessageId: 'user-1',
      messageBranchSourceSessionId: 'root',
      parentSessionId: 'root'
    })
    const secondEdit = createSession({
      id: 'edit-2',
      createdAt: 3,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 0,
      messageBranchGroupId: 'group-1',
      messageBranchSourceMessageId: 'user-1',
      messageBranchSourceSessionId: 'root',
      parentSessionId: 'root'
    })

    const result = buildMessageBranchNavigationMap({
      currentSession: root,
      messages: [createUserMessage('user-1', 'original')],
      sessions: [root, firstEdit, secondEdit]
    })

    expect(result.get('user-1')).toEqual({
      current: 1,
      total: 3,
      nextSessionId: 'edit-1',
      previousSessionId: undefined
    })
  })

  it('anchors branch versions to the replayed user message in the active branch session', () => {
    const root = createSession({ id: 'root', createdAt: 1 })
    const firstEdit = createSession({
      id: 'edit-1',
      createdAt: 2,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 2,
      messageBranchGroupId: 'group-1',
      messageBranchSourceMessageId: 'user-2',
      messageBranchSourceSessionId: 'root',
      parentSessionId: 'root'
    })
    const secondEdit = createSession({
      id: 'edit-2',
      createdAt: 3,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 2,
      messageBranchGroupId: 'group-1',
      messageBranchSourceMessageId: 'user-2',
      messageBranchSourceSessionId: 'root',
      parentSessionId: 'root'
    })

    const result = buildMessageBranchNavigationMap({
      currentSession: firstEdit,
      messages: [
        createUserMessage('user-1', 'first'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'answer',
          createdAt: 2
        },
        createUserMessage('edit-user-1', 'edited')
      ],
      sessions: [root, firstEdit, secondEdit]
    })

    expect(result.get('edit-user-1')).toEqual({
      current: 2,
      total: 3,
      nextSessionId: 'edit-2',
      previousSessionId: 'root'
    })
  })

  it('does not render recall-only branches as message versions', () => {
    const root = createSession({ id: 'root', createdAt: 1 })
    const recall = createSession({
      id: 'recall-1',
      createdAt: 2,
      messageBranchAction: 'recall',
      messageBranchBaseMessageIndex: 0,
      messageBranchGroupId: 'group-1',
      messageBranchSourceMessageId: 'user-1',
      messageBranchSourceSessionId: 'root',
      parentSessionId: 'root'
    })

    const result = buildMessageBranchNavigationMap({
      currentSession: root,
      messages: [createUserMessage('user-1', 'original')],
      sessions: [root, recall]
    })

    expect(result.size).toBe(0)
  })

  it('shows ancestor branch controls when the active timeline is a descendant branch', () => {
    const root = createSession({ id: 'root', createdAt: 1 })
    const firstMessageEdit = createSession({
      id: 'edit-message-1',
      createdAt: 2,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 0,
      messageBranchGroupId: 'group-message-1',
      messageBranchSourceMessageId: 'root-user-1',
      messageBranchSourceSessionId: 'root',
      parentSessionId: 'root'
    })
    const firstMessageSibling = createSession({
      id: 'edit-message-1-sibling',
      createdAt: 3,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 0,
      messageBranchGroupId: 'group-message-1',
      messageBranchSourceMessageId: 'root-user-1',
      messageBranchSourceSessionId: 'root',
      parentSessionId: 'root'
    })
    const laterEdit = createSession({
      id: 'edit-later',
      createdAt: 4,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 2,
      messageBranchGroupId: 'group-later',
      messageBranchSourceMessageId: 'branch-user-2',
      messageBranchSourceSessionId: 'edit-message-1',
      parentSessionId: 'edit-message-1'
    })
    const laterSibling = createSession({
      id: 'edit-later-sibling',
      createdAt: 5,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 2,
      messageBranchGroupId: 'group-later',
      messageBranchSourceMessageId: 'branch-user-2',
      messageBranchSourceSessionId: 'edit-message-1',
      parentSessionId: 'edit-message-1'
    })

    const result = buildMessageBranchNavigationMap({
      currentSession: laterEdit,
      messages: [
        createUserMessage('branch-user-1', 'edited first message'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'answer',
          createdAt: 2
        },
        createUserMessage('branch-user-2-edited', 'edited later message')
      ],
      sessions: [root, firstMessageEdit, firstMessageSibling, laterEdit, laterSibling]
    })

    expect(result.get('branch-user-1')).toEqual({
      current: 2,
      total: 3,
      nextSessionId: 'edit-message-1-sibling',
      previousSessionId: 'root'
    })
    expect(result.get('branch-user-2-edited')).toEqual({
      current: 2,
      total: 3,
      nextSessionId: 'edit-later-sibling',
      previousSessionId: 'edit-message-1'
    })
  })

  it('omits ancestor branch controls when a descendant branch cut before that message', () => {
    const root = createSession({ id: 'root', createdAt: 1 })
    const laterEdit = createSession({
      id: 'edit-later',
      createdAt: 2,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 2,
      messageBranchGroupId: 'group-later',
      messageBranchSourceMessageId: 'root-user-2',
      messageBranchSourceSessionId: 'root',
      parentSessionId: 'root'
    })
    const earlierEditFromLater = createSession({
      id: 'edit-earlier',
      createdAt: 3,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 0,
      messageBranchGroupId: 'group-earlier',
      messageBranchSourceMessageId: 'root-user-1',
      messageBranchSourceSessionId: 'edit-later',
      parentSessionId: 'edit-later'
    })

    const result = buildMessageBranchNavigationMap({
      currentSession: earlierEditFromLater,
      messages: [
        createUserMessage('edited-earlier-user', 'edited earlier message'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'answer',
          createdAt: 2
        },
        createUserMessage('new-user-at-old-later-index', 'not the old later branch point')
      ],
      sessions: [root, laterEdit, earlierEditFromLater]
    })

    expect(result.get('new-user-at-old-later-index')).toBeUndefined()
    expect(result.get('edited-earlier-user')).toEqual({
      current: 2,
      total: 2,
      nextSessionId: undefined,
      previousSessionId: 'edit-later'
    })
  })

  it('ignores branch groups that are not selected in the current timeline', () => {
    const root = createSession({ id: 'root', createdAt: 1 })
    const firstEdit = createSession({
      id: 'first-edit',
      createdAt: 2,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 0,
      messageBranchGroupId: 'group-first',
      messageBranchSourceMessageId: 'root-user-1',
      messageBranchSourceSessionId: 'root',
      parentSessionId: 'root'
    })
    const laterEdit = createSession({
      id: 'later-edit',
      createdAt: 3,
      messageBranchAction: 'edit',
      messageBranchBaseMessageIndex: 2,
      messageBranchGroupId: 'group-later',
      messageBranchSourceMessageId: 'first-edit-user-2',
      messageBranchSourceSessionId: 'first-edit',
      parentSessionId: 'first-edit'
    })

    const result = buildMessageBranchNavigationMap({
      currentSession: root,
      messages: [createUserMessage('root-user-1', 'original')],
      sessions: [root, firstEdit, laterEdit]
    })

    expect(result.get('root-user-1')).toEqual({
      current: 1,
      total: 2,
      nextSessionId: 'first-edit',
      previousSessionId: undefined
    })
    expect(result.size).toBe(1)
  })
})
