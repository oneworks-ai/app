import { describe, expect, it } from 'vitest'

import {
  applyInteractionStateEvent,
  findLatestFatalError,
  getFatalSessionError,
  restoreInteractionStateFromHistory
} from '#~/hooks/chat/interaction-state'
import { getSessionActivityLabel } from '#~/hooks/chat/session-activity-label'
import {
  restoreSessionCompactionEventsFromHistoryEvents,
  restoreSessionCompactionInfoFromHistoryEvents
} from '#~/hooks/chat/session-compaction'
import {
  applySessionOperationEvent,
  getChatMessageFromSessionHistoryEvent,
  restoreChatMessagesFromSessionHistoryEvents,
  restoreSessionOperationInfoFromHistoryEvents,
  restoreSessionWorkspaceChangesFromHistoryEvents,
  shouldApplyHistoryRefreshResult,
  shouldRefreshHistoryForSessionUpdate,
  shouldTerminateSessionForConfigChange
} from '#~/hooks/chat/use-chat-session-messages'

describe('chat session interaction state', () => {
  it('restores workspace change events in history order and deduplicates by id', () => {
    expect(
      restoreSessionWorkspaceChangesFromHistoryEvents([
        {
          type: 'workspace_changes',
          changes: {
            id: 'changes-2',
            sessionId: 'sess-1',
            cwd: '/repo',
            repositoryRoot: '/repo',
            startedAt: 90,
            completedAt: 200,
            createdAt: 200,
            outcome: 'completed',
            summary: { changedFiles: 1, additions: 1, deletions: 0 },
            files: [{
              path: 'src/app.ts',
              staged: false,
              unstaged: true,
              untracked: false,
              additions: 1,
              deletions: 0
            }]
          }
        },
        {
          type: 'workspace_changes',
          changes: {
            id: 'changes-1',
            sessionId: 'sess-1',
            cwd: '/repo',
            repositoryRoot: '/repo',
            startedAt: 80,
            completedAt: 100,
            createdAt: 100,
            outcome: 'completed',
            summary: { changedFiles: 1, additions: 2, deletions: 1 },
            files: [{
              path: 'README.md',
              staged: false,
              unstaged: false,
              untracked: true,
              additions: 2,
              deletions: 1
            }]
          }
        },
        {
          type: 'workspace_changes',
          changes: {
            id: 'changes-2',
            sessionId: 'sess-1',
            cwd: '/repo',
            repositoryRoot: '/repo',
            startedAt: 90,
            completedAt: 210,
            createdAt: 210,
            outcome: 'completed',
            summary: { changedFiles: 1, additions: 3, deletions: 0 },
            files: [{
              path: 'src/app.ts',
              staged: false,
              unstaged: true,
              untracked: false,
              additions: 3,
              deletions: 0
            }]
          }
        }
      ]).map(item => [item.id, item.summary.additions])
    ).toEqual([
      ['changes-1', 2],
      ['changes-2', 3]
    ])
  })

  it('restores the latest context compaction event from session history', () => {
    expect(restoreSessionCompactionInfoFromHistoryEvents([
      {
        type: 'adapter_event',
        data: {
          source: 'adapter',
          type: 'context_compaction',
          id: 'compact-1',
          createdAt: 100,
          trigger: 'auto',
          tokenCount: 3210
        }
      },
      {
        type: 'adapter_event',
        data: {
          source: 'adapter',
          type: 'context_compaction',
          id: 'compact-2',
          createdAt: 200
        }
      }
    ])).toEqual({
      id: 'compact-2',
      createdAt: 200,
      status: 'compressing'
    })
  })

  it('keeps context compaction in history order and marks it compressed after an assistant reply', () => {
    expect(restoreSessionCompactionEventsFromHistoryEvents([
      {
        type: 'message',
        message: {
          id: 'user-1',
          role: 'user',
          content: 'hello',
          createdAt: 90
        }
      },
      {
        type: 'adapter_event',
        data: {
          source: 'adapter',
          type: 'context_compaction',
          id: 'compact-1',
          createdAt: 100
        }
      },
      {
        type: 'message',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'done',
          createdAt: 110
        }
      }
    ])).toEqual([{
      id: 'compact-1',
      createdAt: 100,
      status: 'compressed'
    }])
  })

  it('restores multiple context compaction nodes with independent status', () => {
    expect(restoreSessionCompactionEventsFromHistoryEvents([
      {
        type: 'adapter_event',
        data: {
          source: 'adapter',
          type: 'context_compaction',
          id: 'compact-1',
          createdAt: 100
        }
      },
      {
        type: 'message',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'first reply',
          createdAt: 120
        }
      },
      {
        type: 'adapter_event',
        data: {
          source: 'adapter',
          type: 'context_compaction',
          id: 'compact-2',
          createdAt: 200
        }
      }
    ])).toEqual([
      {
        id: 'compact-1',
        createdAt: 100,
        status: 'compressed'
      },
      {
        id: 'compact-2',
        createdAt: 200,
        status: 'compressing'
      }
    ])
  })

  it('restores real runtime flat message events from session history', () => {
    expect(getChatMessageFromSessionHistoryEvent({
      type: 'message',
      id: 'evt-runtime-message',
      role: 'assistant',
      content: 'real codex runtime consumer ok.',
      model: 'gpt-5.2',
      ts: 1777864895879
    })).toEqual({
      id: 'evt-runtime-message',
      role: 'assistant',
      content: 'real codex runtime consumer ok.',
      model: 'gpt-5.2',
      createdAt: 1777864895879
    })
  })

  it('preserves agent room message source metadata from flat session history events', () => {
    expect(getChatMessageFromSessionHistoryEvent({
      type: 'message',
      id: 'evt-runtime-leader-message',
      role: 'user',
      content: 'leader-origin child prompt',
      agentRoom: {
        source: 'leader',
        sourceLabel: 'leader',
        roomId: 'room-1',
        hostSessionId: 'host-session',
        memberKey: 'std/dev-planner',
        runKey: 'sess-child',
        commandId: 'cmd-1',
        causedByCommandId: 'cmd-parent'
      },
      ts: 1777864895879
    })).toEqual({
      id: 'evt-runtime-leader-message',
      role: 'user',
      content: 'leader-origin child prompt',
      agentRoom: {
        source: 'leader',
        sourceLabel: 'leader',
        roomId: 'room-1',
        hostSessionId: 'host-session',
        memberKey: 'std/dev-planner',
        runKey: 'sess-child',
        commandId: 'cmd-1',
        causedByCommandId: 'cmd-parent'
      },
      createdAt: 1777864895879
    })
  })

  it('preserves arbitrary agent room source labels from flat session history events', () => {
    expect(getChatMessageFromSessionHistoryEvent({
      type: 'message',
      id: 'evt-runtime-agent-message',
      role: 'user',
      content: 'agent-origin child prompt',
      agentRoom: {
        source: 'std/dev-reviewer',
        sourceLabel: 'std/dev-reviewer',
        roomId: 'room-1',
        hostSessionId: 'host-session',
        memberKey: 'std/dev-planner',
        runKey: 'sess-child'
      },
      ts: 1777864895880
    })).toEqual({
      id: 'evt-runtime-agent-message',
      role: 'user',
      content: 'agent-origin child prompt',
      agentRoom: {
        source: 'std/dev-reviewer',
        sourceLabel: 'std/dev-reviewer',
        roomId: 'room-1',
        hostSessionId: 'host-session',
        memberKey: 'std/dev-planner',
        runKey: 'sess-child'
      },
      createdAt: 1777864895880
    })
  })

  it('maps real command ack history metadata onto the following user message', () => {
    expect(restoreChatMessagesFromSessionHistoryEvents([
      {
        type: 'adapter_event',
        data: {
          runtimeEvent: {
            type: 'command_ack',
            parentSessionId: 'host-session',
            roomId: 'room-1',
            hostSessionId: 'host-session',
            memberKey: 'std/dev-planner',
            memberKind: 'entity',
            memberLabel: 'std/dev-planner',
            runId: 'sess-child',
            commandId: 'cmd_start_planner',
            causedByCommandId: 'start-planner',
            message: 'start',
            sessionId: 'sess-child',
            id: 'evt_1',
            seq: 1,
            ts: 1778310636368
          }
        }
      },
      {
        type: 'message',
        message: {
          id: 'evt_2',
          role: 'user',
          content: 'leader-origin child prompt',
          createdAt: 1778310636371
        }
      },
      {
        type: 'message',
        message: {
          id: 'direct-user-message',
          role: 'user',
          content: 'planner-ack-001',
          createdAt: 1778312411483
        }
      }
    ])).toEqual([
      {
        id: 'evt_2',
        role: 'user',
        content: 'leader-origin child prompt',
        createdAt: 1778310636371,
        agentRoom: {
          source: 'leader',
          roomId: 'room-1',
          hostSessionId: 'host-session',
          memberKey: 'std/dev-planner',
          runKey: 'sess-child',
          commandId: 'cmd_start_planner',
          causedByCommandId: 'start-planner'
        }
      },
      {
        id: 'direct-user-message',
        role: 'user',
        content: 'planner-ack-001',
        createdAt: 1778312411483
      }
    ])
  })

  it('preserves websocket message events from session history', () => {
    expect(getChatMessageFromSessionHistoryEvent({
      type: 'message',
      message: {
        id: 'msg-1',
        role: 'user',
        content: 'existing websocket shape',
        createdAt: 1
      }
    })).toEqual({
      id: 'msg-1',
      role: 'user',
      content: 'existing websocket shape',
      createdAt: 1
    })
  })

  it('does not terminate completed child or external sessions for UI config drift', () => {
    expect(shouldTerminateSessionForConfigChange({
      id: 'child-session',
      parentSessionId: 'host-session',
      title: 'Child run',
      status: 'completed',
      createdAt: 1
    }, true)).toBe(false)
    expect(shouldTerminateSessionForConfigChange({
      id: 'external-completed-session',
      title: 'External run',
      status: 'completed',
      createdAt: 1
    }, true)).toBe(false)
  })

  it('only allows config-driven termination for top-level sessions waiting for input', () => {
    expect(shouldTerminateSessionForConfigChange({
      id: 'waiting-session',
      title: 'Waiting session',
      status: 'waiting_input',
      createdAt: 1
    }, true)).toBe(true)
    expect(shouldTerminateSessionForConfigChange({
      id: 'running-session',
      title: 'Running session',
      status: 'running',
      createdAt: 1
    }, true)).toBe(false)
    expect(shouldTerminateSessionForConfigChange({
      id: 'waiting-session',
      title: 'Waiting session',
      status: 'waiting_input',
      createdAt: 1
    }, false)).toBe(false)
  })

  it('accepts the first successful history response while a newer request is still pending', () => {
    expect(shouldApplyHistoryRefreshResult({
      activeSessionId: 'sess-1',
      appliedRequestSeq: 0,
      requestSeq: 1,
      sessionId: 'sess-1'
    })).toBe(true)
    expect(shouldApplyHistoryRefreshResult({
      activeSessionId: 'sess-1',
      appliedRequestSeq: 2,
      requestSeq: 1,
      sessionId: 'sess-1'
    })).toBe(false)
    expect(shouldApplyHistoryRefreshResult({
      activeSessionId: 'sess-2',
      appliedRequestSeq: 0,
      requestSeq: 1,
      sessionId: 'sess-1'
    })).toBe(false)
  })

  it('clears adapter CLI operation state after the matching completion event', () => {
    const startedEvent = {
      type: 'adapter_event',
      data: {
        runtimeEvent: {
          type: 'operation_started',
          operationId: 'adapter-cli-prepare',
          message: 'Checking adapter CLI.',
          ts: 100
        }
      }
    } as const
    const completedEvent = {
      type: 'adapter_event',
      data: {
        runtimeEvent: {
          type: 'operation_completed',
          operationId: 'adapter-cli-prepare',
          message: 'Adapter CLI is ready.',
          ts: 120
        }
      }
    } as const

    const activeOperation = applySessionOperationEvent(null, startedEvent)

    expect(activeOperation).toEqual(expect.objectContaining({
      operationId: 'adapter-cli-prepare',
      message: 'Checking adapter CLI.'
    }))
    expect(applySessionOperationEvent(activeOperation, completedEvent)).toBeNull()
    expect(restoreSessionOperationInfoFromHistoryEvents([
      startedEvent,
      completedEvent
    ])).toBeNull()
  })

  it('only labels adapter CLI preparation while the operation is active', () => {
    const t = (key: string) => key

    expect(getSessionActivityLabel(null, t)).toBeUndefined()
    expect(getSessionActivityLabel({
      operationId: 'adapter-cli-prepare',
      startedAt: 100
    }, t)).toBe('chat.sessionOperation.adapterCliPrepare')
    expect(getSessionActivityLabel({
      operationId: 'tool-run',
      message: 'Running tool',
      startedAt: 100
    }, t)).toBe('Running tool')
  })

  it('refreshes history when the current session update can contain unseen messages', () => {
    const currentSession = {
      id: 'sess-1',
      title: 'Runtime check',
      status: 'running',
      lastMessage: 'user prompt',
      messageCount: 1,
      createdAt: 1
    } as const

    expect(shouldRefreshHistoryForSessionUpdate(currentSession, {
      ...currentSession,
      status: 'completed',
      lastMessage: 'assistant reply',
      messageCount: 2
    })).toBe(true)
    expect(shouldRefreshHistoryForSessionUpdate(currentSession, {
      ...currentSession,
      lastMessage: 'assistant reply'
    })).toBe(true)
    expect(shouldRefreshHistoryForSessionUpdate(currentSession, {
      ...currentSession,
      messageCount: 2
    })).toBe(true)
  })

  it('does not refresh history for unrelated or deleted session updates', () => {
    const currentSession = {
      id: 'sess-1',
      title: 'Runtime check',
      status: 'completed',
      lastMessage: 'assistant reply',
      messageCount: 2,
      createdAt: 1
    } as const

    expect(shouldRefreshHistoryForSessionUpdate(currentSession, {
      ...currentSession
    })).toBe(false)
    expect(shouldRefreshHistoryForSessionUpdate(currentSession, {
      ...currentSession,
      id: 'sess-2',
      lastMessage: 'other reply'
    })).toBe(false)
    expect(shouldRefreshHistoryForSessionUpdate(currentSession, {
      id: 'sess-1',
      isDeleted: true
    })).toBe(false)
  })

  it('stores the latest interaction request payload', () => {
    expect(applyInteractionStateEvent(null, {
      type: 'interaction_request',
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    })).toEqual({
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    })
  })

  it('clears the active interaction when a matching response arrives', () => {
    expect(applyInteractionStateEvent({
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    }, {
      type: 'interaction_response',
      id: 'interaction-1',
      data: '继续'
    })).toBeNull()
  })

  it('clears the interaction when session status leaves waiting_input', () => {
    expect(applyInteractionStateEvent({
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    }, {
      type: 'session_updated',
      session: {
        id: 'sess-1',
        status: 'running'
      }
    })).toBeNull()
  })

  it('clears the interaction when the session is deleted', () => {
    expect(applyInteractionStateEvent({
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    }, {
      type: 'session_updated',
      session: {
        id: 'sess-1',
        isDeleted: true
      }
    })).toBeNull()
  })

  it('preserves the active interaction for unrelated responses', () => {
    const current = {
      id: 'interaction-2',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    }

    expect(applyInteractionStateEvent(current, {
      type: 'interaction_response',
      id: 'interaction-1',
      data: '继续'
    })).toBe(current)
  })

  it('drops stale interactions when a fatal error appears later in history', () => {
    expect(restoreInteractionStateFromHistory([
      {
        type: 'interaction_request',
        id: 'interaction-1',
        payload: {
          sessionId: 'sess-1',
          question: '是否继续？'
        }
      },
      {
        type: 'error',
        data: {
          message: '权限确认已超时，任务未继续执行。',
          fatal: true
        }
      }
    ], {
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    }, 'failed')).toBeNull()
  })

  it('drops room-handled child approval requests when the session is no longer waiting', () => {
    expect(restoreInteractionStateFromHistory(
      [
        {
          type: 'interaction_request',
          id: 'codex-approval:1',
          payload: {
            sessionId: 'sess-child',
            question: '允许执行命令 `/bin/zsh -lc "ow run"`？',
            kind: 'permission'
          }
        },
        {
          type: 'adapter_event',
          data: {
            runtimeEvent: {
              type: 'command_ack',
              id: 'evt-submit',
              commandId: 'cmd-submit',
              causedByCommandId: 'child-request-sess-child-1',
              message: 'submit_input',
              sessionId: 'sess-child'
            }
          }
        },
        {
          type: 'message',
          message: {
            id: 'msg-completed',
            role: 'assistant',
            content: '已完成审批后的任务。',
            createdAt: 1
          }
        }
      ],
      null,
      'completed'
    )).toBeNull()
  })

  it('keeps history interaction requests when the session is still waiting', () => {
    expect(restoreInteractionStateFromHistory(
      [
        {
          type: 'interaction_request',
          id: 'interaction-1',
          payload: {
            sessionId: 'sess-1',
            question: '是否继续？'
          }
        }
      ],
      null,
      'waiting_input'
    )).toEqual({
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    })
  })

  it('falls back to the server-provided interaction when the session is still waiting for input', () => {
    expect(restoreInteractionStateFromHistory([], {
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    }, 'waiting_input')).toEqual({
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    })
  })

  it('reads the latest fatal error payload from stored history', () => {
    expect(findLatestFatalError([
      {
        type: 'error',
        data: {
          message: '旧错误',
          code: 'old_error',
          fatal: true
        }
      },
      {
        type: 'error',
        data: {
          message: '权限确认已超时，任务未继续执行。',
          code: 'permission_request_failed',
          fatal: true
        }
      }
    ])).toEqual({
      message: '权限确认已超时，任务未继续执行。',
      code: 'permission_request_failed'
    })
  })

  it('ignores non-fatal error events when resolving the current session error banner', () => {
    expect(getFatalSessionError({
      type: 'error',
      data: {
        message: '工具执行失败，但会继续重试',
        fatal: false
      }
    })).toBeNull()
  })

  it('strips ANSI escape sequences from fatal error messages', () => {
    expect(getFatalSessionError({
      type: 'error',
      data: {
        message: '\u001B[31mError: Invalid session ID. Must be a valid UUID.\u001B[39m \u001B[31m\u001B[39m',
        fatal: true
      }
    })).toEqual({
      message: 'Error: Invalid session ID. Must be a valid UUID.'
    })
  })

  it('falls back to the top-level error message when the payload only contains ANSI output', () => {
    expect(getFatalSessionError({
      type: 'error',
      message: 'Session failed after the runtime closed the stream.',
      data: {
        message: '\u001B[31m\u001B[39m',
        code: 'session_failed',
        fatal: true
      }
    })).toEqual({
      message: 'Session failed after the runtime closed the stream.',
      code: 'session_failed'
    })
  })
})
