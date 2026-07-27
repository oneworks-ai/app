/* eslint-disable max-lines -- end-to-end plugin contract cases intentionally share one isolated fixture. */
import { Buffer } from 'node:buffer'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { parseEnsureRecovery } from '../server/src/driver.js'
import { activatePlugin } from '../server/src/index.js'
import type { CuaPluginApiRegistration } from '../server/src/types.js'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const wrapper = require('../bin/cua-driver.cjs') as {
  agentCursorOutputIsReady: (output: string) => boolean
  cleanupStaleDaemonState: (options: {
    cacheDir: string
    isProcessAlive: (pid: number) => boolean
  }) => boolean
  checkPermissions: (
    driverBinary: string,
    options: {
      prompt: boolean
      quiet: boolean
      stderrOnly: boolean
      runCaptured: () => { status: number; stdout: string; stderr: string }
    }
  ) => { failureKind: string; granted: boolean }
  driverSupportsAgentCursorTurnRadius: (
    driverBinary: string,
    options: {
      runCaptured: () => { status: number; stdout: string; stderr: string }
    }
  ) => boolean
  findOnPath: (
    name: string,
    options: {
      cwd: string
      pathValue: string
      wrapperRealPath: string
    }
  ) => string | undefined
  resolveDriverBinary: (options: {
    appBinaryPath: string
    cwd: string
    pathValue: string
    userBinaryPath: string
    wrapperRealPath: string
  }) => string | undefined
  ensureAgentCursor: (
    driverBinary: string,
    options: {
      runCaptured: (command: string, args: string[]) => {
        status: number
        stdout: string
        stderr: string
      }
    }
  ) => { changed: boolean; ready: boolean }
  permissionOutputIsGranted: (output: string) => boolean
  permissionStateFromOutput: (output: string) => {
    accessibility: 'granted' | 'required' | 'unknown'
    screenRecording: 'granted' | 'required' | 'unknown'
  }
}
const mcpProxy = require('../bin/mcp-proxy.cjs') as {
  allowedTools: Set<string>
  createSerialTaskQueue: () => <T>(task: () => Promise<T> | T) => Promise<T>
  initializeFailureResponse: (id: number, diagnosticOutput: string) => Record<string, any>
  parseJsonLine: (line: string) => { ok: boolean; value?: unknown; error?: Record<string, any> }
  parseRecoveryFromOutput: (output: string) => Record<string, unknown>
  transformClientMessage: (
    message: Record<string, unknown>,
    pendingToolLists: Set<string>
  ) => {
    forward?: Record<string, unknown>
    localCall?: Record<string, unknown>
    respond?: Record<string, any>
    styledCall?: Record<string, unknown>
  }
  transformServerMessage: (
    message: Record<string, any>,
    pendingToolLists: Set<string>
  ) => Record<string, any>
  sessionCursorStartToolDefinition: {
    inputSchema: Record<string, unknown>
    name: string
  }
  toolCallPolicyError: (toolName: unknown, toolArguments: Record<string, unknown>) => string | undefined
  workflowToolDefinitions: Array<{
    inputSchema: { properties: Record<string, unknown> }
    name: string
  }>
}
const applicationPermissions = require('../bin/application-permissions.cjs') as {
  createApplicationApprovalRequester: (options: {
    isSupported: () => boolean
    write: (message: Record<string, unknown>) => void
  }) => {
    handleResponse: (message: Record<string, unknown>) => boolean
    request: (input: {
      targets: Array<{ bundleId?: string; name?: string }>
      toolName: string
    }) => Promise<boolean>
    stop: () => void
  }
  createApplicationPermissionGuard: (options: {
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
    config: {
      defaultMode: 'always_allow' | 'always_ask' | 'deny'
      rules: Array<{ bundleId: string; mode: 'always_allow' | 'always_ask' | 'deny' }>
    }
    getWorkflowBundleIds?: (runId: string) => string[]
    requestApproval?: (input: {
      targets: Array<{ bundleId?: string; name?: string }>
      toolName: string
    }) => Promise<boolean>
    supportsApproval?: () => boolean
  }) => {
    authorize: (name: string, args: Record<string, unknown>) => Promise<unknown>
  }
  readApplicationPermissionConfig: (env: Record<string, string>) => {
    defaultMode: 'always_allow' | 'always_ask' | 'deny'
    rules: Array<{ bundleId: string; mode: 'always_allow' | 'always_ask' | 'deny' }>
  }
}
const evidence = require('../bin/evidence-mcp.cjs') as {
  finalizeRecording: (
    payload: { expected_state_text?: string[]; output_dir: string },
    options: { ffmpegPath: string }
  ) => {
    nativeFrameCount: number
    reusedScreenshotCount: number
    screenshotPath: string
    turnCount: number
    usedTrajectoryFallback: boolean
    verifiedStateText: string[]
    videoPath: string
  }
}

const readJson = async (name: string) =>
  JSON.parse(
    await readFile(new URL(`../${name}`, import.meta.url), 'utf8')
  ) as Record<string, unknown>

describe('cua-driver plugin contract', () => {
  it('serializes session operations and continues after a rejected operation', async () => {
    const enqueue = mcpProxy.createSerialTaskQueue()
    const events: string[] = []
    let releaseFirst!: () => void
    let notifyFirstStarted!: () => void
    const firstStarted = new Promise<void>(resolve => {
      notifyFirstStarted = resolve
    })
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const first = enqueue(async () => {
      events.push('first:start')
      notifyFirstStarted()
      await firstGate
      events.push('first:end')
    })
    await firstStarted
    const second = enqueue(async () => {
      events.push('second')
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second'])

    await expect(enqueue(async () => {
      throw new Error('expected queue failure')
    })).rejects.toThrow('expected queue failure')
    await expect(enqueue(async () => 'recovered')).resolves.toBe('recovered')
  })

  it('only treats both required macOS permissions as ready', () => {
    expect(wrapper.permissionOutputIsGranted(
      '✅ Accessibility: granted.\n✅ Screen Recording: granted.\n'
    )).toBe(true)
    expect(wrapper.permissionOutputIsGranted(
      '✅ Accessibility: granted.\n❌ Screen Recording: denied.\n'
    )).toBe(false)
    expect(wrapper.permissionStateFromOutput(
      '❌ Accessibility: denied.\n✅ Screen Recording: granted.\n'
    )).toEqual({ accessibility: 'required', screenRecording: 'granted' })
    expect(wrapper.permissionStateFromOutput('daemon connection failed')).toEqual({
      accessibility: 'unknown',
      screenRecording: 'unknown'
    })
    const rustPermissionOutput = JSON.stringify({
      accessibility: true,
      screen_recording: true,
      screen_recording_capturable: true
    })
    expect(wrapper.permissionOutputIsGranted(rustPermissionOutput)).toBe(true)
    expect(wrapper.permissionStateFromOutput(rustPermissionOutput)).toEqual({
      accessibility: 'granted',
      screenRecording: 'granted'
    })
    const wrongProcessPermissionOutput = JSON.stringify({
      accessibility: true,
      screen_recording: true,
      screen_recording_capturable: false
    })
    expect(wrapper.permissionOutputIsGranted(wrongProcessPermissionOutput)).toBe(false)
    expect(wrapper.permissionStateFromOutput(wrongProcessPermissionOutput)).toEqual({
      accessibility: 'granted',
      screenRecording: 'required'
    })
  })

  it('returns structured recovery only for explicit permission failures', () => {
    expect(parseEnsureRecovery({
      stdout: '',
      stderr: '[cua-driver] permission-required: Accessibility, Screen & System Audio Recording\n'
    })).toEqual({
      kind: 'macos-permissions',
      missingPermissions: ['Accessibility', 'Screen & System Audio Recording'],
      settingsPath: 'System Settings → Privacy & Security',
      retryOriginalTask: true
    })
    expect(parseEnsureRecovery({
      stdout: '',
      stderr: '[cua-driver] permission-check-failed: socket unavailable\n'
    })).toEqual({ kind: 'runtime-retry', retryOriginalTask: true })
    expect(parseEnsureRecovery({ stdout: '', stderr: 'unrelated failure' })).toBeUndefined()
  })

  it('keeps MCP permission diagnostics off protocol stdout', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const result = wrapper.checkPermissions('/tmp/cua-driver', {
        prompt: true,
        quiet: true,
        stderrOnly: true,
        runCaptured: () => ({
          status: 1,
          stdout: 'Accessibility: denied\nScreen Recording: granted\n',
          stderr: ''
        })
      })
      expect(result).toEqual(expect.objectContaining({
        failureKind: 'permissions',
        granted: false
      }))
      expect(stdout).not.toHaveBeenCalled()
      expect(stderr).toHaveBeenCalled()
    } finally {
      stdout.mockRestore()
      stderr.mockRestore()
    }
  })

  it('filters upstream MCP tools through the OneWorks safety profile', () => {
    const pendingToolLists = new Set<string>()
    const listRequest = { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} }
    expect(mcpProxy.transformClientMessage(listRequest, pendingToolLists)).toEqual({
      forward: listRequest
    })
    const filtered = mcpProxy.transformServerMessage({
      jsonrpc: '2.0',
      id: 7,
      result: {
        tools: [
          { name: 'click' },
          { name: 'move_cursor' },
          { name: 'set_agent_cursor_enabled' },
          { name: 'set_recording' }
        ]
      }
    }, pendingToolLists)
    expect(filtered.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'click',
      'execute_workflow',
      'execute_workflows',
      'resume_workflow',
      'get_workflow_step_results',
      'set_session_cursor_color',
      'set_session_cursor_start'
    ])
    const workflowDefinition = mcpProxy.workflowToolDefinitions
      .find((tool: { name: string }) => tool.name === 'execute_workflow')
    expect(workflowDefinition?.inputSchema.properties.cursor_start).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y'],
      description: expect.stringContaining('main-display center'),
      properties: {
        x: { type: 'number', minimum: 0 },
        y: { type: 'number', minimum: 0 }
      }
    })
    expect(mcpProxy.sessionCursorStartToolDefinition).toEqual(expect.objectContaining({
      name: 'set_session_cursor_start',
      inputSchema: expect.objectContaining({ required: ['x', 'y'] })
    }))

    const workflow = mcpProxy.transformClientMessage({
      jsonrpc: '2.0',
      id: 71,
      method: 'tools/call',
      params: { name: 'execute_workflow', arguments: { steps: [{ op: 'sleep', duration_ms: 1 }] } }
    }, pendingToolLists)
    expect(workflow.localCall).toEqual(expect.objectContaining({
      id: 71,
      name: 'execute_workflow'
    }))

    const cursorColor = mcpProxy.transformClientMessage({
      jsonrpc: '2.0',
      id: 72,
      method: 'tools/call',
      params: { name: 'set_session_cursor_color', arguments: { color: '#625BF6' } }
    }, pendingToolLists)
    expect(cursorColor.localCall).toEqual(expect.objectContaining({
      id: 72,
      name: 'set_session_cursor_color'
    }))

    const cursorStart = mcpProxy.transformClientMessage({
      jsonrpc: '2.0',
      id: 721,
      method: 'tools/call',
      params: { name: 'set_session_cursor_start', arguments: { x: 120, y: 240 } }
    }, pendingToolLists)
    expect(cursorStart.localCall).toEqual(expect.objectContaining({
      id: 721,
      name: 'set_session_cursor_start'
    }))

    const click = mcpProxy.transformClientMessage({
      jsonrpc: '2.0',
      id: 73,
      method: 'tools/call',
      params: { name: 'click', arguments: { element_index: 4 } }
    }, pendingToolLists)
    expect(click.styledCall).toEqual(expect.objectContaining({
      id: 73,
      name: 'click'
    }))

    const blocked = mcpProxy.transformClientMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'move_cursor', arguments: { x: 10, y: 10 } }
    }, pendingToolLists)
    expect(blocked.respond?.error).toEqual(expect.objectContaining({ code: -32601 }))
    expect(mcpProxy.allowedTools.has('set_agent_cursor_enabled')).toBe(false)
    expect(mcpProxy.toolCallPolicyError('set_agent_cursor_style', {
      image_path: '/tmp/untrusted.svg'
    })).toContain('not exposed')
    expect(mcpProxy.allowedTools.has('replay_trajectory')).toBe(false)
    expect(mcpProxy.allowedTools.has('set_recording')).toBe(false)
    expect(mcpProxy.allowedTools.has('get_recording_state')).toBe(false)
    expect(mcpProxy.allowedTools.has('drag')).toBe(false)
    expect(mcpProxy.allowedTools.has('hotkey')).toBe(false)
    expect(mcpProxy.allowedTools.has('page')).toBe(false)
    expect(mcpProxy.toolCallPolicyError('press_key', { key: 'ESC' })).toBeUndefined()
    expect(mcpProxy.toolCallPolicyError('press_key', { key: 'ESC', window_id: 42 }))
      .toContain('activate the target application')

    const batch = mcpProxy.transformClientMessage([
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'move_cursor', arguments: { x: 10, y: 10 } }
      }
    ] as unknown as Record<string, unknown>, pendingToolLists)
    expect(batch.forward).toBeUndefined()
    expect(batch.respond?.error).toEqual(expect.objectContaining({ code: -32600 }))
    expect(
      mcpProxy.transformClientMessage(
        'not-an-object' as unknown as Record<string, unknown>,
        pendingToolLists
      ).respond?.error
    ).toEqual(expect.objectContaining({ code: -32600 }))
    expect(mcpProxy.parseJsonLine('{')).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({
        error: expect.objectContaining({ code: -32700 })
      })
    }))
  })

  it('enforces per-application CUA rules before dispatch', async () => {
    const requestApproval = vi.fn().mockResolvedValue(true)
    const callTool = vi.fn().mockResolvedValue({
      structuredContent: {
        apps: [
          { bundle_id: 'com.apple.TextEdit', name: 'TextEdit', pid: 110 },
          { bundle_id: 'com.apple.Safari', name: 'Safari', pid: 120 }
        ]
      }
    })
    const guard = applicationPermissions.createApplicationPermissionGuard({
      callTool,
      config: {
        defaultMode: 'always_ask',
        rules: [
          { bundleId: 'com.apple.TextEdit', mode: 'always_allow' },
          { bundleId: 'com.apple.Safari', mode: 'deny' }
        ]
      },
      requestApproval,
      supportsApproval: () => true
    })

    await expect(guard.authorize('type_text', { pid: 110, text: 'hello' })).resolves.toMatchObject({
      mode: 'always_allow'
    })
    await expect(guard.authorize('click', { pid: 120, element_index: 1 })).rejects.toMatchObject({
      code: 'APPLICATION_ACCESS_DENIED',
      rpcCode: -32003,
      data: expect.objectContaining({
        applications: [{ bundle_id: 'com.apple.Safari', label: 'Safari (com.apple.Safari)' }],
        decision: 'deny',
        retryOriginalTask: false
      })
    })
    expect(requestApproval).not.toHaveBeenCalled()
  })

  it('checks pid and window identities together so a denied window cannot borrow an allowed pid', async () => {
    const callTool = vi.fn(async (name: string) =>
      name === 'list_apps'
        ? {
          structuredContent: {
            apps: [
              { bundle_id: 'com.allowed.Editor', name: 'Editor', pid: 110 },
              { bundle_id: 'com.denied.Mail', name: 'Mail', pid: 120 }
            ]
          }
        }
        : {
          structuredContent: {
            windows: [{ window_id: 22, pid: 120 }]
          }
        }
    )
    const guard = applicationPermissions.createApplicationPermissionGuard({
      callTool,
      config: {
        defaultMode: 'always_ask',
        rules: [
          { bundleId: 'com.allowed.Editor', mode: 'always_allow' },
          { bundleId: 'com.denied.Mail', mode: 'deny' }
        ]
      },
      requestApproval: vi.fn().mockResolvedValue(true),
      supportsApproval: () => true
    })

    await expect(guard.authorize('click', {
      element_index: 1,
      pid: 110,
      window_id: 22
    })).rejects.toMatchObject({
      code: 'APPLICATION_ACCESS_DENIED',
      rpcCode: -32003,
      data: expect.objectContaining({
        applications: [{ bundle_id: 'com.denied.Mail', label: 'Mail (com.denied.Mail)' }],
        decision: 'deny'
      })
    })
    expect(callTool.mock.calls.map(([name]) => name)).toEqual(['list_apps', 'list_windows'])
  })

  it('applies the default policy when a supplied pid or window identity cannot be resolved', async () => {
    const callTool = vi.fn(async (name: string) =>
      name === 'list_apps'
        ? {
          structuredContent: {
            apps: [{ bundle_id: 'com.allowed.Editor', name: 'Editor', pid: 110 }]
          }
        }
        : { structuredContent: { windows: [] } }
    )
    const guard = applicationPermissions.createApplicationPermissionGuard({
      callTool,
      config: {
        defaultMode: 'deny',
        rules: [{ bundleId: 'com.allowed.Editor', mode: 'always_allow' }]
      },
      requestApproval: vi.fn().mockResolvedValue(true),
      supportsApproval: () => true
    })

    await expect(guard.authorize('click', {
      element_index: 1,
      pid: 110,
      window_id: 404
    })).rejects.toMatchObject({
      code: 'APPLICATION_ACCESS_DENIED',
      data: expect.objectContaining({
        applications: [{ label: 'Unresolved computer-control target' }],
        decision: 'deny'
      })
    })
  })

  it('asks once for a multi-application workflow and rechecks resumed runs', async () => {
    const requestApproval = vi.fn().mockResolvedValue(true)
    const guard = applicationPermissions.createApplicationPermissionGuard({
      callTool: vi.fn().mockResolvedValue({ structuredContent: { apps: [] } }),
      config: { defaultMode: 'always_ask', rules: [] },
      getWorkflowBundleIds: runId =>
        runId === 'run_1'
          ? ['com.apple.TextEdit', 'com.apple.Calculator']
          : [],
      requestApproval,
      supportsApproval: () => true
    })
    await guard.authorize('execute_workflows', {
      workflows: [
        { contexts: { editor: { bundle_id: 'com.apple.TextEdit' } }, steps: [] },
        { contexts: { calculator: { bundle_id: 'com.apple.Calculator' } }, steps: [] }
      ]
    })
    await guard.authorize('resume_workflow', { run_id: 'run_1', decision: 'continue' })

    expect(requestApproval).toHaveBeenCalledTimes(2)
    expect(requestApproval.mock.calls[0]?.[0].targets).toHaveLength(2)
    expect(requestApproval.mock.calls[1]?.[0].targets).toHaveLength(2)
  })

  it('fails closed when required confirmation is unavailable or declined', async () => {
    const base = {
      callTool: vi.fn().mockResolvedValue({ structuredContent: { apps: [] } }),
      config: { defaultMode: 'always_ask' as const, rules: [] }
    }
    const unsupported = applicationPermissions.createApplicationPermissionGuard({
      ...base,
      requestApproval: vi.fn().mockResolvedValue(true),
      supportsApproval: () => false
    })
    await expect(unsupported.authorize('launch_app', {
      bundle_id: 'com.apple.TextEdit'
    })).rejects.toMatchObject({
      code: 'APPLICATION_CONFIRMATION_UNSUPPORTED',
      rpcCode: -32005
    })

    const declined = applicationPermissions.createApplicationPermissionGuard({
      ...base,
      requestApproval: vi.fn().mockResolvedValue(false),
      supportsApproval: () => true
    })
    await expect(declined.authorize('launch_app', {
      bundle_id: 'com.apple.TextEdit'
    })).rejects.toMatchObject({
      code: 'APPLICATION_ACCESS_NOT_APPROVED',
      rpcCode: -32004
    })
  })

  it('fails closed when the pid points to another app after confirmation', async () => {
    const callTool = vi.fn()
      .mockResolvedValueOnce({
        structuredContent: {
          apps: [{ bundle_id: 'com.apple.TextEdit', name: 'TextEdit', pid: 110 }]
        }
      })
      .mockResolvedValueOnce({
        structuredContent: {
          apps: [{ bundle_id: 'com.apple.Safari', name: 'Safari', pid: 110 }]
        }
      })
    const guard = applicationPermissions.createApplicationPermissionGuard({
      callTool,
      config: { defaultMode: 'always_ask', rules: [] },
      requestApproval: vi.fn().mockResolvedValue(true),
      supportsApproval: () => true
    })

    await expect(guard.authorize('type_text', {
      pid: 110,
      text: 'hello'
    })).rejects.toMatchObject({
      code: 'APPLICATION_PERMISSION_CONTEXT_CHANGED',
      rpcCode: -32006,
      data: expect.objectContaining({
        applications: [{ bundle_id: 'com.apple.Safari', label: 'Safari (com.apple.Safari)' }],
        decision: 'changed'
      })
    })
  })

  it('rechecks both pid and window identities after confirmation', async () => {
    let appResolution = 0
    const callTool = vi.fn(async (name: string) => {
      if (name === 'list_windows') {
        return {
          structuredContent: {
            windows: [{ window_id: 22, pid: appResolution === 1 ? 110 : 120 }]
          }
        }
      }
      appResolution += 1
      return {
        structuredContent: {
          apps: [
            { bundle_id: 'com.apple.TextEdit', name: 'TextEdit', pid: 110 },
            { bundle_id: 'com.apple.Mail', name: 'Mail', pid: 120 }
          ]
        }
      }
    })
    const guard = applicationPermissions.createApplicationPermissionGuard({
      callTool,
      config: { defaultMode: 'always_ask', rules: [] },
      requestApproval: vi.fn().mockResolvedValue(true),
      supportsApproval: () => true
    })

    await expect(guard.authorize('click', {
      element_index: 1,
      pid: 110,
      window_id: 22
    })).rejects.toMatchObject({
      code: 'APPLICATION_PERMISSION_CONTEXT_CHANGED',
      rpcCode: -32006,
      data: expect.objectContaining({
        applications: expect.arrayContaining([
          { bundle_id: 'com.apple.TextEdit', label: 'TextEdit (com.apple.TextEdit)' },
          { bundle_id: 'com.apple.Mail', label: 'Mail (com.apple.Mail)' }
        ]),
        decision: 'changed'
      })
    })
    expect(callTool.mock.calls.map(([name]) => name)).toEqual([
      'list_apps',
      'list_windows',
      'list_apps',
      'list_windows'
    ])
  })

  it('uses a one-operation MCP elicitation request for ask mode', async () => {
    const writes: Array<Record<string, any>> = []
    const requester = applicationPermissions.createApplicationApprovalRequester({
      isSupported: () => true,
      write: message => writes.push(message)
    })
    const pending = requester.request({
      targets: [{ bundleId: 'com.apple.TextEdit', name: 'TextEdit' }],
      toolName: 'type_text'
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      method: 'elicitation/create',
      params: {
        mode: 'form',
        requestedSchema: { type: 'object', properties: {} },
        _meta: {
          codex_approval_kind: 'mcp_tool_call',
          tool_params: {
            applications: ['TextEdit (com.apple.TextEdit)'],
            tool: 'type_text'
          }
        }
      }
    })
    expect(requester.handleResponse({
      jsonrpc: '2.0',
      id: writes[0].id,
      result: { action: 'accept', content: {} }
    })).toBe(true)
    await expect(pending).resolves.toBe(true)
    requester.stop()
  })

  it('normalizes application permission configuration safely', () => {
    expect(applicationPermissions.readApplicationPermissionConfig({
      ONEWORKS_CUA_DEFAULT_APPLICATION_PERMISSION: 'deny',
      ONEWORKS_CUA_APPLICATION_PERMISSIONS: JSON.stringify([
        { bundleId: 'com.apple.TextEdit', mode: 'always_allow' },
        { bundleId: 'COM.APPLE.TEXTEDIT', mode: 'deny' },
        { bundleId: 'com.apple.Safari', mode: 'invalid' }
      ])
    })).toEqual({
      defaultMode: 'deny',
      rules: [
        { bundleId: 'com.apple.TextEdit', mode: 'deny' },
        { bundleId: 'com.apple.Safari', mode: 'always_ask' }
      ]
    })
    expect(applicationPermissions.readApplicationPermissionConfig({
      ONEWORKS_CUA_DEFAULT_APPLICATION_PERMISSION: 'unknown',
      ONEWORKS_CUA_APPLICATION_PERMISSIONS: '{'
    })).toEqual({ defaultMode: 'always_ask', rules: [] })
  })

  it('enforces the strictest case-insensitive duplicate application rule', async () => {
    const config = applicationPermissions.readApplicationPermissionConfig({
      ONEWORKS_CUA_DEFAULT_APPLICATION_PERMISSION: 'always_allow',
      ONEWORKS_CUA_APPLICATION_PERMISSIONS: JSON.stringify([
        { bundleId: 'com.apple.TextEdit', mode: 'always_allow' },
        { bundleId: 'COM.APPLE.TEXTEDIT', mode: 'deny' }
      ])
    })
    const guard = applicationPermissions.createApplicationPermissionGuard({
      callTool: vi.fn().mockResolvedValue({
        structuredContent: {
          apps: [{ bundle_id: 'com.apple.TextEdit', name: 'TextEdit', pid: 110 }]
        }
      }),
      config,
      requestApproval: vi.fn().mockResolvedValue(true),
      supportsApproval: () => true
    })

    await expect(guard.authorize('type_text', {
      pid: 110,
      text: 'hello'
    })).rejects.toMatchObject({
      code: 'APPLICATION_ACCESS_DENIED',
      data: expect.objectContaining({ decision: 'deny' })
    })
  })

  it('maps MCP startup failures to actionable recovery data', () => {
    expect(mcpProxy.parseRecoveryFromOutput(
      '[cua-driver] permission-required: Accessibility, Screen & System Audio Recording\n'
    )).toEqual({
      kind: 'macos-permissions',
      missingPermissions: ['Accessibility', 'Screen & System Audio Recording'],
      settingsPath: 'System Settings → Privacy & Security',
      retryOriginalTask: true
    })
    expect(mcpProxy.parseRecoveryFromOutput('installation failed')).toEqual({
      kind: 'runtime-retry',
      retryOriginalTask: true
    })
    expect(mcpProxy.initializeFailureResponse(
      41,
      '[cua-driver] permission-required: Accessibility\n'
    )).toEqual({
      jsonrpc: '2.0',
      id: 41,
      error: {
        code: -32001,
        message: 'Computer control needs macOS permission before it can continue.',
        data: {
          kind: 'macos-permissions',
          missingPermissions: ['Accessibility'],
          settingsPath: 'System Settings → Privacy & Security',
          retryOriginalTask: true
        }
      }
    })
  })

  it('prepares and verifies the visible Agent pointer procedurally', () => {
    const readyOutput = JSON.stringify({ cursors: [], enabled: true })
    const results = [
      {
        status: 0,
        stdout: 'cursor: enabled=false glideDurationMs=750 dwellAfterClickMs=400 idleHideMs=8000',
        stderr: ''
      },
      { status: 0, stdout: 'cursor: enabled=true', stderr: '' },
      { status: 0, stdout: readyOutput, stderr: '' }
    ]
    const calls: Array<{ command: string; args: string[] }> = []

    const prepared = wrapper.ensureAgentCursor('/tmp/cua-driver', {
      runCaptured(command, args) {
        calls.push({ command, args })
        return results.shift()!
      }
    })

    expect(prepared).toEqual(expect.objectContaining({ changed: true, ready: true }))
    expect(calls).toEqual([
      {
        command: '/tmp/cua-driver',
        args: ['call', 'get_agent_cursor_state', '{}']
      },
      {
        command: '/tmp/cua-driver',
        args: ['call', 'set_agent_cursor_enabled', '{"enabled":true}']
      },
      {
        command: '/tmp/cua-driver',
        args: ['call', 'get_agent_cursor_state', '{}']
      }
    ])
    expect(wrapper.agentCursorOutputIsReady(readyOutput)).toBe(true)
  })

  it('leaves an already-ready Agent pointer unchanged', () => {
    const calls: string[][] = []
    const prepared = wrapper.ensureAgentCursor('/tmp/cua-driver', {
      runCaptured(_command, args) {
        calls.push(args)
        return {
          status: 0,
          stdout: JSON.stringify({ cursors: [], enabled: true }),
          stderr: ''
        }
      }
    })

    expect(prepared).toEqual(expect.objectContaining({ changed: false, ready: true }))
    expect(calls).toEqual([['call', 'get_agent_cursor_state', '{}']])
  })

  it('requires the upstream cursor motion schema to expose turn_radius', () => {
    expect(wrapper.driverSupportsAgentCursorTurnRadius('/tmp/cua-driver', {
      runCaptured: () => ({
        status: 0,
        stdout: 'input_schema: {"properties":{"turn_radius":{"minimum":1}}}',
        stderr: ''
      })
    })).toBe(true)
    expect(wrapper.driverSupportsAgentCursorTurnRadius('/tmp/cua-driver', {
      runCaptured: () => ({
        status: 0,
        stdout: 'input_schema: {"properties":{"arc_size":{"minimum":0}}}',
        stderr: ''
      })
    })).toBe(false)
  })

  it('never resolves a relative workspace package bin as the real driver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-cua-driver-'))
    const workspaceBin = join(root, 'node_modules', '.bin')
    const realBin = join(root, 'real-bin')
    const wrapperPath = join(root, 'plugin-wrapper.cjs')
    const workspaceDriver = join(workspaceBin, 'cua-driver')
    const realDriver = join(realBin, 'cua-driver')

    try {
      await Promise.all([
        mkdir(workspaceBin, { recursive: true }),
        mkdir(realBin, { recursive: true })
      ])
      await Promise.all([
        writeFile(wrapperPath, '#!/bin/sh\nexit 0\n'),
        writeFile(workspaceDriver, '#!/bin/sh\nexit 0\n'),
        writeFile(realDriver, '#!/bin/sh\nexit 0\n')
      ])
      await Promise.all([
        chmod(wrapperPath, 0o755),
        chmod(workspaceDriver, 0o755),
        chmod(realDriver, 0o755)
      ])

      expect(wrapper.findOnPath('cua-driver', {
        cwd: root,
        pathValue: 'node_modules/.bin',
        wrapperRealPath: wrapperPath
      })).toBeUndefined()
      expect(wrapper.resolveDriverBinary({
        appBinaryPath: join(root, 'missing-app-driver'),
        cwd: root,
        pathValue: 'node_modules/.bin',
        userBinaryPath: join(root, 'missing-user-driver'),
        wrapperRealPath: wrapperPath
      })).toBeUndefined()
      expect(wrapper.findOnPath('cua-driver', {
        cwd: root,
        pathValue: ['node_modules/.bin', 'real-bin'].join(delimiter),
        wrapperRealPath: wrapperPath
      })).toBe(realDriver)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('removes daemon IPC files only after the recorded process is dead', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'oneworks-cua-daemon-'))
    const files = ['cua-driver.sock', 'cua-driver.pid', 'cua-driver.lock']
    try {
      await Promise.all(files.map(file => writeFile(join(cacheDir, file), file === 'cua-driver.pid' ? '33002' : '')))

      expect(wrapper.cleanupStaleDaemonState({
        cacheDir,
        isProcessAlive: pid => pid === 33002
      })).toBe(false)
      await expect(readFile(join(cacheDir, 'cua-driver.sock'))).resolves.toBeInstanceOf(Buffer)

      expect(wrapper.cleanupStaleDaemonState({
        cacheDir,
        isProcessAlive: () => false
      })).toBe(true)
      await expect(readFile(join(cacheDir, 'cua-driver.sock'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(cacheDir, { force: true, recursive: true })
    }
  })

  it('finalizes zero-frame recordings through the procedural trajectory fallback', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'oneworks-cua-recording-'))
    const turnDir = join(outputDir, 'turn-00001')
    const turnWithoutScreenshot = join(outputDir, 'turn-00002')
    const fakeFfmpeg = join(outputDir, 'ffmpeg')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nE8AAAAASUVORK5CYII=',
      'base64'
    )
    try {
      await Promise.all([
        mkdir(turnDir, { recursive: true }),
        mkdir(turnWithoutScreenshot, { recursive: true })
      ])
      await Promise.all([
        writeFile(
          join(outputDir, 'session.json'),
          JSON.stringify({
            video: { frame_count: 0, path: 'recording.mp4' }
          })
        ),
        writeFile(join(turnDir, 'action.json'), '{}'),
        writeFile(join(turnDir, 'app_state.json'), JSON.stringify({ tree_markdown: 'Total: DONE' })),
        writeFile(join(turnDir, 'screenshot.png'), png),
        writeFile(join(turnWithoutScreenshot, 'action.json'), '{}'),
        writeFile(join(turnWithoutScreenshot, 'app_state.json'), '{}'),
        writeFile(join(outputDir, 'recording_rendered.mp4'), 'stale'),
        writeFile(fakeFfmpeg, '#!/bin/sh\nfor last in "$@"; do :; done\nprintf video > "$last"\n')
      ])
      await chmod(fakeFfmpeg, 0o755)

      const result = evidence.finalizeRecording({
        expected_state_text: ['total: done'],
        output_dir: outputDir
      }, { ffmpegPath: fakeFfmpeg })

      expect(result).toEqual(expect.objectContaining({
        nativeFrameCount: 0,
        reusedScreenshotCount: 1,
        turnCount: 2,
        usedTrajectoryFallback: true,
        verifiedStateText: ['total:done'],
        videoPath: join(outputDir, 'recording_rendered.mp4'),
        screenshotPath: join(outputDir, 'final-screenshot.png')
      }))
      await expect(readFile(result.videoPath, 'utf8')).resolves.toBe('video')
      await expect(readFile(result.screenshotPath)).resolves.toEqual(png)
      expect(() =>
        evidence.finalizeRecording({
          expected_state_text: ['missing result'],
          output_dir: outputDir
        }, { ffmpegPath: fakeFfmpeg })
      ).toThrow('Final app state does not contain expected text')
    } finally {
      await rm(outputDir, { force: true, recursive: true })
    }
  })

  it('uses the OneWorks package, manifest, asset, and runtime conventions', async () => {
    const [manifest, packageJson] = await Promise.all([
      readJson('plugin.json'),
      readJson('package.json')
    ])
    const plugin = manifest.plugin as {
      contributions: {
        settingsPages: Array<Record<string, unknown>>
        toolUsePresentations: Array<Record<string, unknown>>
      }
      server: { roles: string[] }
    }
    const assets = manifest.assets as Record<string, unknown>
    const config = manifest.config as {
      schema: {
        properties: {
          applicationPermissions: { default: unknown[]; maxItems: number }
          cursorColorStrategy: { default: string; oneOf: Array<{ const: string }> }
          defaultApplicationPermission: { default: string; oneOf: Array<{ const: string }> }
          defaultCursorColor: { default: string; pattern: string }
        }
      }
    }
    const exports = packageJson.exports as Record<string, unknown>
    const dependencies = packageJson.dependencies as Record<string, string>
    const serverExport = exports['./server'] as Record<string, unknown>

    expect(manifest.__oneWorksPluginManifest).toBe(true)
    expect(manifest.name).toBe('@oneworks/plugin-cua-driver')
    expect(manifest.version).toBe(packageJson.version)
    expect(dependencies['@oneworks/cursor']).toBe('workspace:*')
    expect(assets.skills).toBe('skills')
    expect(assets.mcp).toBe('mcp')
    expect(config.schema.properties.cursorColorStrategy.default).toBe('automatic')
    expect(config.schema.properties.cursorColorStrategy.oneOf.map(option => option.const)).toEqual([
      'automatic',
      'fixed'
    ])
    expect(config.schema.properties.defaultCursorColor).toEqual(expect.objectContaining({
      default: '#E3E7ED',
      pattern: '^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$'
    }))
    expect(config.schema.properties.defaultApplicationPermission).toEqual(expect.objectContaining({
      default: 'always_ask'
    }))
    expect(config.schema.properties.defaultApplicationPermission.oneOf.map(option => option.const)).toEqual([
      'always_allow',
      'always_ask',
      'deny'
    ])
    expect(config.schema.properties.applicationPermissions).toEqual(expect.objectContaining({
      default: [],
      maxItems: 200
    }))
    expect(await readJson('mcp/cua-driver.json')).toEqual({
      command: '${' + 'ONEWORKS_NODE_EXECUTABLE}',
      args: ['${' + 'ONEWORKS_PLUGIN_ROOT}/bin/mcp-proxy.cjs'],
      env: {
        HOME: '${' + 'ONEWORKS_REAL_HOME}',
        USERPROFILE: '${' + 'ONEWORKS_REAL_HOME}',
        ONEWORKS_CUA_CURSOR_STRATEGY: '${' + 'ONEWORKS_PLUGIN_OPTION:cursorColorStrategy}',
        ONEWORKS_CUA_DEFAULT_CURSOR_COLOR: '${' + 'ONEWORKS_PLUGIN_OPTION:defaultCursorColor}',
        ONEWORKS_CUA_DEFAULT_APPLICATION_PERMISSION: '${' + 'ONEWORKS_PLUGIN_OPTION:defaultApplicationPermission}',
        ONEWORKS_CUA_APPLICATION_PERMISSIONS: '${' + 'ONEWORKS_PLUGIN_OPTION:applicationPermissions}'
      },
      default_tools_approval_mode: 'approve',
      startup_timeout_sec: 30
    })
    await expect(readFile(new URL('../mcp/cua-evidence.json', import.meta.url), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(plugin.server.roles).toEqual(['manager', 'workspace'])
    expect(plugin.contributions.settingsPages).toEqual([
      expect.objectContaining({
        group: 'external-control',
        id: 'computer-use',
        clientView: 'control',
        title: 'Computer Use',
        titleI18n: {
          en: 'Computer Use',
          'zh-Hans': '电脑操作'
        }
      })
    ])
    expect(plugin.contributions).not.toHaveProperty('launcherSearchProviders')
    expect(plugin.contributions.toolUsePresentations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'execute-workflow',
        input: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ format: 'records', path: 'steps' })
          ])
        }),
        result: expect.objectContaining({ mode: 'declared' })
      }),
      expect.objectContaining({
        id: 'execute-workflows',
        tools: ['execute_workflows'],
        result: expect.objectContaining({ mode: 'declared' })
      }),
      expect.objectContaining({
        id: 'workflow-step-results',
        result: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ format: 'records', path: 'structuredContent.items' })
          ]),
          mode: 'declared'
        })
      }),
      expect.objectContaining({
        icon: 'palette',
        id: 'set-session-cursor-color',
        tools: ['set_session_cursor_color']
      }),
      expect.objectContaining({
        icon: 'my_location',
        id: 'set-session-cursor-start',
        tools: ['set_session_cursor_start']
      }),
      expect.objectContaining({
        icon: 'touch_app',
        id: 'click',
        target: 'element_index',
        tools: ['click']
      }),
      expect.objectContaining({
        icon: 'screenshot_monitor',
        id: 'inspect-window',
        tools: ['get_window_state']
      })
    ]))
    expect(exports['.']).toBe('./plugin.json')
    expect(exports['./client']).toEqual({
      source: './client/src/index.tsx',
      default: './client/dist/index.js'
    })
    expect(serverExport).toEqual({
      source: './server/src/index.ts',
      default: './server/dist/index.js'
    })
    expect(packageJson.files).toContain('mcp')
    expect(packageJson.files).toContain('client/dist')
  })

  it('registers scoped commands and documented status API metadata', async () => {
    const commands = new Map<string, (payload: unknown) => unknown>()
    const apis = new Map<string, CuaPluginApiRegistration>()
    const disposers: Array<() => unknown> = []
    const ctx = {
      scope: 'cua',
      runtime: {
        endpoint: { id: 'workspace:test', role: 'workspace' },
        role: 'workspace' as const,
        registerChannel() {},
        async invokeChannel() {}
      },
      pluginRoot,
      workspaceFolder: process.cwd(),
      projectHome: process.cwd(),
      options: {},
      logger: {
        info() {},
        warn() {},
        error() {}
      },
      registerCommand(id: string, handler: (payload: unknown) => unknown) {
        commands.set(id, handler)
      },
      registerApi(id: string, options: CuaPluginApiRegistration) {
        apis.set(id, options)
      },
      registerLocalService() {},
      dispose(callback: () => unknown) {
        disposers.push(callback)
      }
    }

    activatePlugin(ctx)

    expect([...commands.keys()]).toEqual(['status', 'driver-path', 'ensure'])
    expect([...apis.keys()]).toEqual(['status'])
    expect(apis.get('status')).toEqual(expect.objectContaining({
      title: expect.any(Object),
      description: expect.any(Object),
      inputSchema: expect.any(Object),
      outputSchema: expect.any(Object),
      headerSchema: expect.any(Object),
      handler: expect.any(Function)
    }))
    expect(disposers).toHaveLength(1)
  })
})
