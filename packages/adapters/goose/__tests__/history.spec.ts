import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { chmod } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  exportGooseHistory,
  inspectGooseHistoryExport,
  listGooseHistory,
  listGooseHistoryWithDiagnostics
} from '../src/history'

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-goose-history.mjs')
const timeoutFixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-goose-history-timeout.mjs'
)

const commandFailure = (message: string, stderr?: string) => {
  const error = new Error(message) as Error & { stderr?: string }
  error.stderr = stderr
  return error
}

const EXPORT_ABSOLUTE_LIMIT_BYTES = 128 * 1024 * 1024
const STREAM_CHUNK_BYTES = 1024 * 1024

const createStreamingSpawnHarness = (chunkCount: number) => {
  const kill = vi.fn(() => true)
  const spawn = vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      kill: typeof kill
      stderr: EventEmitter
      stdout: EventEmitter
    }
    child.kill = kill
    child.stderr = new EventEmitter()
    child.stdout = new EventEmitter()
    const chunk = Buffer.alloc(STREAM_CHUNK_BYTES)
    queueMicrotask(() => {
      for (let index = 0; index < chunkCount; index += 1) child.stdout.emit('data', chunk)
      child.emit('close', 0)
    })
    return child
  })
  return { kill, spawn }
}

describe('goose public CLI history boundary', () => {
  it('uses only list/export JSON commands, deduplicates ids, excludes recipes/subagents, and maps tools', async () => {
    await chmod(fixturePath, 0o755)
    const sessions = await listGooseHistory({ binaryPath: fixturePath })
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({
      cwd: '/workspace/goose-project',
      model: 'anthropic/claude-sonnet-4-6',
      nativeSessionId: '20260813_120000',
      sourcePath: 'goose-cli://session/20260813_120000'
    })

    const conversation = await exportGooseHistory(sessions[0]!, { binaryPath: fixturePath })
    expect(conversation.messages).toHaveLength(4)
    expect(conversation.messages[1]?.content).toEqual([{
      type: 'tool_use',
      id: 'tool-read-1',
      name: 'developer__read',
      input: { path: 'package.json' }
    }])
    expect(conversation.messages[2]?.content).toEqual([{
      type: 'tool_result',
      tool_use_id: 'tool-read-1',
      content: '{"name":"fixture"}'
    }])
  })

  it('reports unsupported recipes and subagent histories without hiding normal sessions', async () => {
    await chmod(fixturePath, 0o755)
    const result = await listGooseHistoryWithDiagnostics({ binaryPath: fixturePath })

    expect(result.sessions).toHaveLength(2)
    expect(result.unsupported).toEqual({ recipe: 1, subagent: 1 })
  })

  it('measures raw public export bytes before parsing and marks only that candidate oversized', async () => {
    await chmod(fixturePath, 0o755)
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    const measured = await inspectGooseHistoryExport(session, { binaryPath: fixturePath })
    const oversized = await inspectGooseHistoryExport(session, {
      binaryPath: fixturePath,
      maxSerializedBytes: measured.serializedBytes - 1
    })

    expect(measured.serializedBytes).toBeGreaterThan(0)
    expect(measured).toMatchObject({ oversized: false, conversation: expect.any(Object) })
    expect(oversized).toEqual({
      oversized: true,
      serializedBytes: measured.serializedBytes,
      serializedBytesExact: true
    })
  })

  it('accepts a no-newline 32-50 MiB export within the active serialized-size policy', async () => {
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    const output = JSON.stringify({
      id: session.nativeSessionId,
      working_dir: session.cwd,
      conversation: [{
        id: 'large-message',
        role: 'user',
        created: 1_786_612_800,
        content: [{ type: 'text', text: 'x'.repeat(34 * 1024 * 1024) }]
      }]
    })
    const outputBytes = Buffer.byteLength(output)
    const exec = vi.fn(async (
      _binary: string,
      _args: string[],
      _options: { maxBuffer: number }
    ) => ({ stdout: output, stderr: '' }))

    const inspected = await inspectGooseHistoryExport(session, {
      exec: exec as never,
      maxSerializedBytes: 50 * 1024 * 1024
    })

    expect(output.endsWith('\n')).toBe(false)
    expect(outputBytes).toBeGreaterThan(32 * 1024 * 1024)
    expect(outputBytes).toBeLessThan(50 * 1024 * 1024)
    expect(inspected).toMatchObject({
      oversized: false,
      serializedBytes: outputBytes,
      serializedBytesExact: true
    })
    expect(exec.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      maxBuffer: 51 * 1024 * 1024
    }))
  })

  it('counts multibyte framing at the exact policy boundary and classifies the next lower limit', async () => {
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    const output = JSON.stringify({
      id: session.nativeSessionId,
      working_dir: session.cwd,
      conversation: [{
        id: 'unicode-message',
        role: 'user',
        created: 1_786_612_800,
        content: [{ type: 'text', text: '鹅🪿'.repeat(1_024) }]
      }]
    })
    const serializedBytes = Buffer.byteLength(output)
    const exec = (async () => ({ stdout: output, stderr: '' })) as never

    await expect(inspectGooseHistoryExport(session, {
      exec,
      maxSerializedBytes: serializedBytes
    })).resolves.toMatchObject({ oversized: false, serializedBytes, serializedBytesExact: true })
    await expect(inspectGooseHistoryExport(session, {
      exec,
      maxSerializedBytes: serializedBytes - 1
    })).resolves.toEqual({ oversized: true, serializedBytes, serializedBytesExact: true })
  })

  it('turns a bounded export overflow into an inexact oversize inspection instead of a command failure', async () => {
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    const overflow = commandFailure('stdout maxBuffer exceeded') as Error & { code: string }
    overflow.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    const exec = vi.fn(async (_binary: string, _args: string[], options: { maxBuffer: number }) => {
      expect(options.maxBuffer).toBe(16)
      throw overflow
    })
    const options = Object.freeze({
      exec: exec as never,
      maxOutputBytes: 16,
      maxSerializedBytes: 8
    })

    await expect(inspectGooseHistoryExport(session, options)).resolves.toEqual({
      oversized: true,
      serializedBytes: 17,
      serializedBytesExact: false
    })
    expect(options.maxOutputBytes).toBe(16)
  })

  it.each([
    ['exact ceiling', EXPORT_ABSOLUTE_LIMIT_BYTES],
    ['larger caller value', EXPORT_ABSOLUTE_LIMIT_BYTES + 1]
  ])('caps the injected export buffer at the absolute ceiling for %s', async (_name, maxOutputBytes) => {
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    const overflow = commandFailure('stdout maxBuffer exceeded') as Error & { code: string }
    overflow.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    const exec = vi.fn(async (_binary: string, _args: string[], options: { maxBuffer: number }) => {
      expect(options.maxBuffer).toBe(EXPORT_ABSOLUTE_LIMIT_BYTES)
      throw overflow
    })
    const options = Object.freeze({
      exec: exec as never,
      maxOutputBytes,
      maxSerializedBytes: 1
    })

    await expect(inspectGooseHistoryExport(session, options)).resolves.toEqual({
      oversized: true,
      serializedBytes: EXPORT_ABSOLUTE_LIMIT_BYTES + 1,
      serializedBytesExact: false
    })
    expect(options.maxOutputBytes).toBe(maxOutputBytes)
  })

  it('allows the streaming path to count exactly to the ceiling without terminating the child', async () => {
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    const harness = createStreamingSpawnHarness(EXPORT_ABSOLUTE_LIMIT_BYTES / STREAM_CHUNK_BYTES)
    const options = Object.freeze({
      maxOutputBytes: EXPORT_ABSOLUTE_LIMIT_BYTES,
      maxSerializedBytes: 1,
      spawn: harness.spawn as never
    })

    await expect(inspectGooseHistoryExport(session, options)).resolves.toEqual({
      oversized: true,
      serializedBytes: EXPORT_ABSOLUTE_LIMIT_BYTES,
      serializedBytesExact: true
    })
    expect(harness.kill).not.toHaveBeenCalled()
    expect(options.maxOutputBytes).toBe(EXPORT_ABSOLUTE_LIMIT_BYTES)
  })

  it('clamps a larger streaming caller limit and terminates once at the absolute ceiling', async () => {
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    const harness = createStreamingSpawnHarness(EXPORT_ABSOLUTE_LIMIT_BYTES / STREAM_CHUNK_BYTES + 1)
    const requestedLimit = EXPORT_ABSOLUTE_LIMIT_BYTES + STREAM_CHUNK_BYTES
    const options = Object.freeze({
      maxOutputBytes: requestedLimit,
      maxSerializedBytes: 1,
      spawn: harness.spawn as never
    })

    await expect(inspectGooseHistoryExport(session, options)).resolves.toEqual({
      oversized: true,
      serializedBytes: EXPORT_ABSOLUTE_LIMIT_BYTES + 1,
      serializedBytesExact: false
    })
    expect(harness.kill).toHaveBeenCalledTimes(1)
    expect(harness.kill).toHaveBeenCalledWith('SIGKILL')
    expect(options.maxOutputBytes).toBe(requestedLimit)
  })

  it.each([
    Number.POSITIVE_INFINITY,
    EXPORT_ABSOLUTE_LIMIT_BYTES + 0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    0,
    -1
  ])('rejects invalid output limit %s before either export execution path starts', async (maxOutputBytes) => {
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    const exec = vi.fn()
    const spawn = vi.fn()

    await expect(inspectGooseHistoryExport(session, {
      exec: exec as never,
      maxOutputBytes,
      maxSerializedBytes: 1
    })).rejects.toThrow('positive safe integer')
    await expect(inspectGooseHistoryExport(session, {
      maxOutputBytes,
      maxSerializedBytes: 1,
      spawn: spawn as never
    })).rejects.toThrow('positive safe integer')
    expect(exec).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('bounds streaming memory at the absolute ceiling while preserving per-candidate oversize classification', async () => {
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    const options = Object.freeze({
      binaryPath: fixturePath,
      maxOutputBytes: 1_200,
      maxSerializedBytes: 1_000
    })

    await expect(inspectGooseHistoryExport(session, options)).resolves.toEqual({
      oversized: true,
      serializedBytes: 1_201,
      serializedBytesExact: false
    })
    expect(options.maxOutputBytes).toBe(1_200)
  })

  it('passes a minimal local environment without provider credentials or isolated runtime root', async () => {
    let seenEnv: NodeJS.ProcessEnv | undefined
    const exec = vi.fn(async (_binary: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      seenEnv = options.env
      return { stdout: '[]', stderr: '' }
    })
    await listGooseHistory({
      env: {
        HOME: '/real-home',
        PATH: '/usr/bin',
        GOOSE_PATH_ROOT: '/isolated-task-root',
        GOOSE_PROVIDER: 'secret-provider',
        ANTHROPIC_API_KEY: 'secret'
      },
      exec: exec as never
    })
    expect(seenEnv).toMatchObject({ HOME: '/real-home', PATH: '/usr/bin' })
    expect(seenEnv).not.toHaveProperty('GOOSE_PATH_ROOT')
    expect(seenEnv).not.toHaveProperty('GOOSE_PROVIDER')
    expect(seenEnv).not.toHaveProperty('ANTHROPIC_API_KEY')
  })

  it.each([
    ['invalid JSON', async () => ({ stdout: '{', stderr: '' }), 'invalid JSON'],
    ['non-zero exit', async () => {
      throw commandFailure('exit 2', 'fixture failed')
    }, 'fixture failed'],
    ['timeout', async () => {
      const error = commandFailure('timed out') as Error & { killed: boolean }
      error.killed = true
      throw error
    }, 'timed out'],
    ['oversized output', async () => ({ stdout: '[] '.repeat(100), stderr: '' }), 'exceeded']
  ])('fails closed on %s', async (_name, exec, expected) => {
    await expect(listGooseHistory({
      exec: exec as never,
      maxOutputBytes: _name === 'oversized output' ? 8 : undefined,
      timeoutMs: 50
    })).rejects.toThrow(expected)
  })

  it('enforces a real child-process timeout for the public CLI call', async () => {
    await chmod(timeoutFixturePath, 0o755)
    await expect(listGooseHistory({
      binaryPath: timeoutFixturePath,
      timeoutMs: 50
    })).rejects.toThrow('timed out after 50ms')
  })

  it('enforces the aggregate timeout while streaming a public export and kills the child', async () => {
    const session = (await listGooseHistory({ binaryPath: fixturePath }))[0]!

    await expect(inspectGooseHistoryExport(session, {
      binaryPath: timeoutFixturePath,
      maxSerializedBytes: 50 * 1024 * 1024,
      timeoutMs: 50
    })).rejects.toThrow('timed out after 50ms')
  })

  it('shares one aggregate request deadline across list and export commands', async () => {
    const listed = [{
      id: 'deadline-session',
      working_dir: '/workspace/deadline',
      name: 'Deadline session',
      created_at: '2026-08-13T12:00:00Z',
      updated_at: '2026-08-13T12:01:00Z',
      message_count: 1
    }]
    const exec = vi.fn(async () => ({ stdout: JSON.stringify(listed), stderr: '' }))
    const timestamps = [100, 151]
    const options = {
      deadlineAt: 150,
      exec: exec as never,
      now: () => timestamps.shift() ?? 151,
      timeoutMs: 1_000
    }
    const sessions = await listGooseHistory(options)

    await expect(inspectGooseHistoryExport(sessions[0]!, options)).rejects.toThrow(
      'request deadline exceeded'
    )
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('rejects malicious native ids, working directories, and mismatched exports', async () => {
    const base = {
      id: 'session/../../escape',
      working_dir: '../escape',
      name: 'bad',
      created_at: '2026-08-13T12:00:00Z',
      updated_at: '2026-08-13T12:00:00Z',
      message_count: 1
    }
    await expect(listGooseHistory({
      exec: (async () => ({ stdout: JSON.stringify([base]), stderr: '' })) as never
    })).rejects.toThrow(/unsafe native session id|unsafe working directory/u)

    const valid = (await listGooseHistory({ binaryPath: fixturePath }))[0]!
    await expect(exportGooseHistory(valid, {
      exec: (async () => ({
        stdout: JSON.stringify({ ...base, id: 'different-id', working_dir: valid.cwd, conversation: [] }),
        stderr: ''
      })) as never
    })).rejects.toThrow('mismatched session')
  })

  it('rejects one native id claimed by multiple project paths', async () => {
    const base = {
      id: 'safe-session-id',
      working_dir: '/workspace/project-a',
      name: 'Conflicting project ownership',
      created_at: '2026-08-13T12:00:00Z',
      updated_at: '2026-08-13T12:01:00Z',
      message_count: 1
    }
    await expect(listGooseHistory({
      exec: (async () => ({
        stdout: JSON.stringify([base, { ...base, working_dir: '/workspace/project-b' }]),
        stderr: ''
      })) as never
    })).rejects.toThrow('multiple projects')
  })
})
