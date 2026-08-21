import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDirectCodexSession } from '#~/runtime/direct.js'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: mocks.spawn
}))

const createChild = (spawned = true) => {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>
    pid?: number
  }
  child.kill = vi.fn()
  if (spawned) child.pid = 4242
  return child
}

const createBase = (reconcileCredentialOwner: () => Promise<void>) => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn()
  },
  cwd: '/synthetic/workspace',
  binaryPath: '/synthetic/codex',
  spawnEnv: {},
  useYolo: false,
  approvalPolicy: 'never',
  sandboxPolicy: { type: 'readOnly' },
  features: {},
  configOverrideArgs: [],
  resolvedModel: undefined,
  resolvedAccount: 'work',
  reconcileCredentialOwner,
  cachedThreadId: undefined
})

const createOptions = (onEvent: ReturnType<typeof vi.fn>) => ({
  onEvent,
  type: 'query',
  permissionMode: 'dontAsk'
})

describe('codex direct credential owner cleanup', () => {
  beforeEach(() => {
    mocks.spawn.mockReset()
  })

  it('flushes the managed owner before reporting normal process exit', async () => {
    const child = createChild()
    let finishReconciliation!: () => void
    const reconcileCredentialOwner = vi.fn(() =>
      new Promise<void>((resolve) => {
        finishReconciliation = resolve
      })
    )
    const onEvent = vi.fn()
    mocks.spawn.mockReturnValue(child)

    createDirectCodexSession(
      createBase(reconcileCredentialOwner) as any,
      createOptions(onEvent) as any
    )
    child.emit('exit', 0)

    expect(reconcileCredentialOwner).toHaveBeenCalledOnce()
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'exit' }))
    finishReconciliation()
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith({ type: 'exit', data: { exitCode: 0 } })
    })
  })

  it('flushes a managed owner after a true spawn failure and emits exit only once', async () => {
    const child = createChild(false)
    const reconcileCredentialOwner = vi.fn(async () => undefined)
    const onEvent = vi.fn()
    mocks.spawn.mockReturnValue(child)

    createDirectCodexSession(
      createBase(reconcileCredentialOwner) as any,
      createOptions(onEvent) as any
    )
    child.emit('error', new Error('synthetic spawn failure'))
    child.emit('exit', 1)

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith({
        type: 'exit',
        data: { exitCode: 1, stderr: 'synthetic spawn failure' }
      })
    })
    expect(reconcileCredentialOwner).toHaveBeenCalledOnce()
    expect(onEvent.mock.calls.filter(([event]) => event.type === 'exit')).toHaveLength(1)
  })

  it('reports a post-spawn process error but waits for the actual exit before flushing', async () => {
    const child = createChild()
    const reconcileCredentialOwner = vi.fn(async () => undefined)
    const onEvent = vi.fn()
    mocks.spawn.mockReturnValue(child)

    createDirectCodexSession(
      createBase(reconcileCredentialOwner) as any,
      createOptions(onEvent) as any
    )
    child.emit('error', new Error('synthetic signal delivery failure'))

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ message: 'synthetic signal delivery failure' })
    }))
    expect(reconcileCredentialOwner).not.toHaveBeenCalled()
    expect(onEvent.mock.calls.some(([event]) => event.type === 'exit')).toBe(false)

    child.emit('exit', 0)
    await vi.waitFor(() => {
      expect(reconcileCredentialOwner).toHaveBeenCalledOnce()
      expect(onEvent).toHaveBeenCalledWith({ type: 'exit', data: { exitCode: 0 } })
    })
  })
})
