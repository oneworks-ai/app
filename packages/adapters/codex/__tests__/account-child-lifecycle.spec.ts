import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { manageCodexAccount } from '#~/runtime/accounts.js'

const mocks = vi.hoisted(() => ({
  behaviors: [] as SyntheticChildBehavior[],
  processes: [] as SyntheticChildProcess[],
  spawn: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: mocks.spawn
}))

interface SyntheticChildBehavior {
  autoLoginSuccess?: boolean
  emitPostSpawnError?: boolean
  hangMethod?: string
  ignoreSigterm?: boolean
}

class SyntheticChildProcess extends EventEmitter {
  exitCode: number | null = null
  pid: number | undefined
  signalCode: NodeJS.Signals | null = null
  stderr = new PassThrough()
  stdin = new PassThrough()
  stdout = new PassThrough()
  signals: NodeJS.Signals[] = []

  constructor(
    readonly args: string[],
    readonly env: NodeJS.ProcessEnv,
    private behavior: SyntheticChildBehavior,
    pid: number
  ) {
    super()
    this.pid = pid
    this.stdin.on('data', chunk => this.handleInput(String(chunk)))
    queueMicrotask(() => this.start())
  }

  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.signals.push(signal)
    if (signal === 'SIGTERM' && this.behavior.ignoreSigterm === true) return true
    queueMicrotask(() => this.finish(null, signal))
    return true
  }

  private start() {
    this.emit('spawn')
    if (this.behavior.emitPostSpawnError === true) {
      this.emit('error', new Error('synthetic post-spawn error'))
      return
    }
    if (this.args[0] === 'login' && this.behavior.autoLoginSuccess === true) {
      const codexHome = this.env.CODEX_HOME
      if (codexHome == null) throw new Error('synthetic login requires CODEX_HOME')
      mkdirSync(codexHome, { recursive: true })
      writeFileSync(
        join(codexHome, 'auth.json'),
        '{"auth_mode":"chatgpt","tokens":{"account_id":"acct_lifecycle"}}\n'
      )
      this.finish(0, null)
    }
  }

  private handleInput(input: string) {
    if (this.behavior.emitPostSpawnError === true) return
    for (const line of input.split('\n')) {
      if (line.trim() === '') continue
      const message = JSON.parse(line) as { id?: number; method?: string }
      if (message.id == null || message.method == null || message.method === this.behavior.hangMethod) continue
      const result = message.method === 'account/read'
        ? { account: { type: 'chatgpt', planType: 'pro' } }
        : message.method === 'account/rateLimits/read'
        ? { rateLimits: { limitId: 'codex', planType: 'pro' } }
        : {}
      this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`)
    }
  }

  private finish(code: number | null, signal: NodeJS.Signals | null) {
    if (this.exitCode != null || this.signalCode != null) return
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
    this.emit('close', code, signal)
  }
}

const tempDirs: string[] = []

const makeCtx = async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-child-lifecycle-'))
  const realHome = join(workspace, 'real-home')
  const fakeCodexPath = join(workspace, 'fake-codex')
  tempDirs.push(workspace)
  await mkdir(join(realHome, '.oneworks'), { recursive: true })
  await writeFile(fakeCodexPath, '# synthetic\n')
  await chmod(fakeCodexPath, 0o755)
  return {
    ctx: {
      cache: {
        get: async () => undefined,
        set: async () => ({ cachePath: '' })
      },
      configs: [],
      ctxId: 'child-lifecycle',
      cwd: workspace,
      env: {
        HOME: join(workspace, 'mock-home'),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath
      },
      logger: {
        stream: new PassThrough(),
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    } as any,
    workspace
  }
}

const queueBehaviors = (...behaviors: SyntheticChildBehavior[]) => {
  mocks.behaviors.push(...behaviors)
}

const waitForProcessCount = async (count: number) => {
  await vi.waitFor(() => expect(mocks.processes).toHaveLength(count))
  return mocks.processes[count - 1]!
}

afterEach(async () => {
  vi.useRealTimers()
  mocks.behaviors.length = 0
  mocks.processes.length = 0
  mocks.spawn.mockClear()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('codex login and probe child lifecycle', () => {
  it('waits for a post-spawn login error and uses bounded SIGKILL before cleanup', async () => {
    vi.useFakeTimers()
    const { ctx } = await makeCtx()
    queueBehaviors({ emitPostSpawnError: true, ignoreSigterm: true })
    const request = manageCodexAccount(ctx, { action: 'add' })
    await vi.advanceTimersByTimeAsync(0)
    const login = await waitForProcessCount(1)

    expect(login.signals).toEqual(['SIGTERM'])
    await expect(stat(login.env.HOME!)).resolves.toBeDefined()
    await vi.advanceTimersByTimeAsync(500)
    expect(login.signals).toEqual(['SIGTERM', 'SIGKILL'])
    await expect(request).rejects.toThrow('synthetic post-spawn error')
    await expect(stat(login.env.HOME!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('waits for an aborted login child before removing its isolated HOME', async () => {
    const { ctx } = await makeCtx()
    const controller = new AbortController()
    queueBehaviors({})
    const request = manageCodexAccount(ctx, { action: 'add', signal: controller.signal })
    const login = await waitForProcessCount(1)

    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(login.signals).toEqual(['SIGTERM'])
    await expect(stat(login.env.HOME!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('waits for a post-spawn probe error and bounded SIGKILL before cleaning both homes', async () => {
    vi.useFakeTimers()
    const { ctx } = await makeCtx()
    queueBehaviors(
      { autoLoginSuccess: true },
      { emitPostSpawnError: true, ignoreSigterm: true }
    )
    const request = manageCodexAccount(ctx, { action: 'add' })
    await vi.advanceTimersByTimeAsync(0)
    const probe = await waitForProcessCount(2)
    const login = mocks.processes[0]!

    await vi.waitFor(() => expect(probe.signals).toEqual(['SIGTERM']))
    await expect(stat(probe.env.HOME!)).resolves.toBeDefined()
    await vi.advanceTimersByTimeAsync(500)
    expect(probe.signals).toEqual(['SIGTERM', 'SIGKILL'])
    await expect(request).rejects.toThrow('synthetic post-spawn error')
    await expect(stat(login.env.HOME!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(probe.env.HOME!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('waits for an aborted probe before cleaning the login and probe homes', async () => {
    const { ctx } = await makeCtx()
    const controller = new AbortController()
    queueBehaviors(
      { autoLoginSuccess: true },
      { hangMethod: 'account/read' }
    )
    const request = manageCodexAccount(ctx, { action: 'add', signal: controller.signal })
    const probe = await waitForProcessCount(2)
    const login = mocks.processes[0]!

    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(probe.signals).toEqual(['SIGTERM'])
    await expect(stat(login.env.HOME!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(probe.env.HOME!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('finishes successful login and probe children before removing their homes', async () => {
    const { ctx } = await makeCtx()
    queueBehaviors(
      { autoLoginSuccess: true },
      {}
    )
    const result = await manageCodexAccount(ctx, { action: 'add' })
    const [login, probe] = mocks.processes

    expect(result.accountKey).toBeTruthy()
    expect(login?.exitCode).toBe(0)
    expect(probe?.signals).toEqual(['SIGTERM'])
    expect(probe?.signalCode).toBe('SIGTERM')
    await expect(stat(login!.env.HOME!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(probe!.env.HOME!)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

mocks.spawn.mockImplementation((_binary, args: string[], options: { env: NodeJS.ProcessEnv }) => {
  const behavior = mocks.behaviors.shift()
  if (behavior == null) throw new Error('Missing synthetic child behavior')
  const proc = new SyntheticChildProcess(
    args,
    options.env,
    behavior,
    5100 + mocks.processes.length
  )
  mocks.processes.push(proc)
  return proc as any
})
