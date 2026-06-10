import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'

import { spawn } from 'node:child_process'

import { CODEX_PROXY_META_HEADER_NAME } from '#~/runtime/proxy.js'
import { createCodexSession } from '#~/runtime/session.js'
import { NATIVE_HOOK_BRIDGE_ADAPTER_ENV, callHook } from '@oneworks/hooks'
import type { AdapterOutputEvent } from '@oneworks/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@oneworks/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oneworks/hooks')>()
  return {
    ...actual,
    callHook: vi.fn()
  }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn()
  }
})

const spawnMock = vi.mocked(spawn)
const callHookMock = vi.mocked(callHook)

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}

function makeCtx(overrides: {
  env?: Record<string, string>
  configs?: [unknown?, unknown?]
} = {}) {
  const cacheStore = new Map<string, unknown>()
  return {
    ctxId: 'test-ctx',
    cwd: '/tmp',
    env: overrides.env ?? {},
    cache: {
      set: async (key: string, value: unknown) => {
        cacheStore.set(key, value)
        return { cachePath: `/tmp/${key}.json` }
      },
      get: async (key: string) => cacheStore.get(key)
    },
    logger: makeMockLogger(),
    configs: overrides.configs ?? [undefined, undefined]
  } as any
}

function makeProc(options: {
  resumeError?: { code: number; message: string }
  turnStartErrors?: Record<number, { code: number; message: string }>
  threadStartIds?: string[]
  resumedThreadId?: string
} = {}) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const receivedLines: any[] = []
  let turnCount = 0
  let threadStartCount = 0
  let exitHandler: ((code: number | null) => void) | undefined

  stdin.on('data', (chunk: unknown) => {
    const text = String(chunk)
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const message = JSON.parse(trimmed)
      receivedLines.push(message)

      if (typeof message.id !== 'number') continue

      if (message.method === 'initialize') {
        stdout.push(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex/1.0' } })}\n`)
      } else if (message.method === 'thread/start') {
        threadStartCount += 1
        const threadId = options.threadStartIds?.[threadStartCount - 1] ?? `thr_${threadStartCount}`
        stdout.push(`${JSON.stringify({ id: message.id, result: { thread: { id: threadId } } })}\n`)
      } else if (message.method === 'thread/resume') {
        if (options.resumeError) {
          stdout.push(`${JSON.stringify({ id: message.id, error: options.resumeError })}\n`)
        } else {
          stdout.push(
            `${
              JSON.stringify({ id: message.id, result: { thread: { id: options.resumedThreadId ?? 'thr_resumed' } } })
            }\n`
          )
        }
      } else if (message.method === 'turn/start') {
        turnCount += 1
        const turnError = options.turnStartErrors?.[turnCount]
        if (turnError) {
          stdout.push(`${JSON.stringify({ id: message.id, error: turnError })}\n`)
        } else {
          stdout.push(`${JSON.stringify({ id: message.id, result: { turn: { id: `turn_${turnCount}` } } })}\n`)
        }
      } else if (message.method === 'turn/steer' || message.method === 'turn/interrupt') {
        stdout.push(`${JSON.stringify({ id: message.id, result: {} })}\n`)
      }
    }
  })

  const proc = {
    stdin,
    stdout,
    pid: 1234,
    on: (event: string, cb: (code: number | null) => void) => {
      if (event === 'exit') exitHandler = cb
      return proc
    },
    kill: vi.fn(() => {
      exitHandler?.(0)
      return true
    })
  } as any

  return { proc, receivedLines }
}

async function waitForWrites() {
  await new Promise(resolve => setTimeout(resolve, 20))
}

function respondToInteraction(
  session: Awaited<ReturnType<typeof createCodexSession>>,
  interactionId: string,
  answer: string | string[]
) {
  if (!('respondInteraction' in session)) {
    throw new Error('Expected stream session to support interaction responses')
  }

  session.respondInteraction(interactionId, answer)
}

function getConfigOverrides(spawnArgs: string[]) {
  return spawnArgs.filter((_, index) => spawnArgs[index - 1] === '-c')
}

function getConfigOverride(overrides: string[], prefix: string) {
  return overrides.find(override => override.startsWith(prefix))
}

function decodeProxyMeta(overrides: string[], serviceKey: string) {
  const headerOverride = getConfigOverride(overrides, `model_providers.${serviceKey}.http_headers=`)
  if (headerOverride == null) {
    throw new Error(`Missing http_headers override for ${serviceKey}`)
  }

  const encodedMeta = headerOverride.match(new RegExp(`${CODEX_PROXY_META_HEADER_NAME} = "([^"]+)"`))?.[1]
  if (encodedMeta == null) {
    throw new Error(`Missing ${CODEX_PROXY_META_HEADER_NAME} header for ${serviceKey}`)
  }

  return JSON.parse(Buffer.from(encodedMeta, 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('createCodexSession RPC approval policy mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callHookMock.mockReset()
    callHookMock.mockResolvedValue({ continue: true } as any)
  })

  afterEach(() => {
    delete process.env.HOME
  })

  it('maps default permission mode to untrusted for outgoing RPC requests', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-default',
      description: 'Reply with pong.',
      onEvent: (event: AdapterOutputEvent) => events.push(event)
    } as any)

    const startRequest = receivedLines.find(line => line.method === 'thread/start')
    expect(startRequest?.params.approvalPolicy).toBe('untrusted')

    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.approvalPolicy).toBe('untrusted')

    session.emit({
      type: 'message',
      content: [{ type: 'text', text: 'next turn' }]
    } as any)

    await waitForWrites()

    const turnRequests = receivedLines.filter(line => line.method === 'turn/start')
    expect(turnRequests).toHaveLength(2)
    expect(turnRequests[1]?.params.approvalPolicy).toBe('untrusted')

    session.kill()
    expect(events.some((event: AdapterOutputEvent) => event.type === 'exit')).toBe(true)
  })

  it('exits stream sessions when Codex reports a failed turn', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-turn-failed',
      description: 'Reply with pong.',
      onEvent: (event: AdapterOutputEvent) => events.push(event)
    } as any)

    proc.stdout.push(`${
      JSON.stringify({
        method: 'turn/completed',
        params: {
          turn: {
            id: 'turn_1',
            status: 'failed',
            items: [],
            error: {
              message: 'exceeded retry limit, last status: 429 Too Many Requests',
              codexErrorInfo: {
                responseTooManyFailedAttempts: {
                  httpStatusCode: 429
                }
              },
              additionalDetails: null
            }
          }
        }
      })
    }\n`)

    await waitForWrites()

    expect(events.map(event => event.type)).toEqual(['init', 'error', 'stop', 'exit'])
    expect(events[1]).toMatchObject({
      type: 'error',
      data: {
        fatal: true,
        message: expect.stringContaining('429 Too Many Requests')
      }
    })
    expect(events[3]).toMatchObject({
      type: 'exit',
      data: {
        exitCode: 1,
        stderr: expect.stringContaining('429 Too Many Requests')
      }
    })
  })

  it('maps plan permission mode to on-request for outgoing RPC requests', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-plan',
      permissionMode: 'plan',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    const startRequest = receivedLines.find(line => line.method === 'thread/start')
    expect(startRequest?.params.approvalPolicy).toBe('on-request')

    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.approvalPolicy).toBe('on-request')

    session.kill()
  })

  it('maps workspace file attachments into turn/start text input items', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-file-context',
      onEvent: () => {}
    } as any)

    session.emit({
      type: 'message',
      content: [{ type: 'file', path: 'apps/client/src/main.tsx' }]
    } as any)

    await waitForWrites()

    const turnRequests = receivedLines.filter(line => line.method === 'turn/start')
    expect(turnRequests).toHaveLength(1)
    expect(turnRequests[0]?.params.input).toEqual([
      { type: 'text', text: 'Context file: apps/client/src/main.tsx' }
    ])

    session.kill()
  })

  it('maps local image paths into Codex localImage attachments', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-local-image-context',
      onEvent: () => {}
    } as any)

    session.emit({
      type: 'message',
      content: [{
        type: 'image',
        url: 'data:image/png;base64,iVBORw0KGgo=',
        path: '/tmp/wechat-image.png'
      }]
    } as any)

    await waitForWrites()

    const turnRequests = receivedLines.filter(line => line.method === 'turn/start')
    expect(turnRequests).toHaveLength(1)
    expect(turnRequests[0]?.params.input).toEqual([
      { type: 'localImage', path: '/tmp/wechat-image.png' }
    ])

    session.kill()
  })

  it('keeps never unchanged for outgoing RPC requests', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-never',
      permissionMode: 'dontAsk',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    const startRequest = receivedLines.find(line => line.method === 'thread/start')
    expect(startRequest?.params.approvalPolicy).toBe('never')
    expect(startRequest?.params.sandboxPolicy).toEqual({ type: 'workspaceWrite' })

    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.approvalPolicy).toBe('never')
    expect(initialTurnRequest?.params.sandboxPolicy).toEqual({ type: 'workspaceWrite' })

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    expect(spawnArgs[0]).toBe('app-server')
    expect(spawnArgs).not.toContain('--yolo')

    session.kill()
  })

  it('enables workspace-write network access for channel-backed stream sessions', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        env: {
          __ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__: '/tmp/channel-context.json',
          __ONEWORKS_PROJECT_CHANNEL_TYPE__: 'wechat'
        }
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-channel-network',
        permissionMode: 'dontAsk',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const startRequest = receivedLines.find(line => line.method === 'thread/start')
    expect(startRequest?.params.sandboxPolicy).toEqual({ type: 'workspaceWrite', networkAccess: true })

    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.sandboxPolicy).toEqual({ type: 'workspaceWrite', networkAccess: true })

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    expect(overrides).toContain('sandbox_workspace_write.network_access=true')

    session.kill()
  })

  it('allows channel memory writes inside workspace-write sandbox sessions', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        env: {
          __ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__: '/tmp/channel-context.json',
          __ONEWORKS_PROJECT_CHANNEL_MEMORY_ROOT__: '/tmp/oneworks channel-memory',
          __ONEWORKS_PROJECT_CHANNEL_TYPE__: 'wechat'
        }
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-channel-memory',
        permissionMode: 'dontAsk',
        description: 'Remember this.',
        onEvent: () => {}
      } as any
    )

    const startRequest = receivedLines.find(line => line.method === 'thread/start')
    expect(startRequest?.params.sandboxPolicy).toEqual({
      type: 'workspaceWrite',
      networkAccess: true,
      writableRoots: ['/tmp/oneworks channel-memory']
    })

    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.sandboxPolicy).toEqual({
      type: 'workspaceWrite',
      networkAccess: true,
      writableRoots: ['/tmp/oneworks channel-memory']
    })

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    expect(overrides).toContain('sandbox_workspace_write.network_access=true')
    expect(overrides).toContain('sandbox_workspace_write.writable_roots=["/tmp/oneworks channel-memory"]')

    session.kill()
  })

  it('bridges contextCompaction items into observational PreCompact hooks', async () => {
    process.env.HOME = '/tmp'
    const ctx = makeCtx()
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-precompact',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    proc.stdout.push(`${JSON.stringify({ method: 'turn/started', params: { turn: { id: 'turn_compact' } } })}\n`)
    proc.stdout.push(
      `${
        JSON.stringify({
          method: 'item/started',
          params: {
            item: {
              type: 'contextCompaction',
              id: 'compact_1',
              trigger: 'auto',
              tokenCount: 3210
            }
          }
        })
      }\n`
    )

    await waitForWrites()

    expect(callHookMock).toHaveBeenCalledWith(
      'PreCompact',
      expect.objectContaining({
        adapter: 'codex',
        canBlock: false,
        cwd: '/tmp',
        hookSource: 'bridge',
        runtime: 'server',
        sessionId: 'session-precompact',
        tokenCount: 3210,
        trigger: 'auto',
        turnId: 'turn_compact'
      }),
      {}
    )

    session.kill()
  })

  it('ignores blocking PreCompact output from observational Codex hooks', async () => {
    process.env.HOME = '/tmp'
    const ctx = makeCtx()
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)
    callHookMock.mockResolvedValue({
      continue: false,
      stopReason: 'blocked by plugin'
    } as any)

    const session = await createCodexSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-precompact-blocked',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    proc.stdout.push(
      `${
        JSON.stringify({
          method: 'item/started',
          params: {
            item: {
              type: 'contextCompaction',
              id: 'compact_blocked'
            }
          }
        })
      }\n`
    )

    await waitForWrites()

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      '[codex stream hooks] ignoring blocking output from observational PreCompact hook',
      'blocked by plugin'
    )

    session.kill()
  })

  it('handles command approval requests when payload.command is not an array', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    const ctx = makeCtx()
    const session = await createCodexSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-command-approval-string',
      description: 'Reply with pong.',
      onEvent: (event: AdapterOutputEvent) => events.push(event)
    } as any)

    proc.stdout.push(`${
      JSON.stringify({
        id: 7,
        method: 'item/commandExecution/requestApproval',
        params: {
          itemId: 'cmd-1',
          threadId: 'thr_1',
          turnId: 'turn_1',
          command: {
            executable: '/usr/bin/zsh',
            args: ['-lc', 'ls -la']
          },
          reason: 'Inspect the workspace',
          availableDecisions: ['accept', 'decline']
        }
      })
    }\n`)

    await waitForWrites()

    const requestEvent = events.find(event => event.type === 'interaction_request')
    expect(requestEvent).toBeDefined()
    expect((requestEvent as any)?.data?.payload?.question).toContain('/usr/bin/zsh -lc ls -la')
    expect(ctx.logger.error).not.toHaveBeenCalledWith(
      '[codex rpc] request handler error',
      expect.anything()
    )

    respondToInteraction(session, 'codex-approval:7', 'allow_once')
    await waitForWrites()

    expect(receivedLines).toContainEqual({
      id: 7,
      result: { decision: 'accept' }
    })

    session.kill()
  })

  it('auto-accepts oneworks channel send command approvals when managed permissions allow the narrow key', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    const session = await createCodexSession(
      makeCtx({
        configs: [{ permissions: { allow: ['bash-oneworks-channel-send'] } }]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-channel-send-approval',
        description: 'Reply with pong.',
        onEvent: (event: AdapterOutputEvent) => events.push(event)
      } as any
    )

    proc.stdout.push(`${
      JSON.stringify({
        id: 8,
        method: 'item/commandExecution/requestApproval',
        params: {
          itemId: 'cmd-channel-send',
          threadId: 'thr_1',
          turnId: 'turn_1',
          command: '/bin/zsh -lc \'oneworks channel send "ok"\'',
          availableDecisions: ['accept', 'decline']
        }
      })
    }\n`)

    await waitForWrites()

    expect(events.find(event => event.type === 'interaction_request')).toBeUndefined()
    expect(receivedLines).toContainEqual({
      id: 8,
      result: { decision: 'accept' }
    })

    session.kill()
  })

  it('auto-accepts oneworks mem command approvals when managed permissions allow the narrow key', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    const session = await createCodexSession(
      makeCtx({
        configs: [{ permissions: { allow: ['bash-oneworks-mem'] } }]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-oneworks-mem-approval',
        description: 'Reply with pong.',
        onEvent: (event: AdapterOutputEvent) => events.push(event)
      } as any
    )

    proc.stdout.push(`${
      JSON.stringify({
        id: 10,
        method: 'item/commandExecution/requestApproval',
        params: {
          itemId: 'cmd-oneworks-mem',
          threadId: 'thr_1',
          turnId: 'turn_1',
          command: '/bin/zsh -lc \'oneworks mem patch "ok"\'',
          availableDecisions: ['accept', 'decline']
        }
      })
    }\n`)

    await waitForWrites()

    expect(events.find(event => event.type === 'interaction_request')).toBeUndefined()
    expect(receivedLines).toContainEqual({
      id: 10,
      result: { decision: 'accept' }
    })

    session.kill()
  })

  it('handles MCP elicitation approval requests for tool calls', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-mcp-elicitation',
      description: 'Reply with pong.',
      onEvent: (event: AdapterOutputEvent) => events.push(event)
    } as any)

    proc.stdout.push(`${
      JSON.stringify({
        id: 9,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          serverName: 'Docs',
          mode: 'form',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_title: 'Search',
            tool_description: 'Search documentation'
          },
          message: 'Allow the Docs MCP server to run tool "Search"?',
          requestedSchema: {
            type: 'object',
            properties: {}
          }
        }
      })
    }\n`)

    await waitForWrites()

    const requestEvent = events.find(event => event.type === 'interaction_request')
    expect(requestEvent).toBeDefined()
    expect((requestEvent as any)?.data?.payload?.question).toContain('Allow the Docs MCP server')
    expect((requestEvent as any)?.data?.payload?.permissionContext).toMatchObject({
      subjectKey: 'mcp-docs-search',
      subjectLookupKeys: [
        'mcp-docs-search'
      ],
      subjectLabel: 'Docs:Search'
    })

    respondToInteraction(session, 'codex-approval:9', 'allow_once')
    await waitForWrites()

    expect(receivedLines).toContainEqual({
      id: 9,
      result: {
        action: 'accept',
        content: {}
      }
    })

    session.kill()
  })

  it('auto-accepts OneWorks MCP approval requests when managed permissions allow it', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    const session = await createCodexSession(
      makeCtx({
        configs: [{ permissions: { allow: ['OneWorks'] } }]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-mcp-managed-allow',
        description: 'Reply with pong.',
        onEvent: (event: AdapterOutputEvent) => events.push(event)
      } as any
    )

    proc.stdout.push(`${
      JSON.stringify({
        id: 10,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          serverName: 'OneWorks',
          mode: 'form',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_description: 'Start managed tasks'
          },
          message: 'Allow the OneWorks MCP server to run tool "StartTasks"?',
          requestedSchema: {
            type: 'object',
            properties: {}
          }
        }
      })
    }\n`)

    await waitForWrites()

    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
    expect(receivedLines).toContainEqual({
      id: 10,
      result: {
        action: 'accept',
        content: {}
      }
    })

    session.kill()
  })

  it('auto-declines OneWorks MCP approval requests when managed permissions deny it', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    const session = await createCodexSession(
      makeCtx({
        configs: [{ permissions: { allow: ['OneWorks'], deny: ['OneWorks'] } }]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-mcp-managed-deny',
        description: 'Reply with pong.',
        onEvent: (event: AdapterOutputEvent) => events.push(event)
      } as any
    )

    proc.stdout.push(`${
      JSON.stringify({
        id: 11,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          serverName: 'OneWorks',
          mode: 'form',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_description: 'Start managed tasks'
          },
          message: 'Allow the OneWorks MCP server to run tool "StartTasks"?',
          requestedSchema: {
            type: 'object',
            properties: {}
          }
        }
      })
    }\n`)

    await waitForWrites()

    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
    expect(receivedLines).toContainEqual({
      id: 11,
      result: {
        action: 'decline'
      }
    })

    session.kill()
  })

  it('maps denied MCP elicitation approvals to decline responses', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-mcp-elicitation-deny',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    proc.stdout.push(`${
      JSON.stringify({
        id: 10,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          serverName: 'Docs',
          mode: 'form',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_description: 'Search documentation'
          },
          message: 'Allow the Docs MCP server to run tool "Search"?',
          requestedSchema: {
            type: 'object',
            properties: {}
          }
        }
      })
    }\n`)

    await waitForWrites()

    respondToInteraction(session, 'codex-approval:10', 'deny_once')
    await waitForWrites()

    expect(receivedLines).toContainEqual({
      id: 10,
      result: {
        action: 'decline'
      }
    })

    session.kill()
  })

  it('cancels unsupported MCP elicitation schemas when permission mode is dontAsk', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-mcp-elicitation-never-schema',
      permissionMode: 'dontAsk',
      description: 'Reply with pong.',
      onEvent: (event: AdapterOutputEvent) => events.push(event)
    } as any)

    proc.stdout.push(`${
      JSON.stringify({
        id: 11,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          serverName: 'Docs',
          mode: 'form',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_title: 'Search',
            tool_description: 'Search documentation'
          },
          message: 'Allow the Docs MCP server to run tool "Search"?',
          requestedSchema: {
            type: 'object',
            properties: {
              reason: {
                type: 'string'
              }
            },
            required: ['reason']
          }
        }
      })
    }\n`)

    await waitForWrites()

    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
    expect(receivedLines).toContainEqual({
      id: 11,
      result: {
        action: 'cancel'
      }
    })

    session.kill()
  })

  it('uses --yolo and danger-full-access when permission mode is bypassPermissions', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-bypass',
      permissionMode: 'bypassPermissions',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    expect(spawnArgs[0]).toBe('--yolo')
    expect(spawnArgs[1]).toBe('app-server')

    const startRequest = receivedLines.find(line => line.method === 'thread/start')
    expect(startRequest?.params.approvalPolicy).toBe('never')
    expect(startRequest?.params.sandboxPolicy).toEqual({ type: 'dangerFullAccess' })

    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.approvalPolicy).toBe('never')
    expect(initialTurnRequest?.params.sandboxPolicy).toEqual({ type: 'dangerFullAccess' })

    session.kill()
  })

  it('maps public max effort to xhigh for stream turn/start requests', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-effort-stream',
      effort: 'max',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.effort).toBe('xhigh')

    session.kill()
  })

  it('applies model_reasoning_effort via direct-mode config overrides', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'session-effort-direct',
      effort: 'high',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    expect(overrides).toContain('model_reasoning_effort="high"')

    session.kill()
  })

  it('applies channel network access via direct-mode config overrides', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        env: {
          __ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__: '/tmp/channel-context.json',
          __ONEWORKS_PROJECT_CHANNEL_TYPE__: 'wechat'
        }
      }),
      {
        type: 'create',
        runtime: 'cli',
        mode: 'direct',
        sessionId: 'session-channel-network-direct',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    expect(overrides).toContain('sandbox_workspace_write.network_access=true')

    session.kill()
  })

  it('disables codex startup update checks by default', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-default-update-check',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    expect(overrides).toContain('check_for_update_on_startup=false')

    session.kill()
  })

  it('allows configOverrides to re-enable codex startup update checks', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        configs: [{
          adapters: {
            codex: {
              configOverrides: {
                check_for_update_on_startup: true
              }
            }
          }
        }, undefined]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-custom-update-check',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    expect(overrides).toContain('check_for_update_on_startup=true')
    expect(overrides).not.toContain('check_for_update_on_startup=false')

    session.kill()
  })

  it('enables native codex hooks and injects runtime metadata when available', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        env: {
          __ONEWORKS_PROJECT_CODEX_NATIVE_HOOKS_AVAILABLE__: '1',
          __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: '/tmp/oneworks-cli'
        }
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-native-hooks',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const spawnOptions = spawnMock.mock.calls[0]?.[2] as { env?: Record<string, string> }

    expect(spawnArgs).toEqual(expect.arrayContaining(['--enable', 'hooks']))
    expect(spawnOptions.env?.__ONEWORKS_CODEX_HOOKS_ACTIVE__).toBe('1')
    expect(spawnOptions.env?.[NATIVE_HOOK_BRIDGE_ADAPTER_ENV]).toBe('codex')
    expect(spawnOptions.env?.__ONEWORKS_CODEX_HOOK_RUNTIME__).toBe('server')
    expect(spawnOptions.env?.__ONEWORKS_CODEX_TASK_SESSION_ID__).toBe('session-native-hooks')

    session.kill()
  })

  it('does not leak CLI loader bootstrap env into Codex tool shells', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        env: {
          __IS_LOADER_CLI__: 'true',
          NODE_OPTIONS: '--conditions=__oneworks__'
        }
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-clean-cli-loader-env',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const spawnOptions = spawnMock.mock.calls[0]?.[2] as { env?: Record<string, string> }

    expect(spawnOptions.env?.__IS_LOADER_CLI__).toBeUndefined()
    expect(spawnOptions.env?.NODE_OPTIONS).toBeUndefined()

    session.kill()
  })

  it('injects required oneworks session env into command-based MCP servers', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        env: {
          __ONEWORKS_PROJECT_LAUNCH_CWD__: '/tmp/project/business_modules/Miniapp',
          __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '/tmp/project',
          __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: '/tmp/project/business_modules/Miniapp',
          __ONEWORKS_PROJECT_CONFIG_DIR__: '/tmp/project/business_modules/Miniapp',
          __ONEWORKS_PROJECT_CONFIG_DIR_RESOLVE_CWD__: '/tmp/project/business_modules/Miniapp',
          __ONEWORKS_PROJECT_BASE_DIR__: '.iac/ai',
          __ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__: '/tmp/project/business_modules/Miniapp',
          __ONEWORKS_PROJECT_ENTITIES_DIR__: 'entities',
          __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: '/tmp/project',
          __ONEWORKS_PROJECT_PACKAGE_DIR__: '/tmp/project/infra',
          __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: '/tmp/project/infra/node_modules/@oneworks/cli',
          __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/real-home',
          __ONEWORKS_PROJECT_DOTENV_FILES__: '.env,.env.dev',
          __ONEWORKS_PROJECT_SESSION_ID__: 'ow-session',
          __ONEWORKS_PROJECT_CTX_ID__: 'ow-ctx',
          __ONEWORKS_PROJECT_RUN_TYPE__: 'server',
          __ONEWORKS_PROJECT_PERMISSION_MODE__: 'dontAsk',
          __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
          __ONEWORKS_PROJECT_SERVER_PORT__: '8787',
          __ONEWORKS_PROJECT_LOG_PREFIX__: 'test-prefix',
          IGNORED_ENV: 'ignored-value'
        },
        configs: [{
          mcpServers: {
            OneWorks: {
              command: 'node',
              args: ['mcp.js'],
              env: {
                EXPLICIT_ENV: '1'
              }
            }
          }
        }, undefined]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-mcp-env',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    const mcpEnvOverride = getConfigOverride(overrides, 'mcp_servers.OneWorks.env=')

    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_SESSION_ID__ = "ow-session"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_CTX_ID__ = "ow-ctx"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_RUN_TYPE__ = "server"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_PERMISSION_MODE__ = "dontAsk"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_SERVER_HOST__ = "127.0.0.1"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_SERVER_PORT__ = "8787"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_LAUNCH_CWD__ = "/tmp/project/business_modules/Miniapp"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = "/tmp/project"')
    expect(mcpEnvOverride).toContain(
      '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__ = "/tmp/project/business_modules/Miniapp"'
    )
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_CONFIG_DIR__ = "/tmp/project/business_modules/Miniapp"')
    expect(mcpEnvOverride).toContain(
      '__ONEWORKS_PROJECT_CONFIG_DIR_RESOLVE_CWD__ = "/tmp/project/business_modules/Miniapp"'
    )
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_BASE_DIR__ = ".iac/ai"')
    expect(mcpEnvOverride).toContain(
      '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__ = "/tmp/project/business_modules/Miniapp"'
    )
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_ENTITIES_DIR__ = "entities"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = "/tmp/project"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_REAL_HOME__ = "/tmp/real-home"')
    expect(mcpEnvOverride).toContain('__ONEWORKS_PROJECT_DOTENV_FILES__ = ".env,.env.dev"')
    expect(mcpEnvOverride).toContain('EXPLICIT_ENV = "1"')
    expect(mcpEnvOverride).not.toContain('IGNORED_ENV')

    session.kill()
  })

  it('passes through extra options in stream mode', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-extra-options',
      description: 'Reply with pong.',
      extraOptions: ['--enable', 'apply_patch_freeform'],
      onEvent: () => {}
    } as any)

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    expect(spawnArgs).toEqual(expect.arrayContaining(['--enable', 'apply_patch_freeform']))

    session.kill()
  })

  it('uses codex defaults when model is "default"', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        configs: [{
          modelServices: {
            'gpt-responses': {
              title: 'GPT Responses',
              apiBaseUrl: 'http://example.test/responses',
              apiKey: 'test-key',
              extra: {
                codex: {
                  wireApi: 'responses'
                }
              }
            }
          }
        }, undefined]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-model-default',
        model: 'default',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    expect(spawnArgs.some(arg => arg.includes('model_provider='))).toBe(false)
    expect(spawnArgs.some(arg => arg.includes('model_providers.'))).toBe(false)

    const startRequest = receivedLines.find(line => line.method === 'thread/start')
    expect(startRequest?.params.model).toBeUndefined()

    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.model).toBeUndefined()

    session.kill()
  })

  it('routes codex model providers through the local proxy with upstream metadata', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        configs: [{
          modelServices: {
            azure: {
              title: 'Azure',
              apiBaseUrl: 'https://example.openai.azure.com/openai',
              apiKey: 'test-key',
              timeoutMs: 600000,
              extra: {
                codex: {
                  wireApi: 'responses',
                  headers: {
                    'X-Tenant': 'tenant-1'
                  },
                  queryParams: {
                    'api-version': '2025-04-01-preview'
                  }
                }
              }
            }
          }
        }, undefined]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-provider-options',
        permissionMode: 'plan',
        effort: 'high',
        model: 'azure,gpt-5.4',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    const proxyMeta = decodeProxyMeta(overrides, 'azure')

    expect(overrides).toContain('model_provider="azure"')
    expect(overrides).toContain('model_providers.azure.name="Azure"')
    expect(overrides).toContain('model_providers.azure.experimental_bearer_token="test-key"')
    expect(overrides).toContain('model_providers.azure.wire_api="responses"')
    expect(overrides).toContain('model_providers.azure.stream_idle_timeout_ms=600000')
    expect(getConfigOverride(overrides, 'model_providers.azure.base_url=')).toMatch(
      /^model_providers\.azure\.base_url="http:\/\/127\.0\.0\.1:\d+"$/
    )
    expect(overrides.some(override => override.startsWith('model_providers.azure.query_params='))).toBe(false)
    expect(proxyMeta).toMatchObject({
      upstreamBaseUrl: 'https://example.openai.azure.com/openai',
      headers: {
        'X-Tenant': 'tenant-1'
      },
      queryParams: {
        'api-version': '2025-04-01-preview'
      },
      diagnostics: {
        routedServiceKey: 'azure',
        requestedModel: 'azure,gpt-5.4',
        resolvedModel: 'gpt-5.4',
        runtime: 'server',
        sessionType: 'create',
        permissionMode: 'plan',
        approvalPolicy: 'onRequest',
        sandboxPolicy: 'workspaceWrite',
        useYolo: false,
        requestedEffort: 'high',
        effectiveEffort: 'high',
        wireApi: 'responses'
      }
    })

    session.kill()
  })

  it('keeps proxy-routed thread cache stable across create and resume diagnostics', async () => {
    process.env.HOME = '/tmp'
    const ctx = makeCtx({
      configs: [{
        modelServices: {
          azure: {
            title: 'Azure',
            apiBaseUrl: 'https://example.openai.azure.com/openai',
            apiKey: 'test-key',
            extra: {
              codex: {
                wireApi: 'responses'
              }
            }
          }
        }
      }, undefined]
    })
    const firstProc = makeProc({ threadStartIds: ['thr_proxy_original'] })
    const secondProc = makeProc({ resumedThreadId: 'thr_proxy_original' })
    spawnMock
      .mockReturnValueOnce(firstProc.proc)
      .mockReturnValueOnce(secondProc.proc)

    const firstSession = await createCodexSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-proxy-resume',
      model: 'azure,gpt-5.4',
      description: 'first turn',
      onEvent: () => {}
    } as any)
    firstSession.kill()

    const secondSession = await createCodexSession(ctx, {
      type: 'resume',
      runtime: 'server',
      sessionId: 'session-proxy-resume',
      model: 'azure,gpt-5.4',
      description: 'second turn',
      onEvent: () => {}
    } as any)
    await waitForWrites()
    secondSession.kill()

    const resumeRequest = secondProc.receivedLines.find(line => line.method === 'thread/resume')
    expect(resumeRequest?.params.threadId).toBe('thr_proxy_original')
    expect(secondProc.receivedLines.some(line => line.method === 'thread/start')).toBe(false)

    const cachedThreads = await ctx.cache.get('adapter.codex.threads')
    expect(Object.values(cachedThreads ?? {})).toEqual(['thr_proxy_original'])
  })

  it('resumes the sole cached thread when non-semantic cache key drift misses the exact key', async () => {
    process.env.HOME = '/tmp'
    const ctx = makeCtx()
    await ctx.cache.set('adapter.codex.threads', {
      'context:previous': 'thr_existing'
    })
    const { proc, receivedLines } = makeProc({ resumedThreadId: 'thr_existing' })
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(ctx, {
      type: 'resume',
      runtime: 'server',
      sessionId: 'session-fallback-resume',
      description: 'continue',
      onEvent: () => {}
    } as any)
    await waitForWrites()
    session.kill()

    const resumeRequest = receivedLines.find(line => line.method === 'thread/resume')
    expect(resumeRequest?.params.threadId).toBe('thr_existing')
    expect(receivedLines.some(line => line.method === 'thread/start')).toBe(false)
  })

  it('passes maxOutputTokens from adapter config to turn/start', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        configs: [{
          adapters: {
            codex: {
              maxOutputTokens: 4096
            }
          }
        }, undefined]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-max-output-tokens',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.maxOutputTokens).toBe(4096)

    session.kill()
  })

  it('routes model service maxOutputTokens through the proxy and suppresses adapter fallback', async () => {
    process.env.HOME = '/tmp'
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        configs: [{
          adapters: {
            codex: {
              maxOutputTokens: 4096
            }
          },
          modelServices: {
            azure: {
              title: 'Azure',
              apiBaseUrl: 'https://example.openai.azure.com/openai',
              apiKey: 'test-key',
              maxOutputTokens: 8192
            }
          }
        }, undefined]
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-service-max-output-tokens',
        model: 'azure,gpt-5.4',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    const proxyMeta = decodeProxyMeta(overrides, 'azure')
    const initialTurnRequest = receivedLines.find(line => line.method === 'turn/start')
    expect(initialTurnRequest?.params.maxOutputTokens).toBeUndefined()
    expect(proxyMeta).toMatchObject({
      upstreamBaseUrl: 'https://example.openai.azure.com/openai',
      maxOutputTokens: 8192
    })

    session.kill()
  })

  it('passes model service maxOutputTokens to direct mode through proxy metadata', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        configs: [{
          modelServices: {
            azure: {
              title: 'Azure',
              apiBaseUrl: 'https://example.openai.azure.com/openai',
              apiKey: 'test-key',
              maxOutputTokens: 8192
            }
          }
        }, undefined]
      }),
      {
        type: 'create',
        mode: 'direct',
        runtime: 'server',
        sessionId: 'session-direct-service-max-output-tokens',
        model: 'azure,gpt-5.4',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)
    const proxyMeta = decodeProxyMeta(overrides, 'azure')

    expect(overrides).toContain('model_provider="azure"')
    expect(getConfigOverride(overrides, 'model_providers.azure.base_url=')).toMatch(
      /^model_providers\.azure\.base_url="http:\/\/127\.0\.0\.1:\d+"$/
    )
    expect(overrides.some(override => override.startsWith('model_providers.azure.max_output_tokens='))).toBe(false)
    expect(proxyMeta).toMatchObject({
      upstreamBaseUrl: 'https://example.openai.azure.com/openai',
      maxOutputTokens: 8192
    })
    expect(spawnArgs).toContain('--model')
    expect(spawnArgs).toContain('gpt-5.4')

    session.kill()
  })

  it('recreates the thread when resume hits invalid_encrypted_content', async () => {
    process.env.HOME = '/tmp'
    const ctx = makeCtx()

    const firstProc = makeProc({ threadStartIds: ['thr_original'] })
    const secondProc = makeProc({
      resumeError: {
        code: -4003,
        message: 'code: invalid_encrypted_content; message: organization_id did not match the target organization'
      },
      threadStartIds: ['thr_recovered']
    })
    spawnMock
      .mockReturnValueOnce(firstProc.proc)
      .mockReturnValueOnce(secondProc.proc)

    const firstSession = await createCodexSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-resume-recover',
      onEvent: () => {}
    } as any)
    firstSession.kill()

    const secondSession = await createCodexSession(ctx, {
      type: 'resume',
      runtime: 'server',
      sessionId: 'session-resume-recover',
      description: 'retry on a fresh thread',
      onEvent: () => {}
    } as any)

    await waitForWrites()
    secondSession.kill()

    expect(secondProc.receivedLines.some(line => line.method === 'thread/resume')).toBe(true)
    expect(secondProc.receivedLines.some(line => line.method === 'thread/start')).toBe(true)

    const cachedThreads = await ctx.cache.get('adapter.codex.threads')
    expect(Object.values(cachedThreads ?? {})).toContain('thr_recovered')
    expect(Object.values(cachedThreads ?? {})).not.toContain('thr_original')
  })

  it('emits exit when a post-start turn fails', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc({
      turnStartErrors: {
        2: { code: -4003, message: 'code: invalid_encrypted_content; message: broken thread state' }
      }
    })
    spawnMock.mockReturnValue(proc)

    const events: AdapterOutputEvent[] = []
    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-turn-failure',
      description: 'first turn works',
      onEvent: (event: AdapterOutputEvent) => events.push(event)
    } as any)

    session.emit({
      type: 'message',
      content: [{ type: 'text', text: 'second turn fails' }]
    } as any)

    await waitForWrites()

    expect(events.some((event: AdapterOutputEvent) => (
      event.type === 'error' &&
      event.data.message.includes('invalid_encrypted_content')
    ))).toBe(true)
    expect(events.some((event: AdapterOutputEvent) => (
      event.type === 'exit' &&
      event.data.exitCode === 1 &&
      event.data.stderr?.includes('invalid_encrypted_content')
    ))).toBe(true)
  })

  it('places --yolo before resume in direct mode for bypassPermissions', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(makeCtx(), {
      type: 'resume',
      mode: 'direct',
      runtime: 'server',
      sessionId: 'session-direct-bypass',
      permissionMode: 'bypassPermissions',
      description: 'resume prompt',
      onEvent: () => {}
    } as any)

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    expect(spawnArgs[0]).toBe('--yolo')
    expect(spawnArgs[1]).toBe('resume')
    expect(spawnArgs).toContain('--last')
    expect(spawnArgs).not.toContain('--ask-for-approval')
    expect(spawnArgs).not.toContain('--sandbox')

    session.kill()
  })

  it('maps managed OneWorks permissions to Codex MCP approval config in direct mode', async () => {
    process.env.HOME = '/tmp'
    const { proc } = makeProc()
    spawnMock.mockReturnValue(proc)

    const session = await createCodexSession(
      makeCtx({
        configs: [{
          permissions: {
            allow: ['OneWorks']
          },
          mcpServers: {
            OneWorks: {
              command: 'node',
              args: ['mcp.js']
            }
          }
        }, undefined]
      }),
      {
        type: 'create',
        mode: 'direct',
        runtime: 'server',
        sessionId: 'session-direct-mcp-approval',
        description: 'direct prompt',
        onEvent: () => {}
      } as any
    )

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    const overrides = getConfigOverrides(spawnArgs)

    expect(overrides).toContain('mcp_servers.OneWorks.default_tools_approval_mode="approve"')
    expect(spawnArgs).toEqual(expect.arrayContaining(['--ask-for-approval', 'untrusted']))

    session.kill()
  })
})
