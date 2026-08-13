import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configPath: '',
  spawn: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('#~/paths.js', () => ({ resolveCodexBinaryPath: () => '/bin/codex' }))
vi.mock('#~/protocol/rpc.js', () => ({
  CodexRpcClient: class {
    destroy = vi.fn()
    notify = vi.fn()
    onRequest = vi.fn()
    respond = vi.fn()
    request = vi.fn(async (method: string) =>
      method === 'config/read'
        ? {
          config: { owner: 'merged' },
          layers: [{ config: { owner: 'exact' }, name: { file: mocks.configPath, type: 'user' } }]
        }
        : {}
    )
  }
}))

const { readCodexModelProviderConfig } = await import('../src/runtime/model-provider-config-read.js')
const { resolveRealCodexHome, resolveRealHome } = await import('../src/runtime/real-home.js')

describe('codex model provider filesystem roots', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
    vi.clearAllMocks()
  })

  it('reads config and spawns with the exact whitespace-bearing real home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-codex-provider-path-'))
    tempDirs.push(root)
    const exactHome = join(root, 'home ')
    const adjacentHome = join(root, 'home')
    const exactCodexHome = join(exactHome, '.codex')
    await Promise.all([
      mkdir(exactCodexHome, { recursive: true }),
      mkdir(join(adjacentHome, '.codex'), { recursive: true })
    ])
    mocks.configPath = join(exactCodexHome, 'config.toml')
    await Promise.all([
      writeFile(mocks.configPath, 'model_provider = "exact"\n'),
      writeFile(join(adjacentHome, '.codex', 'config.toml'), 'model_provider = "adjacent"\n')
    ])
    mocks.spawn.mockImplementation((_binary: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const proc = new EventEmitter() as EventEmitter & {
        exitCode: number
        kill: ReturnType<typeof vi.fn>
        signalCode: null
        stderr: { resume: ReturnType<typeof vi.fn> }
      }
      proc.exitCode = 0
      proc.signalCode = null
      proc.kill = vi.fn()
      proc.stderr = { resume: vi.fn() }
      Object.assign(proc, { capturedEnv: options.env })
      return proc
    })

    const env = { __ONEWORKS_PROJECT_REAL_HOME__: exactHome }
    await expect(readCodexModelProviderConfig({ cwd: root, env })).resolves.toEqual({ owner: 'exact' })

    expect(resolveRealHome(env)).toBe(exactHome)
    expect(resolveRealCodexHome(env)).toBe(exactCodexHome)
    const spawnOptions = mocks.spawn.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv }
    expect(spawnOptions.env.HOME).toBe(exactHome)
    expect(spawnOptions.env.CODEX_HOME).toBe(exactCodexHome)
    expect(spawnOptions.env.HOME).not.toBe(adjacentHome)
  })
})
