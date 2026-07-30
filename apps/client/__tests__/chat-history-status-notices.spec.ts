import { describe, expect, it } from 'vitest'

import { buildChatHistoryStatusNotices } from '#~/components/chat/messages/build-chat-history-status-notices'

const dictionary = {
  'chat.modelConfigRequired': 'Add a model service in config before starting a session',
  'chat.modelConfigRequiredTitle': 'Model setup required',
  'chat.modelConfigRequiredHelp': 'Add at least one model service, then retry sending from the composer.',
  'chat.connectionErrorTitle': 'Connection error',
  'chat.connectionClosedTitle': 'Connection closed',
  'chat.connectionAuthRequiredTitle': 'Login expired',
  'chat.connectionErrorHelp': 'Retry to resubscribe to the running session.',
  'chat.connectionClosedHelp': 'Retry to reconnect and continue receiving new messages.',
  'chat.connectionAuthRequiredHelp': 'Sign in again, then return to this session.',
  'chat.sessionErrorTitle': 'Task failed',
  'chat.sessionErrorHelp': 'Check the latest tool output or terminal logs.',
  'chat.sessionCreateFailedTitle': 'Session creation failed',
  'chat.sessionCreateFailedHelp': 'Retry with the same message.',
  'chat.sessionErrorCode': 'Error code: {{code}}',
  'chat.projectConfigRecovery.help': 'Open the failing project config or retry with global config.'
} satisfies Record<string, string>

const t = (key: string, options?: Record<string, unknown>) => {
  const template = dictionary[key as keyof typeof dictionary]
  if (template == null) {
    return key
  }

  if (options?.code != null) {
    return template.replace('{{code}}', String(options.code))
  }

  return template
}

describe('buildChatHistoryStatusNotices', () => {
  it('returns no notices when the session has no live errors yet', () => {
    expect(
      buildChatHistoryStatusNotices({
        errorState: null,
        modelUnavailable: false,
        t
      }).map(notice => notice.id)
    ).toEqual([])
  })

  it('maps the active session failure into a single history notice', () => {
    expect(buildChatHistoryStatusNotices({
      errorState: {
        kind: 'session',
        message: 'The adapter crashed while waiting for tool output.',
        code: 'adapter_runtime_failed'
      },
      modelUnavailable: false,
      t
    })).toEqual([
      {
        detail: 'Check the latest tool output or terminal logs.',
        icon: 'error',
        id: 'session-error',
        message: 'The adapter crashed while waiting for tool output.',
        meta: 'Error code: adapter_runtime_failed',
        tone: 'error',
        title: 'Task failed'
      }
    ])
  })

  it('maps an optimistic session creation failure to a retryable notice', () => {
    expect(buildChatHistoryStatusNotices({
      errorState: {
        action: 'retry-session-creation',
        kind: 'session',
        message: 'Worktree provisioning failed.',
        code: 'session_create_failed'
      },
      modelUnavailable: false,
      t
    })).toEqual([
      {
        action: 'retry-session-creation',
        detail: 'Retry with the same message.',
        icon: 'error',
        id: 'session-create-failed',
        message: 'Worktree provisioning failed.',
        tone: 'error',
        title: 'Session creation failed'
      }
    ])
  })

  it('exposes the exact failing project config location and recovery contract', () => {
    expect(buildChatHistoryStatusNotices({
      errorState: {
        kind: 'session',
        message: 'Codex could not parse the active workspace project config.',
        code: 'codex_project_config_invalid',
        details: {
          adapter: 'codex-alias',
          runtimeAdapter: 'codex',
          configPath: '.codex/config.toml',
          configSource: 'project',
          workspaceSource: 'active-session-workspace',
          workspaceFolder: '/workspace/root',
          sessionId: 'session-project-config',
          reason: 'wire_api is unsupported',
          runtimeEventId: 'evt-project-config-failure',
          runtimeEventSeq: 12,
          line: 8,
          column: 5
        }
      },
      modelUnavailable: false,
      t
    })).toEqual([
      {
        detail: 'Open the failing project config or retry with global config.',
        icon: 'error',
        id: 'session-error',
        message: 'Codex could not parse the active workspace project config.',
        meta: '/workspace/root/.codex/config.toml:8:5',
        projectConfigRecovery: {
          configPath: '.codex/config.toml',
          failureEventId: 'evt-project-config-failure',
          failureEventSeq: 12,
          sessionId: 'session-project-config',
          workspaceFolder: '/workspace/root',
          line: 8,
          column: 5
        },
        tone: 'error',
        title: 'Task failed'
      }
    ])
  })

  it('does not expose recovery actions for malformed known error details', () => {
    const [notice] = buildChatHistoryStatusNotices({
      errorState: {
        kind: 'session',
        message: 'Invalid project config.',
        code: 'codex_project_config_invalid',
        details: {
          configPath: '../../forged.toml',
          workspaceFolder: '/tmp/forged',
          line: 0.5,
          column: -1
        }
      },
      modelUnavailable: false,
      t
    })

    expect(notice).not.toHaveProperty('projectConfigRecovery')
    expect(notice?.detail).toBe('Check the latest tool output or terminal logs.')
  })

  it('combines model setup and live connection notices', () => {
    const notices = buildChatHistoryStatusNotices({
      errorState: {
        kind: 'connection',
        message: 'Live connection failed.',
        reason: 'error'
      },
      modelUnavailable: true,
      t
    })

    expect(notices.map(notice => notice.id)).toEqual([
      'model-unavailable',
      'connection-error'
    ])
    expect(notices.find(notice => notice.id === 'connection-error')?.action).toBe('retry-connection')
  })

  it('does not offer retry for an unrecoverable auth close', () => {
    expect(buildChatHistoryStatusNotices({
      errorState: {
        code: 'auth_required',
        kind: 'connection',
        message: 'Your login has expired.',
        reason: 'closed',
        recoverable: false
      },
      modelUnavailable: false,
      t
    })).toEqual([
      {
        detail: 'Sign in again, then return to this session.',
        icon: 'lock',
        id: 'connection-closed',
        message: 'Your login has expired.',
        tone: 'error',
        title: 'Login expired'
      }
    ])
  })
})
