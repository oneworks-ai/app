import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn()
}))
const pathMocks = vi.hoisted(() => ({ isDev: true }))
const execFileAsync = promisify(execFile)

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: mocks.spawn
}))
vi.mock('../src/main/child-process-env', () => ({
  sanitizeDesktopChildProcessEnv: (env: NodeJS.ProcessEnv) => ({ ...env })
}))
vi.mock('../src/main/cli-path-env', () => ({ resolvePackagedCliPathEnv: () => ({}) }))
vi.mock('../src/main/paths', () => ({
  get isDev() {
    return pathMocks.isDev
  },
  repoRoot: '/oneworks/source',
  resolveBundledRuntimeConsumerBootstrapPath: () => undefined,
  resolveCachedServerPackageEnv: () => ({}),
  resolveClientDistPath: () => undefined,
  resolveClientPackageDir: () => undefined,
  resolveServerExecutable: () => process.execPath,
  serverChildPath: '/oneworks/server-child.cjs'
}))
vi.mock('../src/main/process-utils', () => ({
  isChildProcessRunning: () => false,
  killChildProcess: vi.fn(async () => undefined),
  writePrefixedChunk: vi.fn()
}))
vi.mock('../src/main/ready-checks', () => ({
  getAvailablePort: vi.fn(async () => 43189),
  waitForServerStartup: vi.fn(async () => undefined)
}))
vi.mock('../src/main/runtime-cache-version', () => ({
  resolveDesktopRuntimePackageCacheVersionEnv: () => ({})
}))
vi.mock('../src/main/updates', () => ({ refreshWorkspaceRuntimeCacheInBackground: vi.fn() }))

const createChild = () =>
  Object.assign(new EventEmitter(), {
    pid: 43189,
    stderr: new EventEmitter(),
    stdout: new EventEmitter()
  })

describe('workspace service manager path identity', () => {
  let fixtureRoot = ''

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'oneworks-workspace-service-'))
    pathMocks.isDev = true
    mocks.spawn.mockReset()
    mocks.spawn.mockImplementation(createChild)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(fixtureRoot, { force: true, recursive: true })
  })

  const startService = async (workspaceFolder: string) => {
    const { createWorkspaceServiceManager } = await import('../src/main/workspace-service-manager')
    const manager = createWorkspaceServiceManager({
      broadcastWorkspaceSelectorState: vi.fn(),
      findWorkspaceWindowRecord: vi.fn(),
      getBrowserControlEnv: vi.fn(() => ({})),
      getDesktopClientOrigin: vi.fn(),
      getIsQuitting: vi.fn(() => false),
      loadWorkspaceSelectorWindow: vi.fn(),
      refreshAppMenu: vi.fn(),
      runtimeState: {
        desktopState: {},
        isQuitting: false,
        pendingLaunchRequests: [],
        services: new Map(),
        windows: new Map()
      } as never
    })
    await manager.ensureWorkspaceService(workspaceFolder)
    return mocks.spawn.mock.calls.at(-1)?.[2] as { cwd?: string; env?: NodeJS.ProcessEnv }
  }

  it('preserves exact inherited workspace and primary identities in the child env', async () => {
    const workspaceFolder = path.join(fixtureRoot, process.platform === 'win32' ? ' project' : 'project ')
    const primaryWorkspaceFolder = path.join(fixtureRoot, process.platform === 'win32' ? ' primary' : 'primary ')
    await mkdir(workspaceFolder)
    await mkdir(primaryWorkspaceFolder)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspaceFolder)
    vi.stubEnv('__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__', primaryWorkspaceFolder)

    const options = await startService(workspaceFolder)

    expect(options.cwd).toBe(workspaceFolder)
    expect(options.env?.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe(workspaceFolder)
    expect(options.env?.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBe(primaryWorkspaceFolder)
  })

  it('does not accept an adjacent whitespace-bearing base resolve cwd', async () => {
    const workspaceFolder = path.join(fixtureRoot, 'project')
    const adjacentWorkspace = `${workspaceFolder} `
    await mkdir(workspaceFolder)
    await mkdir(adjacentWorkspace)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspaceFolder)
    vi.stubEnv('__ONEWORKS_PROJECT_BASE_DIR__', '.oo')
    vi.stubEnv('__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__', adjacentWorkspace)

    const options = await startService(workspaceFolder)

    expect(options.env?.__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__).toBe(workspaceFolder)
    expect(options.env?.__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__).not.toBe(adjacentWorkspace)
  })

  it('forwards exact first and last client fs-allow roots into the spawned service', async () => {
    const workspaceFolder = path.join(fixtureRoot, 'project')
    const firstRoot = path.join(fixtureRoot, process.platform === 'win32' ? ' first' : 'first ')
    const lastRoot = path.join(fixtureRoot, ' last')
    await Promise.all([mkdir(workspaceFolder), mkdir(firstRoot), mkdir(lastRoot)])
    vi.stubEnv('__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__', [firstRoot, lastRoot].join(path.delimiter))

    const options = await startService(workspaceFolder)
    const forwarded = JSON.parse(options.env?.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__ ?? '[]') as string[]

    expect(forwarded).toContain(path.resolve(firstRoot))
    expect(forwarded).toContain(path.resolve(lastRoot))
    expect(forwarded).not.toContain(path.resolve(firstRoot.trim()))
  })

  it('preserves exact PATH and client fs-allow entries through desktop child env construction', async () => {
    const exactBin = '/tmp/oneworks-bin '
    const firstRoot = '/tmp/client-first '
    const lastRoot = ' /tmp/client-last'
    const { resolveDesktopDevClientFsAllowEnv } = await import('../src/main/workspace-service-manager')
    const { resolveDevServerFsAllow } = await import('../../client/vite-fs-allow')
    const forwarded = resolveDesktopDevClientFsAllowEnv({
      __ONEWORKS_PROJECT_CLIENT_FS_ALLOW__: [firstRoot, lastRoot].join(path.delimiter)
    })
    const clientAllow = resolveDevServerFsAllow('/repo', forwarded)
    expect(clientAllow).toContain(path.resolve(firstRoot))
    expect(clientAllow).toContain(path.resolve(lastRoot))
    expect(clientAllow).not.toContain(path.resolve(firstRoot.trim()))

    pathMocks.isDev = false
    const { resolvePackagedCliPathEnv } = await vi.importActual<typeof import('../src/main/cli-path-env')>(
      '../src/main/cli-path-env'
    )
    expect(resolvePackagedCliPathEnv({ PATH: [exactBin, '/tmp/oneworks-bin'].join(path.delimiter) })).toEqual(
      process.platform === 'win32' ? {} : { PATH: expect.stringContaining(`${exactBin}${path.delimiter}`) }
    )
  })

  it.runIf(process.platform !== 'win32')('executes from the exact whitespace-bearing packaged PATH entry', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-cli-path-'))
    const adjacentBin = path.join(root, 'bin')
    const exactBin = path.join(root, 'bin ')
    const commandName = 'oneworks-path-identity'
    pathMocks.isDev = false
    await Promise.all([mkdir(adjacentBin), mkdir(exactBin)])
    for (const [binDir, identity] of [[adjacentBin, 'adjacent'], [exactBin, 'exact']] as const) {
      const commandPath = path.join(binDir, commandName)
      await writeFile(commandPath, `#!/bin/sh\nprintf %s ${identity}\n`, 'utf8')
      await chmod(commandPath, 0o755)
    }
    try {
      const { resolvePackagedCliPathEnv } = await vi.importActual<typeof import('../src/main/cli-path-env')>(
        '../src/main/cli-path-env'
      )
      const childEnv = resolvePackagedCliPathEnv({ PATH: [exactBin, adjacentBin].join(path.delimiter) })
      const result = await execFileAsync(commandName, [], { env: { ...process.env, ...childEnv } })
      expect(result.stdout).toBe('exact')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it.runIf(process.platform !== 'win32')('forwards exact INIT_CWD bytes through the desktop dev process', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-dev-script-'))
    const binDir = path.join(root, 'bin')
    const outputPath = path.join(root, 'workspace.txt')
    const exactWorkspace = path.join(root, 'workspace ')
    await mkdir(binDir, { recursive: true })
    const pnpmPath = path.join(binDir, 'pnpm')
    await writeFile(
      pnpmPath,
      '#!/bin/sh\nprintf %s "$ONEWORKS_DESKTOP_WORKSPACE" > "$ONEWORKS_TEST_OUTPUT"\n',
      'utf8'
    )
    await chmod(pnpmPath, 0o755)
    try {
      await execFileAsync(process.execPath, [path.resolve(__dirname, '../scripts/dev.cjs'), '--workspace'], {
        env: {
          ...process.env,
          INIT_CWD: exactWorkspace,
          ONEWORKS_TEST_OUTPUT: outputPath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`
        }
      })
      await expect(readFile(outputPath, 'utf8')).resolves.toBe(exactWorkspace)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
