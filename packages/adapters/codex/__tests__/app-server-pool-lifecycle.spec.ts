import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLocalCodexAppServerPool } from '#~/runtime/app-server-pool.js'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn
}))

class SyntheticCodexProcess extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  stderr = new PassThrough()
  stdin = new PassThrough()
  stdout = new PassThrough()
  kill = vi.fn((_signal?: NodeJS.Signals) => true)

  constructor(public pid: number | undefined, private respondToInitialize = true) {
    super()
    let buffered = ''
    this.stdin.on('data', (chunk) => {
      buffered += String(chunk)
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim() === '') continue
        const message = JSON.parse(line) as { id?: number; method?: string }
        if (this.respondToInitialize && message.method === 'initialize' && message.id != null) {
          this.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'synthetic' } })}\n`)
        }
      }
    })
  }

  finish(code: number | null) {
    this.exitCode = code
    this.emit('exit', code)
    this.emit('close', code)
  }
}

const makeLogger = () =>
  ({
    stream: new PassThrough(),
    paths: {},
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }) as any

const makeAcquireParams = () => ({
  args: [],
  binaryPath: '/synthetic/codex',
  clientInfo: {},
  cwd: '/synthetic',
  env: {},
  experimentalApi: false,
  idleTimeoutMs: 300_000,
  logger: makeLogger(),
  profileKey: 'synthetic-profile'
})

describe('local Codex app-server pool lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('waits for actual termination after a post-spawn error and forces an ignored SIGTERM', async () => {
    vi.useFakeTimers()
    const failedProcess = new SyntheticCodexProcess(4101)
    const retryProcess = new SyntheticCodexProcess(4102)
    retryProcess.kill.mockImplementation(() => {
      retryProcess.finish(0)
      return true
    })
    mocks.spawn
      .mockReturnValueOnce(failedProcess as any)
      .mockReturnValueOnce(retryProcess as any)
    const pool = createLocalCodexAppServerPool()
    const lease = await pool.acquire(makeAcquireParams())
    const onExit = vi.fn()
    lease.onExit(onExit)
    const pendingRequest = lease.rpc.request('synthetic/pending')
    const pendingRejected = vi.fn()
    void pendingRequest.catch(pendingRejected)

    failedProcess.emit('error', new Error('synthetic post-spawn error'))
    expect(failedProcess.kill).toHaveBeenCalledWith('SIGTERM')
    expect(onExit).not.toHaveBeenCalled()
    expect(pendingRejected).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(failedProcess.kill).toHaveBeenCalledWith('SIGKILL')
    expect(onExit).not.toHaveBeenCalled()
    expect(pendingRejected).not.toHaveBeenCalled()

    failedProcess.finish(23)
    await expect(pendingRequest).rejects.toThrow('Codex app-server exited')
    expect(onExit).toHaveBeenCalledOnce()
    expect(onExit).toHaveBeenCalledWith(23)

    const retryLease = await pool.acquire(makeAcquireParams())
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    retryLease.release()
    await pool.dispose()
  })

  it('terminalizes a true spawn failure with no pid exactly once', async () => {
    const failedProcess = new SyntheticCodexProcess(undefined, false)
    mocks.spawn.mockReturnValueOnce(failedProcess as any)
    const pool = createLocalCodexAppServerPool()
    const acquiring = pool.acquire(makeAcquireParams())

    failedProcess.emit('error', new Error('synthetic spawn failure'))

    await expect(acquiring).rejects.toThrow('synthetic spawn failure')
    expect(failedProcess.kill).not.toHaveBeenCalled()
    await pool.dispose()
  })

  it('keeps disposal pending until an ignored SIGTERM is followed by actual exit', async () => {
    vi.useFakeTimers()
    const process = new SyntheticCodexProcess(4103)
    mocks.spawn.mockReturnValueOnce(process as any)
    const pool = createLocalCodexAppServerPool()
    await pool.acquire(makeAcquireParams())

    let disposed = false
    const disposing = pool.dispose().then(() => {
      disposed = true
    })

    expect(process.kill).toHaveBeenCalledWith('SIGTERM')
    await Promise.resolve()
    expect(disposed).toBe(false)

    await vi.advanceTimersByTimeAsync(500)
    expect(process.kill).toHaveBeenCalledWith('SIGKILL')
    expect(disposed).toBe(false)

    process.finish(0)
    await disposing
    expect(disposed).toBe(true)
  })
})
