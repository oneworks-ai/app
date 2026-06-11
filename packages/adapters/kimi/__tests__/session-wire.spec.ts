/* eslint-disable max-lines */

import '../src/adapter-config'

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import type { AdapterCtx, AdapterOutputEvent } from '@oneworks/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createKimiSession } from '../src/runtime/session'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn()
  }
})

const spawnMock = vi.mocked(spawn)
const tempDirs: string[] = []

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ow-kimi-wire-'))
  tempDirs.push(dir)
  return dir
}

const createCtx = async (overrides: Partial<AdapterCtx> = {}): Promise<AdapterCtx> => {
  const cwd = overrides.cwd ?? await createTempDir()
  const fakeBinDir = join(cwd, 'bin')
  const fakeBinary = join(fakeBinDir, 'kimi')
  await mkdir(fakeBinDir, { recursive: true })
  await writeFile(fakeBinary, '#!/bin/sh\n')

  return {
    ctxId: 'ctx-kimi-wire',
    cwd,
    env: {
      __ONEWORKS_PROJECT_ADAPTER_KIMI_CLI_PATH__: fakeBinary
    },
    cache: {
      set: async () => ({ cachePath: join(cwd, '.oo/cache/base.json') }),
      get: async () => undefined
    },
    logger: {
      stream: new PassThrough(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    },
    configs: [{
      adapters: {
        kimi: {
          agent: 'okabe'
        }
      }
    }, undefined],
    ...overrides
  }
}

const makeProc = () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const receivedLines: Array<Record<string, any>> = []
  let exitHandler: ((code: number | null) => void) | undefined
  let errorHandler: ((error: Error) => void) | undefined

  const respond = (message: Record<string, any>) => {
    stdout.push(`${JSON.stringify(message)}\n`)
  }

  stdin.on('data', chunk => {
    for (const line of String(chunk).split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const message = JSON.parse(trimmed) as Record<string, any>
      receivedLines.push(message)

      if (message.method === 'initialize') {
        respond({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocol_version: '1.9',
            server: { name: 'Kimi Code CLI', version: '1.36.0' },
            slash_commands: [{ name: 'init', description: 'Init', aliases: [] }],
            capabilities: { supports_question: true }
          }
        })
      }
    }
  })

  const proc = {
    stdin,
    stdout,
    stderr,
    pid: 4321,
    on: (event: string, handler: any) => {
      if (event === 'exit') exitHandler = handler
      if (event === 'error') errorHandler = handler
      return proc
    },
    kill: vi.fn(() => {
      exitHandler?.(0)
      return true
    }),
    emitError: (error: Error) => errorHandler?.(error),
    emitExit: (code: number | null) => exitHandler?.(code)
  } as any

  return { proc, receivedLines, respond }
}

const waitForWrites = async () => {
  await new Promise(resolve => setTimeout(resolve, 25))
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('kimi wire session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts Kimi in wire mode and maps wire events into adapter messages', async () => {
    const { proc, receivedLines, respond } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx()
    const events: AdapterOutputEvent[] = []

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-wire',
      description: 'Say hi',
      onEvent: event => events.push(event)
    })

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
    expect(spawnArgs).toContain('--wire')
    expect(spawnArgs).not.toContain('--print')
    expect(spawnArgs).not.toContain('--output-format')

    const initRequest = receivedLines.find(line => line.method === 'initialize')
    expect(initRequest?.params).toMatchObject({
      protocol_version: '1.9',
      capabilities: {
        supports_question: true,
        supports_plan_mode: true
      }
    })

    await waitForWrites()
    const promptRequest = receivedLines.find(line => line.method === 'prompt')
    expect(promptRequest?.params.user_input).toBe('Say hi')

    respond({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ContentPart',
        payload: { type: 'text', text: 'hello' }
      }
    })
    respond({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ToolCall',
        payload: {
          type: 'function',
          id: 'tc_1',
          function: {
            name: 'Shell',
            arguments: '{"command":"pwd"}'
          }
        }
      }
    })
    respond({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ToolResult',
        payload: {
          tool_call_id: 'tc_1',
          return_value: {
            is_error: false,
            output: '/tmp/project',
            message: 'done',
            display: []
          }
        }
      }
    })
    respond({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'TurnEnd',
        payload: {}
      }
    })
    respond({
      jsonrpc: '2.0',
      id: promptRequest?.id,
      result: { status: 'finished' }
    })

    await waitForWrites()

    expect(events.find(event => event.type === 'init')?.data).toMatchObject({
      uuid: 'session-wire',
      version: '1.36.0',
      slashCommands: ['init'],
      agents: ['okabe']
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({
          content: 'hello'
        })
      }),
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({
          content: [{
            type: 'tool_use',
            id: 'tc_1',
            name: 'Shell',
            input: { command: 'pwd' }
          }]
        })
      }),
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({
          content: [{
            type: 'tool_result',
            tool_use_id: 'tc_1',
            content: '/tmp/project'
          }]
        })
      }),
      expect.objectContaining({ type: 'stop' })
    ]))

    session.kill()
  })

  it('uses steer while a prompt is active', async () => {
    const { proc, receivedLines } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx()

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-steer',
      description: 'Start',
      onEvent: () => {}
    })

    await waitForWrites()
    session.emit({
      type: 'message',
      content: [{ type: 'text', text: 'Use TypeScript' }]
    })

    await waitForWrites()
    const steerRequest = receivedLines.find(line => line.method === 'steer')
    expect(steerRequest?.params.user_input).toBe('Use TypeScript')

    session.kill()
  })

  it('emits approval requests and responds with Kimi approval payloads', async () => {
    const { proc, receivedLines, respond } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx()
    const events: AdapterOutputEvent[] = []

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-approval',
      onEvent: event => events.push(event)
    })

    respond({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ToolCall',
        payload: {
          type: 'function',
          id: 'tc_1',
          function: {
            name: 'Shell',
            arguments: ''
          }
        }
      }
    })
    respond({
      jsonrpc: '2.0',
      method: 'request',
      id: 'approval-1',
      params: {
        type: 'ApprovalRequest',
        payload: {
          id: 'approval-1',
          tool_call_id: 'tc_1',
          sender: 'Shell',
          action: 'run shell command',
          description: 'Run command `ls`',
          display: [{
            type: 'shell',
            language: 'bash',
            command: 'ls'
          }]
        }
      }
    })

    await waitForWrites()
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({
          content: [{
            type: 'tool_use',
            id: 'tc_1',
            name: 'Shell',
            input: { command: 'ls', language: 'bash' }
          }]
        })
      })
    ]))
    const requestEvent = events.find(event => event.type === 'interaction_request')
    expect(requestEvent?.data.id).toBe('kimi-approval:approval-1')
    expect((requestEvent as any)?.data.payload.permissionContext).toMatchObject({
      adapter: 'kimi',
      subjectKey: 'Bash',
      subjectLookupKeys: ['Shell']
    })

    session.respondInteraction?.('kimi-approval:approval-1', 'allow_session')
    await waitForWrites()

    expect(receivedLines).toContainEqual({
      jsonrpc: '2.0',
      id: 'approval-1',
      result: {
        request_id: 'approval-1',
        response: 'approve_for_session'
      }
    })

    session.kill()
  })

  it('hydrates file approval display into tool input without dropping wire arguments', async () => {
    const { proc, respond } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx()
    const events: AdapterOutputEvent[] = []

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-file-display',
      onEvent: event => events.push(event)
    })

    respond({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ToolCall',
        payload: {
          type: 'function',
          id: 'tc_edit',
          function: {
            name: 'StrReplaceFile',
            arguments: JSON.stringify({
              path: 'src/app.ts',
              edit: {
                old: 'const value = 1',
                new: 'const value = 2'
              }
            })
          }
        }
      }
    })
    respond({
      jsonrpc: '2.0',
      method: 'request',
      id: 'approval-edit',
      params: {
        type: 'ApprovalRequest',
        payload: {
          id: 'approval-edit',
          tool_call_id: 'tc_edit',
          sender: 'StrReplaceFile',
          action: 'edit file',
          description: 'Edit file `src/app.ts`',
          display: [{
            type: 'diff',
            path: 'src/app.ts',
            old_text: 'const value = 1',
            new_text: 'const value = 2',
            old_start: 3,
            new_start: 3
          }]
        }
      }
    })

    await waitForWrites()
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({
          content: [{
            type: 'tool_use',
            id: 'tc_edit',
            name: 'StrReplaceFile',
            input: {
              path: 'src/app.ts',
              edit: {
                old: 'const value = 1',
                new: 'const value = 2'
              },
              old_text: 'const value = 1',
              new_text: 'const value = 2',
              old_start: 3,
              new_start: 3,
              diffs: [{
                path: 'src/app.ts',
                old_text: 'const value = 1',
                new_text: 'const value = 2',
                old_start: 3,
                new_start: 3
              }]
            }
          }]
        })
      })
    ]))

    session.kill()
  })

  it('hydrates todo approval display into tool input', async () => {
    const { proc, respond } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx()
    const events: AdapterOutputEvent[] = []

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-todo-display',
      onEvent: event => events.push(event)
    })

    respond({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ToolCall',
        payload: {
          type: 'function',
          id: 'tc_todo',
          function: {
            name: 'SetTodoList',
            arguments: ''
          }
        }
      }
    })
    respond({
      jsonrpc: '2.0',
      method: 'request',
      id: 'approval-todo',
      params: {
        type: 'ApprovalRequest',
        payload: {
          id: 'approval-todo',
          tool_call_id: 'tc_todo',
          sender: 'SetTodoList',
          action: 'update todo list',
          description: 'Update todo list',
          display: [{
            type: 'todo',
            items: [
              { title: 'Read wire docs', status: 'done' },
              { title: 'Patch adapter', status: 'in_progress' }
            ]
          }]
        }
      }
    })

    await waitForWrites()
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({
          content: [{
            type: 'tool_use',
            id: 'tc_todo',
            name: 'SetTodoList',
            input: {
              items: [
                { title: 'Read wire docs', status: 'done' },
                { title: 'Patch adapter', status: 'in_progress' }
              ]
            }
          }]
        })
      })
    ]))

    session.kill()
  })

  it('auto-approves approval requests in dontAsk mode', async () => {
    const { proc, receivedLines, respond } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx()
    const events: AdapterOutputEvent[] = []

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-dont-ask',
      permissionMode: 'dontAsk',
      onEvent: event => events.push(event)
    })

    respond({
      jsonrpc: '2.0',
      method: 'request',
      id: 'approval-auto',
      params: {
        type: 'ApprovalRequest',
        payload: {
          id: 'approval-auto',
          sender: 'Shell',
          action: 'run shell command',
          description: 'Run command `pwd`'
        }
      }
    })

    await waitForWrites()
    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
    expect(receivedLines).toContainEqual({
      jsonrpc: '2.0',
      id: 'approval-auto',
      result: {
        request_id: 'approval-auto',
        response: 'approve'
      }
    })

    session.kill()
  })

  it('auto-approves approval requests when managed permissions allow the subject', async () => {
    const { proc, receivedLines, respond } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx({
      configs: [{
        adapters: {
          kimi: {
            agent: 'okabe'
          }
        },
        permissions: {
          allow: ['Bash']
        }
      }, undefined]
    })
    const events: AdapterOutputEvent[] = []

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-config-allow',
      onEvent: event => events.push(event)
    })

    respond({
      jsonrpc: '2.0',
      method: 'request',
      id: 'approval-config-allow',
      params: {
        type: 'ApprovalRequest',
        payload: {
          id: 'approval-config-allow',
          sender: 'Shell',
          action: 'run shell command',
          description: 'Run command `pwd`'
        }
      }
    })

    await waitForWrites()
    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
    expect(receivedLines).toContainEqual({
      jsonrpc: '2.0',
      id: 'approval-config-allow',
      result: {
        request_id: 'approval-config-allow',
        response: 'approve_for_session'
      }
    })

    session.kill()
  })

  it('remembers session permission denials for later approval requests', async () => {
    const { proc, receivedLines, respond } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx()
    const events: AdapterOutputEvent[] = []

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-deny-memory',
      onEvent: event => events.push(event)
    })

    respond({
      jsonrpc: '2.0',
      method: 'request',
      id: 'approval-deny-1',
      params: {
        type: 'ApprovalRequest',
        payload: {
          id: 'approval-deny-1',
          sender: 'Shell',
          action: 'run shell command',
          description: 'Run command `pwd`'
        }
      }
    })

    await waitForWrites()
    session.respondInteraction?.('kimi-approval:approval-deny-1', 'deny_session')
    await waitForWrites()

    respond({
      jsonrpc: '2.0',
      method: 'request',
      id: 'approval-deny-2',
      params: {
        type: 'ApprovalRequest',
        payload: {
          id: 'approval-deny-2',
          sender: 'Shell',
          action: 'run shell command',
          description: 'Run command `ls`'
        }
      }
    })

    await waitForWrites()
    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(1)
    expect(receivedLines).toContainEqual({
      jsonrpc: '2.0',
      id: 'approval-deny-2',
      result: {
        request_id: 'approval-deny-2',
        response: 'reject'
      }
    })

    session.kill()
  })

  it('responds with JSON-RPC errors for unsupported wire request types', async () => {
    const { proc, receivedLines, respond } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx()

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-unsupported-request',
      onEvent: () => {}
    })

    respond({
      jsonrpc: '2.0',
      method: 'request',
      id: 'unsupported-1',
      params: {
        type: 'FutureRequest',
        payload: {
          id: 'future-1'
        }
      }
    })

    await waitForWrites()
    expect(receivedLines).toContainEqual({
      jsonrpc: '2.0',
      id: 'unsupported-1',
      error: {
        code: -32602,
        message: 'Unsupported Kimi wire request type: FutureRequest'
      }
    })

    session.kill()
  })

  it('maps Kimi question requests to interaction requests', async () => {
    const { proc, receivedLines, respond } = makeProc()
    spawnMock.mockReturnValue(proc)
    const ctx = await createCtx()
    const events: AdapterOutputEvent[] = []

    const session = await createKimiSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-question',
      onEvent: event => events.push(event)
    })

    respond({
      jsonrpc: '2.0',
      method: 'request',
      id: 'question-1',
      params: {
        type: 'QuestionRequest',
        payload: {
          id: 'question-1',
          tool_call_id: 'tc_q',
          questions: [{
            question: 'Which language?',
            header: 'Lang',
            options: [
              { label: 'TypeScript', description: 'Project default' },
              { label: 'Rust', description: 'Native speed' }
            ]
          }]
        }
      }
    })

    await waitForWrites()
    const requestEvent = events.find(event => event.type === 'interaction_request')
    expect(requestEvent?.data).toMatchObject({
      id: 'kimi-question:question-1',
      payload: {
        kind: 'question',
        question: 'Which language?',
        options: [
          { label: 'TypeScript', value: 'TypeScript', description: 'Project default' },
          { label: 'Rust', value: 'Rust', description: 'Native speed' }
        ]
      }
    })

    session.respondInteraction?.('kimi-question:question-1', 'TypeScript')
    await waitForWrites()

    expect(receivedLines).toContainEqual({
      jsonrpc: '2.0',
      id: 'question-1',
      result: {
        request_id: 'question-1',
        answers: {
          'Which language?': 'TypeScript'
        }
      }
    })

    session.kill()
  })
})
