import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import type { AdapterOutputEvent } from '@oneworks/types'

import { createStreamGrokSession } from '../src/runtime/session/stream'

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn()
}))

vi.mock('../src/runtime/config', () => ({
  buildGrokHeadlessArgs: vi.fn((params: { resume: boolean }) => (
    params.resume ? ['--resume', 'session-id'] : ['--session-id', 'session-id']
  )),
  prepareGrokSession: vi.fn(async () => ({
    binaryPath: '/bin/grok',
    grokHome: '/tmp/grok-home',
    spawnEnv: {}
  })),
  resolveGrokAdapterConfig: vi.fn(() => ({})),
  writeGrokPromptFile: vi.fn(async () => '/tmp/grok-prompt')
}))

const spawnMock = vi.mocked(spawn)

const makeProc = (params: { exitCode: number; stderr?: string; stdout?: string }) => {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number
    stderr: PassThrough
    stdout: PassThrough
  }
  proc.pid = 4321
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  queueMicrotask(() => {
    if (params.stdout != null) proc.stdout.end(params.stdout)
    else proc.stdout.end()
    if (params.stderr != null) proc.stderr.end(params.stderr)
    else proc.stderr.end()
    proc.emit('close', params.exitCode)
  })
  return proc as never
}

describe('grok streaming session lifecycle', () => {
  it('retries a structurally missing resume without leaking its fatal result or stop', async () => {
    spawnMock
      .mockImplementationOnce(() =>
        makeProc({
          exitCode: 1,
          stdout: `${
            JSON.stringify({
              type: 'result',
              subtype: 'error_during_execution',
              is_error: true,
              errors: ['No conversation found with session ID: session-id']
            })
          }\n`
        })
      )
      .mockImplementationOnce(() =>
        makeProc({
          exitCode: 0,
          stdout: `${
            [
              JSON.stringify({
                type: 'system',
                subtype: 'init',
                session_id: 'session-id',
                model: 'grok-code-fast-1',
                cwd: '/workspace'
              }),
              JSON.stringify({
                type: 'result',
                subtype: 'success',
                is_error: false,
                result: 'Recovered'
              })
            ].join('\n')
          }\n`
        })
      )

    const events: AdapterOutputEvent[] = []
    let resolveExit!: () => void
    const exitSeen = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    await createStreamGrokSession({
      ctxId: 'ctx-1',
      cwd: '/workspace',
      env: {},
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      configs: [],
      logger: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined
      }
    } as any, {
      type: 'resume',
      runtime: 'server',
      sessionId: 'session-id',
      description: 'Continue.',
      onEvent: (event: AdapterOutputEvent) => {
        events.push(event)
        if (event.type === 'exit') resolveExit()
      }
    } as any)

    await exitSeen

    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[0]?.[1]).toContain('--resume')
    expect(spawnMock.mock.calls[1]?.[1]).toContain('--session-id')
    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ code: 'grok_resume_missing', fatal: false })
      })
    ])
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(events.at(-1)).toEqual({ type: 'exit', data: { exitCode: 0 } })
  })
})
