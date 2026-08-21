import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyCodexNetworkEnv: vi.fn((env: NodeJS.ProcessEnv) => env),
  materializeCodexCaCertificate: vi.fn(async (config: unknown) => config),
  prepareCodexSessionHome: vi.fn(async () => ({
    accountKey: 'work',
    homeDir: '/tmp/codex-model-sharing-home',
    reconcileCredentialOwner: undefined as (() => Promise<void>) | undefined
  })),
  resolveCodexAdapterConfig: vi.fn(() => ({
    native: { shareBuiltinModels: true }
  })),
  resolveCodexBinaryPath: vi.fn(() => '/managed/codex'),
  resolveCodexNetworkConfig: vi.fn(() => ({})),
  spawn: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: mocks.spawn
}))
vi.mock('#~/paths.js', () => ({ resolveCodexBinaryPath: mocks.resolveCodexBinaryPath }))
vi.mock('#~/runtime/accounts.js', () => ({ prepareCodexSessionHome: mocks.prepareCodexSessionHome }))
vi.mock('#~/runtime/config.js', () => ({ resolveCodexAdapterConfig: mocks.resolveCodexAdapterConfig }))
vi.mock('#~/runtime/network.js', () => ({
  applyCodexNetworkEnv: mocks.applyCodexNetworkEnv,
  materializeCodexCaCertificate: mocks.materializeCodexCaCertificate,
  resolveCodexNetworkConfig: mocks.resolveCodexNetworkConfig
}))

const createProcess = () => {
  const proc = new EventEmitter() as EventEmitter & {
    exitCode: number | null
    pid?: number
    signalCode: NodeJS.Signals | null
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  proc.exitCode = null
  proc.pid = 4242
  proc.signalCode = null
  proc.stdin = new PassThrough()
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.kill = vi.fn(() => true)
  return proc
}

const ctx = {
  cache: { get: vi.fn(), set: vi.fn() },
  configs: [],
  ctxId: 'test',
  cwd: '/workspace',
  env: {},
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
} as any

describe('codex model sharing bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveCodexAdapterConfig.mockReturnValue({ native: { shareBuiltinModels: true } })
  })

  it('starts the official stdio app-server in the account-bound home and bridges JSON-RPC', async () => {
    const proc = createProcess()
    mocks.spawn.mockReturnValue(proc)
    const received: string[] = []
    const bridge = await (await import('#~/model-sharing.js')).createCodexModelSharingBridge(ctx, {
      sessionId: 'session-1',
      account: 'work',
      onMessage: message => received.push(message)
    })

    expect(mocks.prepareCodexSessionHome).toHaveBeenCalledWith(expect.objectContaining({
      account: 'work',
      appServerProfileKey: 'model-sharing-v1',
      sessionId: 'session-1',
      useAccountPool: false
    }))
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/managed/codex',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({
        cwd: '/workspace',
        env: expect.objectContaining({
          CODEX_HOME: '/tmp/codex-model-sharing-home/.codex',
          HOME: '/tmp/codex-model-sharing-home',
          USERPROFILE: '/tmp/codex-model-sharing-home'
        }),
        stdio: ['pipe', 'pipe', 'pipe']
      })
    )

    const stdin: Buffer[] = []
    proc.stdin.on('data', chunk => stdin.push(Buffer.from(chunk)))
    await bridge.send('{"id":1,"method":"initialize"}')
    proc.stdout.write('{"id":1,"result":{}}\n')
    expect(Buffer.concat(stdin).toString('utf8')).toBe('{"id":1,"method":"initialize"}\n')
    expect(received).toEqual(['{"id":1,"result":{}}'])
    expect(bridge.accountKey).toBe('work')
    bridge.close()
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('fails closed when sharing is disabled or a frame is not a JSON object', async () => {
    mocks.resolveCodexAdapterConfig.mockReturnValueOnce({ native: { shareBuiltinModels: false } })
    const module = await import('#~/model-sharing.js')
    await expect(module.createCodexModelSharingBridge(ctx, {
      sessionId: 'session-1',
      onMessage: () => undefined
    })).rejects.toThrow('disabled')

    const proc = createProcess()
    mocks.spawn.mockReturnValue(proc)
    const bridge = await module.createCodexModelSharingBridge(ctx, {
      sessionId: 'session-2',
      onMessage: () => undefined
    })
    await expect(bridge.send('[]')).rejects.toThrow('JSON objects')
    bridge.close()
  })

  it('flushes a managed credential owner before reporting app-server exit', async () => {
    const proc = createProcess()
    let finishReconciliation!: () => void
    const reconcileCredentialOwner = vi.fn(() =>
      new Promise<void>((resolve) => {
        finishReconciliation = resolve
      })
    )
    mocks.prepareCodexSessionHome.mockResolvedValueOnce({
      accountKey: 'work',
      homeDir: '/tmp/codex-model-sharing-home',
      reconcileCredentialOwner
    })
    mocks.spawn.mockReturnValue(proc)
    const onExit = vi.fn()
    await (await import('#~/model-sharing.js')).createCodexModelSharingBridge(ctx, {
      sessionId: 'session-owner-flush',
      onExit,
      onMessage: () => undefined
    })

    proc.emit('exit', 0, null)
    expect(reconcileCredentialOwner).toHaveBeenCalledOnce()
    expect(onExit).not.toHaveBeenCalled()
    finishReconciliation()
    await vi.waitFor(() => {
      expect(onExit).toHaveBeenCalledWith(0, null)
    })
  })

  it('reports post-spawn errors but waits for close and actual exit before rejecting reconciliation', async () => {
    const proc = createProcess()
    const reconciliationError = new Error('synthetic reconciliation failure')
    const reconcileCredentialOwner = vi.fn(async () => {
      throw reconciliationError
    })
    mocks.prepareCodexSessionHome.mockResolvedValueOnce({
      accountKey: 'work',
      homeDir: '/tmp/codex-model-sharing-home',
      reconcileCredentialOwner
    })
    mocks.spawn.mockReturnValue(proc)
    const onError = vi.fn()
    const onExit = vi.fn()
    const bridge = await (await import('#~/model-sharing.js')).createCodexModelSharingBridge(ctx, {
      sessionId: 'session-owner-error-close',
      onError,
      onExit,
      onMessage: () => undefined
    })

    const processError = new Error('synthetic signal delivery failure')
    proc.emit('error', processError)
    expect(onError).toHaveBeenCalledWith(processError)
    expect(reconcileCredentialOwner).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()

    bridge.close()
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    proc.emit('exit', null, 'SIGTERM')

    await vi.waitFor(() => {
      expect(reconcileCredentialOwner).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith(reconciliationError)
      expect(onExit).toHaveBeenCalledWith(null, 'SIGTERM')
    })
  })

  it('flushes after a true app-server spawn failure with no pid', async () => {
    const proc = createProcess()
    proc.pid = undefined
    const reconcileCredentialOwner = vi.fn(async () => undefined)
    mocks.prepareCodexSessionHome.mockResolvedValueOnce({
      accountKey: 'work',
      homeDir: '/tmp/codex-model-sharing-home',
      reconcileCredentialOwner
    })
    mocks.spawn.mockReturnValue(proc)
    const onExit = vi.fn()
    await (await import('#~/model-sharing.js')).createCodexModelSharingBridge(ctx, {
      sessionId: 'session-spawn-failure',
      onExit,
      onMessage: () => undefined
    })

    proc.emit('error', new Error('synthetic spawn failure'))

    await vi.waitFor(() => {
      expect(reconcileCredentialOwner).toHaveBeenCalledOnce()
      expect(onExit).toHaveBeenCalledWith(null, null)
    })
  })

  it('does not spawn after a client disconnects while the account home is still preparing', async () => {
    let releaseHome: (() => void) | undefined
    mocks.prepareCodexSessionHome.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseHome = resolve
      })
      return {
        accountKey: 'work',
        homeDir: '/tmp/codex-model-sharing-home',
        reconcileCredentialOwner: undefined
      }
    })
    const controller = new AbortController()
    const module = await import('#~/model-sharing.js')
    const bridge = module.createCodexModelSharingBridge(ctx, {
      sessionId: 'session-disconnected',
      signal: controller.signal,
      onMessage: () => undefined
    })
    controller.abort()
    releaseHome?.()

    await expect(bridge).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
