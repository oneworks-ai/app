/* eslint-disable max-lines -- permission behavior matrix is intentionally kept in one test file. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyPermissionInteractionDecision,
  resolvePermissionDecision,
  resolvePermissionLookupKeysFromInput,
  resolvePermissionSubjectFromInput,
  syncPermissionStateMirror
} from '#~/services/session/permission.js'
import { createEmptySessionPermissionState } from '@oneworks/utils'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  loadConfigState: vi.fn(),
  resolveSessionWorkspaceFolder: vi.fn(),
  updateConfigFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  getSessionLogger: vi.fn()
}))

vi.mock('#~/db/index.js', () => ({
  getDb: mocks.getDb
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

vi.mock('#~/services/session/workspace.js', () => ({
  resolveSessionWorkspaceFolder: mocks.resolveSessionWorkspaceFolder
}))

vi.mock('@oneworks/config', async () => {
  const actual = await vi.importActual<typeof import('@oneworks/config')>('@oneworks/config')
  return {
    buildConfigSections: actual.buildConfigSections,
    updateConfigFile: mocks.updateConfigFile
  }
})

vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile
}))

vi.mock('#~/utils/logger.js', () => ({
  getSessionLogger: mocks.getSessionLogger
}))

describe('session permission service', () => {
  let runtimeState: ReturnType<typeof createEmptySessionPermissionState>
  let projectConfig: { permissions: { allow: string[]; deny: string[]; ask: string[] } }
  const updateSessionRuntimeState = vi.fn()
  const getChannelSessionBySessionId = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    runtimeState = createEmptySessionPermissionState()
    projectConfig = {
      permissions: {
        allow: [],
        deny: [],
        ask: []
      }
    }

    updateSessionRuntimeState.mockImplementation(
      (_sessionId: string, updates: { permissionState?: typeof runtimeState }) => {
        if (updates.permissionState != null) {
          runtimeState = updates.permissionState
        }
      }
    )
    getChannelSessionBySessionId.mockReturnValue(undefined)

    mocks.getDb.mockReturnValue({
      getSessionRuntimeState: vi.fn(() => ({
        runtimeKind: 'interactive',
        historySeedPending: false,
        permissionState: runtimeState
      })),
      updateSessionRuntimeState,
      getSession: vi.fn(() => ({
        id: 'sess-1',
        adapter: 'claude-code'
      })),
      getChannelSessionBySessionId
    })

    mocks.resolveSessionWorkspaceFolder.mockResolvedValue('/workspace')
    mocks.loadConfigState.mockImplementation(async () => ({
      workspaceFolder: '/workspace',
      projectConfig,
      projectSource: {
        rawConfig: projectConfig,
        resolvedConfig: projectConfig
      },
      mergedConfig: projectConfig
    }))
    mocks.updateConfigFile.mockImplementation(
      async ({ value }: { value: { permissions?: typeof projectConfig.permissions } }) => {
        if (value.permissions != null) {
          projectConfig = {
            permissions: {
              allow: [...(value.permissions.allow ?? [])],
              deny: [...(value.permissions.deny ?? [])],
              ask: [...(value.permissions.ask ?? [])]
            }
          }
        }
        return { ok: true }
      }
    )
    mocks.mkdir.mockResolvedValue(undefined)
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.getSessionLogger.mockReturnValue({
      warn: vi.fn()
    })
  })

  it('consumes one-shot deny before any other remembered decision', async () => {
    runtimeState = {
      allow: ['Write'],
      deny: ['Write'],
      onceAllow: ['Write'],
      onceDeny: ['Write']
    }

    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: {
        key: 'Write',
        label: 'Write',
        scope: 'tool'
      }
    })

    expect(result).toEqual(expect.objectContaining({
      result: 'deny',
      source: 'onceDeny'
    }))
    expect(runtimeState.onceDeny).toEqual([])
    expect(runtimeState.onceAllow).toEqual(['Write'])
  })

  it('consumes one-shot allow and leaves later session rules intact', async () => {
    runtimeState = {
      allow: ['Write'],
      deny: [],
      onceAllow: ['Write'],
      onceDeny: []
    }

    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: {
        key: 'Write',
        label: 'Write',
        scope: 'tool'
      }
    })

    expect(result).toEqual(expect.objectContaining({
      result: 'allow',
      source: 'onceAllow'
    }))
    expect(runtimeState.onceAllow).toEqual([])
    expect(runtimeState.allow).toEqual(['Write'])
  })

  it('falls back to project ask when the session does not override the tool', async () => {
    projectConfig.permissions.ask = ['Write']

    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: {
        key: 'Write',
        label: 'Write',
        scope: 'tool'
      }
    })

    expect(result).toEqual(expect.objectContaining({
      result: 'ask',
      source: 'projectAsk'
    }))
  })

  it('normalizes mixed-case custom tool keys before resolving remembered decisions', async () => {
    runtimeState = {
      allow: ['Channel-lark-test'],
      deny: [],
      onceAllow: [],
      onceDeny: []
    }

    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: {
        key: 'channel-lark-test',
        label: 'channel-lark-test',
        scope: 'tool'
      }
    })

    expect(result).toEqual(expect.objectContaining({
      result: 'allow',
      source: 'sessionAllow'
    }))
  })

  it('matches stored built-in MCP tool decisions across both known Codex subject slugs', async () => {
    runtimeState = {
      allow: ['mcp-oneworks-list-tasks'],
      deny: [],
      onceAllow: [],
      onceDeny: []
    }

    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: {
        key: 'mcp-oneworks-list-tasks',
        label: 'OneWorks:List Tasks',
        scope: 'tool'
      },
      lookupKeys: ['mcp-oneworks-list-tasks']
    })

    expect(result).toEqual(expect.objectContaining({
      result: 'allow',
      source: 'sessionAllow'
    }))
  })

  it('prefers deny over allow when built-in MCP alias keys disagree', async () => {
    runtimeState = {
      allow: ['mcp-oneworks-list-tasks'],
      deny: ['mcp-oneworks-list-tasks'],
      onceAllow: [],
      onceDeny: []
    }

    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: {
        key: 'mcp-oneworks-list-tasks',
        label: 'OneWorks:List Tasks',
        scope: 'tool'
      },
      lookupKeys: ['mcp-oneworks-list-tasks']
    })

    expect(result).toEqual(expect.objectContaining({
      result: 'deny',
      source: 'sessionDeny'
    }))
  })

  it('falls back to the built-in MCP server permission for Codex MCP approvals', async () => {
    projectConfig.permissions.allow = ['OneWorks']

    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: {
        key: 'mcp-oneworks-list-tasks',
        label: 'OneWorks:List Tasks',
        scope: 'tool'
      },
      lookupKeys: ['mcp-oneworks-list-tasks', 'OneWorks']
    })

    expect(result).toEqual(expect.objectContaining({
      result: 'allow',
      source: 'projectAllow'
    }))
  })

  it('resolves oneworks channel sends as a narrow Bash permission subject', async () => {
    projectConfig.permissions.allow = ['bash-oneworks-channel-send']

    const subject = resolvePermissionSubjectFromInput({
      toolName: 'Bash',
      toolInput: {
        command: '/bin/zsh -lc \'oneworks channel send "ok"\''
      }
    })

    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject,
      lookupKeys: resolvePermissionLookupKeysFromInput({
        toolName: 'Bash',
        toolInput: {
          command: '/bin/zsh -lc \'oneworks channel send "ok"\''
        }
      })
    })

    expect(subject).toMatchObject({
      key: 'bash-oneworks-channel-send',
      label: 'oneworks channel send'
    })
    expect(result).toEqual(expect.objectContaining({
      result: 'allow',
      source: 'projectAllow'
    }))
  })

  it('allows built-in channel CLI permissions for channel sessions without project config', async () => {
    getChannelSessionBySessionId.mockReturnValue({
      channelType: 'wechat',
      sessionType: 'group',
      channelId: 'room@chatroom',
      channelKey: 'erjie',
      sessionId: 'sess-1'
    })

    const sendInput = {
      command: "/bin/zsh -lc 'oneworks channel emoji annotate thumbs-up-bear --platform wechat --tag 赞同'"
    }
    const sendSubject = resolvePermissionSubjectFromInput({
      toolName: 'Bash',
      toolInput: sendInput
    })
    await expect(resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: sendSubject,
      lookupKeys: resolvePermissionLookupKeysFromInput({
        toolName: 'Bash',
        toolInput: sendInput
      })
    })).resolves.toEqual(expect.objectContaining({
      result: 'allow',
      source: 'channelDefaultAllow'
    }))

    const memInput = {
      command: '/bin/zsh -lc \'oneworks mem patch "用户偏好：先查日志"\''
    }
    await expect(resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: resolvePermissionSubjectFromInput({
        toolName: 'Bash',
        toolInput: memInput
      }),
      lookupKeys: resolvePermissionLookupKeysFromInput({
        toolName: 'Bash',
        toolInput: memInput
      })
    })).resolves.toEqual(expect.objectContaining({
      result: 'allow',
      source: 'channelDefaultAllow'
    }))
  })

  it('resolves oneworks mem commands as a narrow Bash permission subject', async () => {
    projectConfig.permissions.allow = ['bash-oneworks-mem']
    const toolInput = {
      command: '/bin/zsh -lc \'oneworks mem patch "用户偏好：先查日志"\''
    }

    const subject = resolvePermissionSubjectFromInput({
      toolName: 'Bash',
      toolInput
    })
    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject,
      lookupKeys: resolvePermissionLookupKeysFromInput({
        toolName: 'Bash',
        toolInput
      })
    })

    expect(subject).toMatchObject({
      key: 'bash-oneworks-mem',
      label: 'oneworks mem'
    })
    expect(result).toEqual(expect.objectContaining({
      result: 'allow',
      source: 'projectAllow'
    }))
  })

  it('lets broad Bash deny override the narrow channel send allow key', async () => {
    projectConfig.permissions.allow = ['bash-oneworks-channel-send']
    projectConfig.permissions.deny = ['Bash']

    const toolInput = {
      command: '/bin/zsh -lc \'oneworks channel erjie send "ok"\''
    }
    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: resolvePermissionSubjectFromInput({
        toolName: 'Bash',
        toolInput
      }),
      lookupKeys: resolvePermissionLookupKeysFromInput({
        toolName: 'Bash',
        toolInput
      })
    })

    expect(result).toEqual(expect.objectContaining({
      result: 'deny',
      source: 'projectDeny'
    }))
  })

  it('keeps the DB permission state authoritative when mirror sync fails', async () => {
    runtimeState = {
      allow: [],
      deny: [],
      onceAllow: ['Write'],
      onceDeny: []
    }
    mocks.writeFile.mockRejectedValueOnce(new Error('disk full'))

    const result = await resolvePermissionDecision({
      sessionId: 'sess-1',
      subject: {
        key: 'Write',
        label: 'Write',
        scope: 'tool'
      }
    })

    expect(result).toEqual(expect.objectContaining({
      result: 'allow',
      source: 'onceAllow'
    }))
    expect(runtimeState.onceAllow).toEqual([])
    expect(mocks.getSessionLogger).toHaveBeenCalledWith('sess-1', 'server')
  })

  it('writes permission mirror files for Kimi sessions', async () => {
    runtimeState = {
      allow: ['Shell'],
      deny: [],
      onceAllow: [],
      onceDeny: []
    }
    mocks.getDb.mockReturnValue({
      getSessionRuntimeState: vi.fn(() => ({
        runtimeKind: 'interactive',
        historySeedPending: false,
        permissionState: runtimeState
      })),
      updateSessionRuntimeState,
      getSession: vi.fn(() => ({
        id: 'sess-kimi',
        adapter: 'kimi'
      }))
    })

    await syncPermissionStateMirror('sess-kimi')

    const mirrorContent = String(mocks.writeFile.mock.calls.at(-1)?.[1] ?? '{}')
    expect(JSON.parse(mirrorContent)).toMatchObject({
      sessionId: 'sess-kimi',
      adapter: 'kimi',
      permissionState: {
        allow: ['Bash']
      }
    })
  })

  it('writes allow_project into project config and removes conflicting managed keys', async () => {
    runtimeState = {
      allow: [],
      deny: ['Write'],
      onceAllow: ['Write'],
      onceDeny: ['Write']
    }
    projectConfig.permissions = {
      allow: ['Read', 'Bash:*'],
      deny: ['Write'],
      ask: ['Write', 'Edit']
    }

    await applyPermissionInteractionDecision({
      sessionId: 'sess-1',
      subjectKeys: ['Write'],
      action: 'allow_project'
    })

    expect(projectConfig.permissions).toEqual({
      allow: ['Read', 'Bash:*', 'Write'],
      deny: [],
      ask: ['Edit']
    })
    expect(runtimeState).toEqual({
      allow: ['Write'],
      deny: [],
      onceAllow: [],
      onceDeny: []
    })
  })

  it('does not copy global permissions into project config when storing project decisions', async () => {
    const projectSourceConfig = {
      permissions: {
        allow: ['ProjectOnly'],
        deny: ['Write'],
        ask: ['Edit']
      }
    }
    mocks.loadConfigState.mockResolvedValueOnce({
      workspaceFolder: '/workspace',
      globalConfig: {
        permissions: {
          allow: ['GlobalOnly'],
          deny: [],
          ask: []
        }
      },
      projectConfig: {
        permissions: {
          allow: ['GlobalOnly', 'ProjectOnly'],
          deny: ['Write'],
          ask: ['Edit']
        }
      },
      projectSource: {
        rawConfig: projectSourceConfig,
        resolvedConfig: projectSourceConfig
      },
      mergedConfig: {
        permissions: {
          allow: ['GlobalOnly', 'ProjectOnly'],
          deny: ['Write'],
          ask: ['Edit']
        }
      }
    })

    await applyPermissionInteractionDecision({
      sessionId: 'sess-1',
      subjectKeys: ['Write'],
      action: 'allow_project'
    })

    expect(mocks.updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'project',
      value: expect.objectContaining({
        permissions: {
          allow: ['ProjectOnly', 'Write'],
          deny: [],
          ask: ['Edit']
        }
      })
    }))
  })

  it('stores custom MCP subject keys in canonical lowercase form', async () => {
    runtimeState = {
      allow: [],
      deny: [],
      onceAllow: [],
      onceDeny: []
    }
    projectConfig.permissions = {
      allow: ['Channel-lark-test'],
      deny: [],
      ask: []
    }

    await applyPermissionInteractionDecision({
      sessionId: 'sess-1',
      subjectKeys: ['Channel-lark-test'],
      action: 'allow_project'
    })

    expect(projectConfig.permissions).toEqual({
      allow: ['channel-lark-test'],
      deny: [],
      ask: []
    })
    expect(runtimeState).toEqual({
      allow: ['channel-lark-test'],
      deny: [],
      onceAllow: [],
      onceDeny: []
    })
  })

  it('writes deny_project into project config and removes conflicting session allowances', async () => {
    runtimeState = {
      allow: ['Write'],
      deny: [],
      onceAllow: ['Write'],
      onceDeny: ['Write']
    }
    projectConfig.permissions = {
      allow: ['Write', 'Read'],
      deny: ['Bash:*'],
      ask: ['Write']
    }

    await applyPermissionInteractionDecision({
      sessionId: 'sess-1',
      subjectKeys: ['Write'],
      action: 'deny_project'
    })

    expect(projectConfig.permissions).toEqual({
      allow: ['Read'],
      deny: ['Bash:*', 'Write'],
      ask: []
    })
    expect(runtimeState).toEqual({
      allow: [],
      deny: ['Write'],
      onceAllow: [],
      onceDeny: []
    })
  })

  it('records deny_session without mutating project config', async () => {
    runtimeState = {
      allow: ['Write'],
      deny: [],
      onceAllow: ['Write'],
      onceDeny: []
    }
    projectConfig.permissions = {
      allow: ['Read'],
      deny: ['Bash'],
      ask: []
    }

    await applyPermissionInteractionDecision({
      sessionId: 'sess-1',
      subjectKeys: ['Write'],
      action: 'deny_session'
    })

    expect(projectConfig.permissions).toEqual({
      allow: ['Read'],
      deny: ['Bash'],
      ask: []
    })
    expect(runtimeState).toEqual({
      allow: [],
      deny: ['Write'],
      onceAllow: [],
      onceDeny: []
    })
  })
})
