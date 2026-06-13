import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { applyServerRuntimeEnv, runRuntimeEntry } from '#~/cli-runtime.js'

describe('applyServerRuntimeEnv', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('applies server defaults and resolves workspace-relative paths', () => {
    const repoRoot = process.cwd()
    const packageDir = resolve(repoRoot, 'apps/server')
    const env = applyServerRuntimeEnv({
      baseEnv: {},
      cwd: packageDir,
      packageDir,
      options: {
        configDir: '.oo/custom',
        workspace: '../..'
      },
      defaults: {
        allowCors: false,
        clientMode: 'none',
        entryKind: 'server',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws'
      }
    })

    expect(env.__ONEWORKS_PROJECT_LAUNCH_CWD__).toBe(packageDir)
    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe(repoRoot)
    expect(env.__ONEWORKS_PROJECT_CONFIG_DIR__).toBe(resolve(packageDir, '.oo/custom'))
    expect(env.__ONEWORKS_PROJECT_SERVER_HOST__).toBe('127.0.0.1')
    expect(env.__ONEWORKS_PROJECT_SERVER_PORT__).toBe('8787')
    expect(env.__ONEWORKS_PROJECT_SERVER_WS_PATH__).toBe('/ws')
    expect(env.__ONEWORKS_PROJECT_SERVER_ALLOW_CORS__).toBe('false')
    expect(env.__ONEWORKS_PROJECT_CLIENT_MODE__).toBe('none')
    expect(env.__ONEWORKS_PROJECT_SERVER_ENTRY_KIND__).toBe('server')
    expect(env.HOME).toContain('/.oneworks/projects/')
    expect(env.HOME).toMatch(/\/\.mock$/)
    expect(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__).toContain('/.oneworks/projects/')
    expect(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__).toMatch(/\/server\/data$/)
    expect(env.__ONEWORKS_PROJECT_SERVER_LOG_DIR__).toContain('/.oneworks/projects/')
    expect(env.__ONEWORKS_PROJECT_SERVER_LOG_DIR__).toMatch(/\/logs\/server$/)
  })

  it('preserves explicit values for the integrated web entry', () => {
    const repoRoot = process.cwd()
    const packageDir = resolve(repoRoot, 'apps/web')
    const env = applyServerRuntimeEnv({
      baseEnv: {
        HOME: '/tmp/ow-home'
      },
      cwd: repoRoot,
      packageDir,
      options: {
        base: 'embedded',
        dataDir: '.oneworks-data',
        host: '0.0.0.0',
        logDir: '.oneworks-logs',
        port: '9000',
        publicBaseUrl: 'https://ow.example.com'
      },
      defaults: {
        allowCors: false,
        clientBase: '/ui',
        clientMode: 'static',
        entryKind: 'web',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws'
      }
    })

    expect(env.__ONEWORKS_PROJECT_PACKAGE_DIR__).toBe(packageDir)
    expect(env.__ONEWORKS_PROJECT_SERVER_HOST__).toBe('0.0.0.0')
    expect(env.__ONEWORKS_PROJECT_SERVER_PORT__).toBe('9000')
    expect(env.__ONEWORKS_PROJECT_PUBLIC_BASE_URL__).toBe('https://ow.example.com')
    expect(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__).toBe('.oneworks-data')
    expect(env.__ONEWORKS_PROJECT_SERVER_LOG_DIR__).toBe('.oneworks-logs')
    expect(env.__ONEWORKS_PROJECT_CLIENT_MODE__).toBe('static')
    expect(env.__ONEWORKS_PROJECT_CLIENT_BASE__).toBe('embedded')
    expect(env.__ONEWORKS_PROJECT_SERVER_ENTRY_KIND__).toBe('web')
    expect(env.__ONEWORKS_PROJECT_REAL_HOME__).toBe('/tmp/ow-home')
  })

  it('supports manager web runtime without binding a workspace', () => {
    const repoRoot = process.cwd()
    const packageDir = resolve(repoRoot, 'apps/web')
    const env = applyServerRuntimeEnv({
      baseEnv: {
        HOME: '/tmp/ow-home'
      },
      cwd: repoRoot,
      packageDir,
      options: {},
      defaults: {
        allowCors: false,
        clientBase: '/ui',
        clientMode: 'static',
        entryKind: 'web',
        serverRole: 'manager',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws',
        workspaceMode: 'optional'
      }
    })

    expect(env.__ONEWORKS_PROJECT_SERVER_ROLE__).toBe('manager')
    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBeUndefined()
    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__).toBeUndefined()
    expect(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBeUndefined()
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBe('manager')
    expect(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__).toBe('/tmp/ow-home/.oneworks/projects/manager/server/data')
    expect(env.__ONEWORKS_PROJECT_SERVER_LOG_DIR__).toBe('/tmp/ow-home/.oneworks/projects/manager/logs/server')
    expect(env.HOME).toBe('/tmp/ow-home/.oneworks/projects/manager/.mock')
  })

  it('keeps optional web runtime bound when a workspace is explicit', () => {
    const repoRoot = process.cwd()
    const packageDir = resolve(repoRoot, 'apps/web')
    const env = applyServerRuntimeEnv({
      baseEnv: {
        HOME: '/tmp/ow-home'
      },
      cwd: resolve(repoRoot, 'apps/web'),
      packageDir,
      options: {
        workspace: '../..'
      },
      defaults: {
        allowCors: false,
        clientBase: '/ui',
        clientMode: 'static',
        entryKind: 'web',
        serverRole: 'workspace',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws',
        workspaceMode: 'optional'
      }
    })

    expect(env.__ONEWORKS_PROJECT_SERVER_ROLE__).toBe('workspace')
    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe(repoRoot)
    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__).toBe(repoRoot)
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBeUndefined()
  })

  it('scopes inherited exact project-home paths when the workspace option selects another workspace', () => {
    const root = resolve(process.cwd(), 'tmp-cli-runtime-scope')
    const workspaceA = resolve(root, 'workspace-a')
    const workspaceB = resolve(root, 'workspace-b')
    const projectsDir = resolve(root, 'home-projects')
    const packageDir = resolve(process.cwd(), 'apps/server')
    const env = applyServerRuntimeEnv({
      baseEnv: {
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceA,
        __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: workspaceA,
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: projectsDir,
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'workspace-a-home'
      },
      cwd: packageDir,
      packageDir,
      options: {
        workspace: workspaceB
      },
      defaults: {
        allowCors: false,
        clientMode: 'none',
        entryKind: 'server',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws'
      }
    })

    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe(workspaceB)
    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__).toBe(workspaceB)
    expect(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).not.toBe(workspaceA)
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBeUndefined()
    expect(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__).not.toContain('workspace-a-home')
  })

  it('does not inherit manager project-home paths when opening a workspace server', () => {
    const root = resolve(process.cwd(), 'tmp-cli-runtime-manager')
    const workspace = resolve(root, 'workspace')
    const projectsDir = resolve(root, 'home-projects')
    const realHome = resolve(root, 'real-home')
    const managerMockHome = resolve(projectsDir, 'manager', '.mock')
    const managerDataDir = resolve(projectsDir, 'manager', 'server', 'data')
    const managerLogDir = resolve(projectsDir, 'manager', 'logs')
    const managerDbPath = resolve(projectsDir, 'manager', '.local', 'server', 'db.sqlite')
    const packageDir = resolve(process.cwd(), 'apps/server')
    const env = applyServerRuntimeEnv({
      baseEnv: {
        HOME: managerMockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: projectsDir,
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'manager',
        __ONEWORKS_PROJECT_SERVER_DATA_DIR__: managerDataDir,
        __ONEWORKS_PROJECT_SERVER_LOG_DIR__: managerLogDir,
        DB_PATH: managerDbPath
      },
      cwd: packageDir,
      packageDir,
      options: {
        workspace
      },
      defaults: {
        allowCors: false,
        clientMode: 'none',
        entryKind: 'server',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws'
      }
    })

    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe(workspace)
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBeUndefined()
    expect(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__).toContain(projectsDir)
    expect(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__).not.toBe(managerDataDir)
    expect(env.__ONEWORKS_PROJECT_SERVER_LOG_DIR__).toContain(projectsDir)
    expect(env.__ONEWORKS_PROJECT_SERVER_LOG_DIR__).not.toBe(managerLogDir)
    expect(env.DB_PATH).toBeUndefined()
    expect(env.HOME).toContain(projectsDir)
    expect(env.HOME).not.toBe(managerMockHome)
  })

  it('starts the runtime child from the resolved launch cwd', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-server-runtime-cwd-'))
    tempDirs.push(root)
    const cliCwd = resolve(root, 'cli-cwd')
    const launchCwd = resolve(root, 'launch-cwd')
    const workspace = resolve(root, 'workspace')
    const realHome = resolve(root, 'real-home')
    const packageDir = resolve(process.cwd(), 'apps/server')
    const entryPath = resolve(root, 'entry.js')
    const outputPath = resolve(root, 'cwd.txt')

    await mkdir(cliCwd, { recursive: true })
    await mkdir(launchCwd, { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(
      entryPath,
      "require('node:fs').writeFileSync(process.env.ONEWORKS_TEST_CWD_OUT, process.cwd() + '\\n', 'utf8')\n",
      'utf8'
    )

    const env = applyServerRuntimeEnv({
      baseEnv: {
        HOME: realHome,
        ONEWORKS_TEST_CWD_OUT: outputPath,
        __ONEWORKS_PROJECT_LAUNCH_CWD__: launchCwd,
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: resolve(root, 'home-projects')
      },
      cwd: cliCwd,
      packageDir,
      options: {
        workspace
      },
      defaults: {
        allowCors: false,
        clientMode: 'none',
        entryKind: 'server',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws'
      }
    })
    expect(env.__ONEWORKS_PROJECT_LAUNCH_CWD__).toBe(launchCwd)

    await expect(runRuntimeEntry({ entryPath, env })).resolves.toBe(0)

    await expect(readFile(outputPath, 'utf8')).resolves.toBe(`${await realpath(launchCwd)}\n`)
  })

  it('bridges real-home entries without backfilling legacy mock files for runtime children', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-server-runtime-env-'))
    tempDirs.push(root)
    const workspace = resolve(root, 'workspace')
    const realHome = resolve(root, 'real-home')
    const packageDir = resolve(process.cwd(), 'apps/server')
    const entryPath = resolve(root, 'entry.js')

    await mkdir(resolve(workspace, '.oo', '.mock', '.codex'), { recursive: true })
    await mkdir(resolve(realHome, '.codex'), { recursive: true })
    await writeFile(resolve(workspace, '.oo', '.mock', '.codex', 'config.toml'), 'legacy = true\n', 'utf8')
    await writeFile(resolve(realHome, '.codex', 'config.toml'), 'real = true\n', 'utf8')
    await writeFile(entryPath, 'process.exit(0)\n', 'utf8')

    const env = applyServerRuntimeEnv({
      baseEnv: {
        HOME: realHome,
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: resolve(root, 'home-projects')
      },
      cwd: workspace,
      packageDir,
      options: {
        workspace
      },
      defaults: {
        allowCors: false,
        clientMode: 'none',
        entryKind: 'server',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws'
      }
    })

    await expect(runRuntimeEntry({ entryPath, env })).resolves.toBe(0)

    const bridgedConfigPath = resolve(env.HOME!, '.codex', 'config.toml')
    await expect(readFile(bridgedConfigPath, 'utf8')).resolves.toBe('real = true\n')
    expect((await lstat(bridgedConfigPath)).isSymbolicLink()).toBe(true)
  })

  it('migrates legacy default server data before starting runtime children', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-server-runtime-env-'))
    tempDirs.push(root)
    const workspace = resolve(root, 'workspace')
    const realHome = resolve(root, 'real-home')
    const packageDir = resolve(process.cwd(), 'apps/server')
    const entryPath = resolve(root, 'entry.js')

    await mkdir(resolve(workspace, '.data'), { recursive: true })
    await writeFile(resolve(workspace, '.data', 'web-auth-password'), 'legacy-password\n', 'utf8')
    await writeFile(entryPath, 'process.exit(0)\n', 'utf8')

    const env = applyServerRuntimeEnv({
      baseEnv: {
        HOME: realHome,
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: resolve(root, 'home-projects')
      },
      cwd: workspace,
      packageDir,
      options: {
        workspace
      },
      defaults: {
        allowCors: false,
        clientMode: 'none',
        entryKind: 'server',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws'
      }
    })

    await expect(runRuntimeEntry({ entryPath, env })).resolves.toBe(0)

    await expect(readFile(resolve(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__!, 'web-auth-password'), 'utf8'))
      .resolves.toBe('legacy-password\n')
  })
})
