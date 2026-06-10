import { describe, expect, it } from 'vitest'

import type { Session } from '@oneworks/core'

import {
  MESSAGE_BRANCH_SESSION_QUERY,
  buildMessageBranchSearch,
  isMessageBranchOfRootSession,
  resolveMessageBranchRootSessionId
} from '#~/utils/message-branch-session'

const createSession = (session: Partial<Session> & Pick<Session, 'id'>): Session => ({
  createdAt: 1,
  ...session
})

describe('message branch session query state', () => {
  it('stores the active branch in query while preserving other query state', () => {
    const search = buildMessageBranchSearch({
      currentSearch: '?messageId=user-1',
      rootSessionId: 'root',
      targetSessionId: 'edit-1'
    })

    expect(search).toBe(`?messageId=user-1&${MESSAGE_BRANCH_SESSION_QUERY}=edit-1`)
  })

  it('clears the branch query when switching back to the root session', () => {
    const search = buildMessageBranchSearch({
      currentSearch: `?messageId=user-1&${MESSAGE_BRANCH_SESSION_QUERY}=edit-1`,
      rootSessionId: 'root',
      targetSessionId: 'root'
    })

    expect(search).toBe('?messageId=user-1')
  })

  it('resolves chained branch sessions back to their root session', () => {
    const root = createSession({ id: 'root' })
    const edit = createSession({
      id: 'edit-1',
      messageBranchGroupId: 'group-1',
      messageBranchSourceSessionId: 'root'
    })
    const editAgain = createSession({
      id: 'edit-2',
      messageBranchGroupId: 'group-1',
      messageBranchSourceSessionId: 'edit-1'
    })

    expect(resolveMessageBranchRootSessionId(editAgain, [root, edit, editAgain])).toBe('root')
    expect(isMessageBranchOfRootSession(editAgain, 'root', [root, edit, editAgain])).toBe(true)
  })
})
