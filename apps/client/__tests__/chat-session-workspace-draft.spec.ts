import { describe, expect, it } from 'vitest'

import type { ConfigResponse } from '@oneworks/types'

import {
  DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT,
  getChatSessionWorkspaceDraftFromConfig
} from '#~/hooks/chat/chat-session-workspace-draft'

describe('chat session workspace draft', () => {
  it('defaults new sessions to the shared workspace', () => {
    expect(DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT).toEqual({
      createWorktree: false
    })
  })

  it('uses the merged config worktree defaults when present', () => {
    expect(
      getChatSessionWorkspaceDraftFromConfig({
        sources: {
          merged: {
            conversation: {
              createSessionWorktree: true,
              worktreeEnvironment: 'default.local'
            }
          }
        }
      } as ConfigResponse)
    ).toEqual({
      createWorktree: true,
      worktreeEnvironment: 'default.local'
    })
  })
})
