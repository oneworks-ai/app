import { describe, expect, it } from 'vitest'

import type { SessionWorkspace } from '@oneworks/types'

import {
  getSessionWorkspaceMenuActions,
  getWorkspaceCreateActionState,
  getWorkspaceTransferActionState
} from '#~/components/chat/git-controls/workspace-action-state'

const workspace = (overrides: Partial<SessionWorkspace>): SessionWorkspace => ({
  sessionId: 'session-1',
  kind: 'managed_worktree',
  workspaceFolder: '/workspace',
  cleanupPolicy: 'delete_on_session_delete',
  state: 'ready',
  derivation: { eligible: false, reason: 'already_managed' },
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

describe('session workspace menu action state', () => {
  it('disables transfer and keeps recovery guidance for a non-ready managed workspace', () => {
    expect(getWorkspaceTransferActionState(
      workspace({
        state: 'deleting',
        derivation: { eligible: false, reason: 'workspace_unavailable' }
      }),
      false
    )).toEqual({ disabled: true, description: 'workspace_unavailable' })
  })

  it('keeps Create disabled after the transfer response replaces the cache with external runtime', () => {
    const transferredWorkspace = workspace({
      kind: 'external_workspace',
      cleanupPolicy: 'retain',
      worktreePath: '/managed-worktree',
      derivation: { eligible: false, reason: 'external_runtime' }
    })
    expect(getWorkspaceCreateActionState(transferredWorkspace, false)).toEqual({
      disabled: true,
      description: 'external_runtime'
    })
    expect(getSessionWorkspaceMenuActions(transferredWorkspace, false)).toEqual({
      create: { disabled: true, description: 'external_runtime' },
      transfer: undefined
    })
  })

  it('uses unavailable recovery guidance when a stale payload omits derivation', () => {
    expect(getWorkspaceTransferActionState(workspace({ state: 'broken', derivation: undefined }), false)).toEqual({
      disabled: true,
      description: 'workspace_unavailable'
    })
    expect(getWorkspaceCreateActionState(workspace({ derivation: undefined }), false)).toEqual({
      disabled: true,
      description: 'workspace_unavailable'
    })
  })

  it('keeps the status-bar Create action visible but disabled for a dirty shared workspace', () => {
    expect(getSessionWorkspaceMenuActions(
      workspace({
        kind: 'shared_workspace',
        derivation: { eligible: false, reason: 'dirty' }
      }),
      false
    )).toEqual({
      create: { disabled: true, description: 'dirty' },
      transfer: undefined
    })
  })
})
