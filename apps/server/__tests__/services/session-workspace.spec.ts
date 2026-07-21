/* eslint-disable max-lines -- workspace git fixture coverage is intentionally consolidated */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WSEvent } from '@oneworks/core'
import type { SessionCreationProgressEvent } from '@oneworks/types'

import { SqliteDb, getDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'

vi.mock('#~/db/index.js', async () => {
  const actual = await vi.importActual<typeof import('#~/db/index.js')>('#~/db/index.js')
  return {
    ...actual,
    getDb: vi.fn()
  }
})

const runGit = (cwd: string, args: string[]) => {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe'
  })
}

const resolveExpectedManagedWorktreePath = (primaryWorkspaceRoot: string, workspaceRoot: string, sessionId: string) => (
  path.join(
    primaryWorkspaceRoot,
    '.oo',
    'worktrees',
    'sessions',
    sessionId,
    path.basename(workspaceRoot)
  )
)

const getPlatformScriptSuffix = () => {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'linux') return 'linux'
  if (process.platform === 'win32') return 'windows'
  return undefined
}

const getPlatformScriptFileName = (operation: 'create' | 'start' | 'destroy') => {
  const platformSuffix = getPlatformScriptSuffix()
  if (platformSuffix == null) return undefined
  return platformSuffix === 'windows'
    ? `${operation}.windows.ps1`
    : `${operation}.${platformSuffix}.sh`
}

const getBaseScriptFileName = (operation: 'create' | 'start' | 'destroy') => (
  process.platform === 'win32' ? `${operation}.ps1` : `${operation}.sh`
)

const buildScriptContent = (shellContent: string, powershellContent: string) => (
  process.platform === 'win32' ? powershellContent : shellContent
)

describe('session workspace service', () => {
  let db: SqliteDb
  let workspaceRoot: string
  let primaryWorkspaceRoot: string
  let previousWorkspaceEnv: string | undefined
  let previousPrimaryWorkspaceEnv: string | undefined

  beforeEach(async () => {
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(getDb).mockReturnValue(db)

    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-session-workspace-'))
    primaryWorkspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-session-workspace-primary-'))
    previousWorkspaceEnv = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    previousPrimaryWorkspaceEnv = process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceRoot
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primaryWorkspaceRoot

    runGit(workspaceRoot, ['init'])
    runGit(workspaceRoot, ['config', 'user.email', 'ow@example.com'])
    runGit(workspaceRoot, ['config', 'user.name', 'One Works'])
    await writeFile(path.join(workspaceRoot, 'README.md'), '# demo\n', 'utf8')
    runGit(workspaceRoot, ['add', 'README.md'])
    runGit(workspaceRoot, ['commit', '-m', 'init'])
    runGit(workspaceRoot, ['branch', '-M', 'main'])
  })

  afterEach(async () => {
    vi.doUnmock('node:fs/promises')
    vi.doUnmock('node:process')
    vi.doUnmock('#~/services/safe-regular-file-update.js')
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = previousWorkspaceEnv
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = previousPrimaryWorkspaceEnv
    db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(primaryWorkspaceRoot, { recursive: true, force: true })
  })

  it('provisions a managed worktree for a new session in a git workspace', async () => {
    const { provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    db.createSession('Demo', 'sess-1')

    const workspace = await provisionSessionWorkspace('sess-1')
    const expectedWorktreePath = resolveExpectedManagedWorktreePath(primaryWorkspaceRoot, workspaceRoot, 'sess-1')
    const currentBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: workspace.workspaceFolder,
      encoding: 'utf8'
    }).trim()

    expect(workspace).toMatchObject({
      sessionId: 'sess-1',
      kind: 'managed_worktree',
      workspaceFolder: expectedWorktreePath,
      repositoryRoot: expectedWorktreePath,
      worktreePath: expectedWorktreePath,
      baseRef: 'main',
      cleanupPolicy: 'delete_on_session_delete',
      state: 'ready'
    })
    expect(currentBranch).toBe('main-session-sess-1')
  })

  it('recovers legacy session cwd as an external workspace without creating a new worktree', async () => {
    const { resolveSessionWorkspace } = await import('#~/services/session/workspace.js')
    const session = db.createSession('Legacy', 'sess-legacy')
    const legacyDir = path.join(workspaceRoot, 'packages', 'app')
    await mkdir(legacyDir, { recursive: true })
    const legacyInitEvent: WSEvent = {
      type: 'session_info',
      info: {
        type: 'init',
        uuid: session.id,
        cwd: legacyDir,
        model: 'gpt-4o',
        version: 'test',
        adapter: 'codex',
        tools: [],
        slashCommands: [],
        agents: []
      }
    }
    db.saveMessage(session.id, legacyInitEvent)

    const workspace = await resolveSessionWorkspace(session.id)

    expect(workspace).toMatchObject({
      sessionId: session.id,
      kind: 'external_workspace',
      workspaceFolder: legacyDir,
      cleanupPolicy: 'retain',
      state: 'ready'
    })
    expect(workspace.repositoryRoot).toBeTruthy()
    expect(workspace.repositoryRoot).toContain(path.basename(workspaceRoot))
  })

  it('creates a managed worktree for an existing shared-workspace session', async () => {
    const {
      createSessionManagedWorktree,
      provisionSessionWorkspace
    } = await import('#~/services/session/workspace.js')
    db.createSession('Shared', 'sess-shared')

    const sharedWorkspace = await provisionSessionWorkspace('sess-shared', {
      createWorktree: false
    })
    expect(sharedWorkspace.kind).toBe('shared_workspace')

    const managedWorkspace = await createSessionManagedWorktree('sess-shared')
    const expectedWorktreePath = resolveExpectedManagedWorktreePath(primaryWorkspaceRoot, workspaceRoot, 'sess-shared')

    expect(managedWorkspace).toMatchObject({
      sessionId: 'sess-shared',
      kind: 'managed_worktree',
      workspaceFolder: expectedWorktreePath,
      worktreePath: expectedWorktreePath,
      cleanupPolicy: 'delete_on_session_delete',
      state: 'ready'
    })
  })

  it('does not attach a worktree environment to an explicitly shared workspace', async () => {
    const { provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    db.createSession('Shared Env', 'sess-shared-env')

    const workspace = await provisionSessionWorkspace('sess-shared-env', {
      createWorktree: false,
      worktreeEnvironment: 'env-local-only'
    })

    expect(workspace).toMatchObject({
      sessionId: 'sess-shared-env',
      kind: 'shared_workspace',
      workspaceFolder: workspaceRoot,
      cleanupPolicy: 'retain',
      state: 'ready'
    })
    expect(workspace.worktreeEnvironment).toBeUndefined()
  })

  it('does not fall back to a shared workspace when managed worktree creation is explicitly requested', async () => {
    const { provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    const nonGitRoot = path.join(primaryWorkspaceRoot, 'not-git')
    await mkdir(nonGitRoot, { recursive: true })
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = nonGitRoot
    db.createSession('Explicit Non Git', 'sess-explicit-non-git')

    await expect(
      provisionSessionWorkspace('sess-explicit-non-git', {
        createWorktree: true
      })
    ).rejects.toThrow()
    expect(db.getSessionWorkspace('sess-explicit-non-git')).toBeUndefined()
  })

  it('runs configured worktree environment create scripts after creating a managed worktree', async () => {
    const { provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    db.createSession('Env', 'sess-env')
    const progress: SessionCreationProgressEvent[] = []

    await writeFile(
      path.join(workspaceRoot, '.oo.config.json'),
      `${JSON.stringify({ conversation: { worktreeEnvironment: 'env-test' } }, null, 2)}\n`,
      'utf8'
    )
    const environmentDir = path.join(primaryWorkspaceRoot, '.oo', 'env', 'env-test')
    await mkdir(environmentDir, { recursive: true })
    await writeFile(
      path.join(environmentDir, getBaseScriptFileName('create')),
      buildScriptContent(
        'printf "base:%s:%s:%s\\n" "$ONEWORKS_SESSION_ID" "$ONEWORKS_WORKTREE_OPERATION" "$ONEWORKS_WORKTREE_SOURCE_PATH" > env-create.log\n',
        'Set-Content -Path env-create.log -Value "base:$($env:ONEWORKS_SESSION_ID):$($env:ONEWORKS_WORKTREE_OPERATION):$($env:ONEWORKS_WORKTREE_SOURCE_PATH)"\n'
      ),
      'utf8'
    )
    const platformScriptFileName = getPlatformScriptFileName('create')
    if (platformScriptFileName != null) {
      await writeFile(
        path.join(environmentDir, platformScriptFileName),
        buildScriptContent(
          'printf "platform:%s\\n" "$ONEWORKS_WORKTREE_OPERATION" >> env-create.log\n',
          'Add-Content -Path env-create.log -Value "platform:$($env:ONEWORKS_WORKTREE_OPERATION)"\n'
        ),
        'utf8'
      )
    }

    const workspace = await provisionSessionWorkspace('sess-env', {
      onProgress: (event) => {
        progress.push(event)
      }
    })
    const log = await readFile(path.join(workspace.workspaceFolder, 'env-create.log'), 'utf8')

    if (platformScriptFileName != null) {
      expect(log.trim()).toBe('platform:create')
      expect(log).not.toContain('base:')
    } else {
      expect(log).toContain(`base:sess-env:create:${workspaceRoot}`)
    }
    expect(progress.some(event => event.step === 'worktree_creating' && event.status === 'running')).toBe(true)
    expect(progress.some(event => event.step === 'environment_script_running')).toBe(true)
    expect(progress.some(event => event.step === 'environment_script_succeeded')).toBe(true)
    expect(progress.at(-1)).toMatchObject({
      step: 'workspace_ready',
      status: 'success'
    })
  })

  it('streams configured worktree environment script stdout and stderr progress', async () => {
    const { runConfiguredWorktreeEnvironmentScripts } = await import('#~/services/worktree-environments.js')
    const environmentDir = path.join(primaryWorkspaceRoot, '.oo', 'env', 'env-output')
    await mkdir(environmentDir, { recursive: true })
    await writeFile(
      path.join(environmentDir, getBaseScriptFileName('create')),
      buildScriptContent(
        'printf "out-one\\n"\nprintf "err-one\\n" >&2\n',
        'Write-Output "out-one"\n[Console]::Error.WriteLine("err-one")\n'
      ),
      'utf8'
    )
    const progress: Array<{
      status: string
      stream?: string
      output?: string
      scriptFileName?: string
    }> = []

    const results = await runConfiguredWorktreeEnvironmentScripts({
      operation: 'create',
      workspaceFolder: workspaceRoot,
      environmentId: 'env-output',
      onProgress: (event) => {
        progress.push(event)
      }
    })
    const stdout = progress.filter(event => event.stream === 'stdout').map(event => event.output ?? '').join('')
    const stderr = progress.filter(event => event.stream === 'stderr').map(event => event.output ?? '').join('')
    const runningIndex = progress.findIndex(event =>
      event.status === 'running' && event.scriptFileName === getBaseScriptFileName('create')
    )
    const stdoutIndex = progress.findIndex(event => event.stream === 'stdout')
    const stderrIndex = progress.findIndex(event => event.stream === 'stderr')
    const successIndex = progress.findIndex(event => event.status === 'success')

    expect(results[0]?.stdout).toContain('out-one')
    expect(results[0]?.stderr).toContain('err-one')
    expect(stdout).toContain('out-one')
    expect(stderr).toContain('err-one')
    expect(stdoutIndex).toBeGreaterThan(runningIndex)
    expect(stderrIndex).toBeGreaterThan(runningIndex)
    expect(successIndex).toBeGreaterThan(stdoutIndex)
    expect(successIndex).toBeGreaterThan(stderrIndex)
  })

  it('uses workspace project environment scripts when the primary checkout does not have them', async () => {
    const { provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    db.createSession('Workspace Env', 'sess-workspace-env')

    await writeFile(
      path.join(workspaceRoot, '.oo.config.json'),
      `${JSON.stringify({ conversation: { worktreeEnvironment: 'default' } }, null, 2)}\n`,
      'utf8'
    )
    const environmentDir = path.join(workspaceRoot, '.oo', 'env', 'default')
    await mkdir(environmentDir, { recursive: true })
    await writeFile(
      path.join(environmentDir, getBaseScriptFileName('create')),
      buildScriptContent(
        'printf "workspace:%s\\n" "$ONEWORKS_WORKTREE_ENV" > workspace-env.log\n',
        'Set-Content -Path workspace-env.log -Value "workspace:$($env:ONEWORKS_WORKTREE_ENV)"\n'
      ),
      'utf8'
    )

    const workspace = await provisionSessionWorkspace('sess-workspace-env')
    const log = await readFile(path.join(workspace.workspaceFolder, 'workspace-env.log'), 'utf8')

    expect(log.trim()).toBe('workspace:default')
  })

  it('saves windows-specific worktree environment scripts as PowerShell files', async () => {
    const {
      getWorktreeEnvironment,
      saveWorktreeEnvironment
    } = await import('#~/services/worktree-environments.js')

    await saveWorktreeEnvironment('env-windows', {
      scripts: {
        'create.windows': 'Write-Output "create windows"',
        'start.windows': 'Write-Output "start windows"',
        'destroy.windows': 'Write-Output "destroy windows"'
      }
    })
    const environment = await getWorktreeEnvironment('env-windows')
    const createScript = environment.scripts.find(script => script.key === 'create.windows')

    expect(createScript).toMatchObject({
      platform: 'windows',
      fileName: 'create.windows.ps1',
      exists: true,
      content: 'Write-Output "create windows"\n'
    })
    await expect(
      readFile(path.join(primaryWorkspaceRoot, '.oo', 'env', 'env-windows', 'start.windows.ps1'), 'utf8')
    ).resolves.toBe('Write-Output "start windows"\n')
  })

  it('creates imported worktree environments only when the target id is absent', async () => {
    const {
      createWorktreeEnvironmentIfAbsent,
      getWorktreeEnvironment
    } = await import('#~/services/worktree-environments.js')

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'native-env',
      scripts: { create: 'printf "original\\n"' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).resolves.toMatchObject({ created: true, environmentId: 'native-env' })
    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'native-env',
      scripts: { create: 'printf "overwritten\\n"' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).resolves.toMatchObject({ created: false, environmentId: 'native-env' })

    const environment = await getWorktreeEnvironment('native-env', workspaceRoot, 'project')
    expect(environment.scripts.find(script => script.key === 'create')?.content).toBe('printf "original\\n"\n')
  })

  it('allows only one concurrent imported environment writer to claim an id', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const results = await Promise.all([
      createWorktreeEnvironmentIfAbsent({
        id: 'native-race',
        scripts: { create: 'printf "first\\n"' },
        source: 'project',
        workspaceFolder: workspaceRoot
      }),
      createWorktreeEnvironmentIfAbsent({
        id: 'native-race',
        scripts: { create: 'printf "second\\n"' },
        source: 'project',
        workspaceFolder: workspaceRoot
      })
    ])

    expect(results.filter(result => result.created)).toHaveLength(1)
    expect(results.filter(result => !result.created)).toHaveLength(1)
  })

  it('never publishes a partially written imported environment', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const scripts = { create: 'printf "secret\\n"' } as Record<string, string>
    Object.defineProperty(scripts, 'start', {
      enumerable: true,
      get: () => {
        throw new Error('simulated adapter failure')
      }
    })

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'native-partial',
      scripts,
      source: 'project',
      workspaceFolder: workspaceRoot
    })).rejects.toThrow('simulated adapter failure')

    const environmentRoot = path.join(primaryWorkspaceRoot, '.oo', 'env')
    const entries = await readdir(environmentRoot)
    expect(entries).not.toContain('native-partial')
    expect(entries.some(entry => entry.startsWith('.import-native-partial-'))).toBe(false)
  })

  it('keeps a live publishing sentinel when an unverified final directory cannot be cleaned', async () => {
    const environmentRoot = path.join(primaryWorkspaceRoot, '.oo', 'env')
    const environmentDirectory = path.join(environmentRoot, 'native-unverified-target')
    const sentinelPath = path.join(environmentRoot, '.oneworks-import-publishing-native-unverified-target')
    let injectedTargetIdentityFailure = false
    vi.doMock('#~/services/safe-regular-file-update.js', async () => {
      const actual = await vi.importActual<typeof import('#~/services/safe-regular-file-update.js')>(
        '#~/services/safe-regular-file-update.js'
      )
      return {
        ...actual,
        captureVerifiedDirectoryIdentity: async (directory: string) => {
          if (directory === environmentDirectory && !injectedTargetIdentityFailure) {
            injectedTargetIdentityFailure = true
            throw new Error('simulated target identity failure')
          }
          return actual.captureVerifiedDirectoryIdentity(directory)
        }
      }
    })
    const {
      createWorktreeEnvironmentIfAbsent,
      listWorktreeEnvironments
    } = await import('#~/services/worktree-environments.js')

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'native-unverified-target',
      scripts: { create: 'printf "hidden\\n"' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).rejects.toThrow('simulated target identity failure')

    expect(injectedTargetIdentityFailure).toBe(true)
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBeTruthy()
    await expect(readdir(environmentDirectory)).resolves.toEqual([])
    await expect(listWorktreeEnvironments(workspaceRoot)).resolves.not.toEqual(expect.objectContaining({
      environments: expect.arrayContaining([
        expect.objectContaining({ id: 'native-unverified-target' })
      ])
    }))

    vi.doUnmock('#~/services/safe-regular-file-update.js')
    vi.resetModules()
    const { createWorktreeEnvironmentIfAbsent: retryImport } = await import('#~/services/worktree-environments.js')
    await expect(retryImport({
      id: 'native-unverified-target',
      scripts: { create: 'printf "recovered\\n"' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).resolves.toMatchObject({ created: true, environmentId: 'native-unverified-target' })
    await expect(readFile(sentinelPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers a crash between claiming and marking the final import directory', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const environmentRoot = path.join(primaryWorkspaceRoot, '.oo', 'env')
    await mkdir(path.join(environmentRoot, 'native-stale-claim'), { recursive: true })
    await writeFile(
      path.join(environmentRoot, '.oneworks-import-publishing-native-stale-claim'),
      'stale-token\n',
      'utf8'
    )

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'native-stale-claim',
      scripts: { create: 'printf "recovered\\n"' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).resolves.toMatchObject({ created: true, environmentId: 'native-stale-claim' })
    await expect(readFile(
      path.join(environmentRoot, 'native-stale-claim', 'create.sh'),
      'utf8'
    )).resolves.toBe('printf "recovered\\n"\n')
  })

  it('keeps the publishing sentinel visible until a stale final directory is removed', async () => {
    const environmentRoot = path.join(primaryWorkspaceRoot, '.oo', 'env')
    const environmentDirectory = path.join(environmentRoot, 'native-stale-order')
    const sentinelPath = path.join(environmentRoot, '.oneworks-import-publishing-native-stale-order')
    await mkdir(environmentDirectory, { recursive: true })
    await writeFile(sentinelPath, 'stale-token\n', 'utf8')

    let sentinelExistedDuringTargetRemoval = false
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        rm: async (...args: Parameters<typeof actual.rm>) => {
          if (String(args[0]) === environmentDirectory) {
            sentinelExistedDuringTargetRemoval = await actual.lstat(sentinelPath).then(
              () => true,
              () => false
            )
          }
          return actual.rm(...args)
        }
      }
    })
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'native-stale-order',
      scripts: { create: 'printf "recovered\\n"' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).resolves.toMatchObject({ created: true, environmentId: 'native-stale-order' })

    expect(sentinelExistedDuringTargetRemoval).toBe(true)
    await expect(readFile(sentinelPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects non-directory and symlink placeholders for an imported id', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const environmentRoot = path.join(primaryWorkspaceRoot, '.oo', 'env')
    const outsideDirectory = path.join(workspaceRoot, 'outside-environment')
    await Promise.all([
      mkdir(environmentRoot, { recursive: true }),
      mkdir(outsideDirectory)
    ])
    await writeFile(path.join(environmentRoot, 'occupied-file'), 'do-not-replace\n', 'utf8')
    await symlink(outsideDirectory, path.join(environmentRoot, 'occupied-link'), 'dir')

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'occupied-file',
      scripts: { create: 'unsafe' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).rejects.toThrow('Unsafe existing worktree environment path')
    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'occupied-link',
      scripts: { create: 'unsafe' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).rejects.toThrow('Unsafe existing worktree environment path')
    await expect(readFile(path.join(environmentRoot, 'occupied-file'), 'utf8')).resolves.toBe('do-not-replace\n')
    expect(await readdir(outsideDirectory)).toEqual([])
  })

  it('canonicalizes the local presentation suffix for both environment sources', async () => {
    const { normalizeWorktreeEnvironmentIdForSource } = await import('#~/services/worktree-environments.js')

    expect(normalizeWorktreeEnvironmentIdForSource('node.local', 'project')).toBe('node')
    expect(normalizeWorktreeEnvironmentIdForSource('node.LOCAL', 'user')).toBe('node')
    expect(() => normalizeWorktreeEnvironmentIdForSource('node.local.local', 'project')).toThrow(
      'Invalid worktree environment id'
    )
  })

  it('rejects an imported environment when the configured .oo directory is a symlink', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const escapedRoot = path.join(workspaceRoot, 'escaped-oo')
    await mkdir(escapedRoot)
    await symlink(escapedRoot, path.join(primaryWorkspaceRoot, '.oo'), 'dir')

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'unsafe-root',
      scripts: { create: 'secret-script' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).rejects.toThrow('Unsafe worktree environment directory')
    await expect(readFile(path.join(escapedRoot, 'env', 'unsafe-root', 'create.sh'), 'utf8')).rejects.toThrow()
  })

  it('rejects an imported environment when its environment root is a symlink', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const ooDirectory = path.join(primaryWorkspaceRoot, '.oo')
    const escapedRoot = path.join(workspaceRoot, 'escaped-env')
    await mkdir(ooDirectory)
    await mkdir(escapedRoot)
    await symlink(escapedRoot, path.join(ooDirectory, 'env'), 'dir')

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'unsafe-environment-root',
      scripts: { create: 'secret-script' },
      source: 'project',
      workspaceFolder: workspaceRoot
    })).rejects.toThrow('Unsafe worktree environment directory')
    await expect(readFile(path.join(escapedRoot, 'unsafe-environment-root', 'create.sh'), 'utf8')).rejects.toThrow()
  })

  it('never follows a symlinked gitignore while importing a user environment', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const outsideGitignore = path.join(workspaceRoot, 'outside.gitignore')
    const originalContent = 'keep-this-content\n'
    await writeFile(outsideGitignore, originalContent, 'utf8')
    await symlink(outsideGitignore, path.join(primaryWorkspaceRoot, '.gitignore'))

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'unsafe-gitignore',
      scripts: { create: 'secret-script' },
      source: 'user',
      workspaceFolder: workspaceRoot
    })).rejects.toThrow()
    await expect(readFile(outsideGitignore, 'utf8')).resolves.toBe(originalContent)
    await expect(readFile(
      path.join(primaryWorkspaceRoot, '.oo', 'env.local', 'unsafe-gitignore', 'create.sh'),
      'utf8'
    )).rejects.toThrow()
  })

  it('repairs the ignore rule before accepting an existing user environment', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const environmentDirectory = path.join(primaryWorkspaceRoot, '.oo', 'env.local', 'existing-user')
    await mkdir(environmentDirectory, { recursive: true })
    await writeFile(path.join(environmentDirectory, 'create.sh'), 'existing\n', 'utf8')

    await expect(createWorktreeEnvironmentIfAbsent({
      id: 'existing-user',
      scripts: { create: 'should-not-replace' },
      source: 'user',
      workspaceFolder: workspaceRoot
    })).resolves.toMatchObject({ created: false, environmentId: 'existing-user' })

    const gitignore = await readFile(path.join(primaryWorkspaceRoot, '.gitignore'), 'utf8')
    expect(gitignore.split(/\r?\n/)).toContain('.oo/env.local/')
    await expect(readFile(path.join(environmentDirectory, 'create.sh'), 'utf8')).resolves.toBe('existing\n')
  })

  it('escapes a custom in-repository environment root in gitignore', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const previousBaseDir = process.env.__ONEWORKS_PROJECT_BASE_DIR__
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = path.join(primaryWorkspaceRoot, 'custom[base] ?')
    try {
      await createWorktreeEnvironmentIfAbsent({
        id: 'escaped-ignore',
        scripts: { create: 'safe' },
        source: 'user',
        workspaceFolder: workspaceRoot
      })
      const gitignore = await readFile(path.join(primaryWorkspaceRoot, '.gitignore'), 'utf8')
      expect(gitignore.split(/\r?\n/)).toContain('custom\\[base\\]\\ \\?/env.local/')
    } finally {
      if (previousBaseDir == null) delete process.env.__ONEWORKS_PROJECT_BASE_DIR__
      else process.env.__ONEWORKS_PROJECT_BASE_DIR__ = previousBaseDir
    }
  })

  it('does not add an incorrect ignore rule for an environment root outside the repository', async () => {
    const { createWorktreeEnvironmentIfAbsent } = await import('#~/services/worktree-environments.js')
    const previousBaseDir = process.env.__ONEWORKS_PROJECT_BASE_DIR__
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = path.join(workspaceRoot, 'external-oo')
    await writeFile(path.join(primaryWorkspaceRoot, '.gitignore'), 'keep\n', 'utf8')
    try {
      await createWorktreeEnvironmentIfAbsent({
        id: 'external-ignore',
        scripts: { create: 'safe' },
        source: 'user',
        workspaceFolder: workspaceRoot
      })
      await expect(readFile(path.join(primaryWorkspaceRoot, '.gitignore'), 'utf8')).resolves.toBe('keep\n')
    } finally {
      if (previousBaseDir == null) delete process.env.__ONEWORKS_PROJECT_BASE_DIR__
      else process.env.__ONEWORKS_PROJECT_BASE_DIR__ = previousBaseDir
    }
  })

  it('lists uppercase legacy local suffixes consistently as user environments', async () => {
    const { listWorktreeEnvironments } = await import('#~/services/worktree-environments.js')
    const environmentDirectory = path.join(primaryWorkspaceRoot, '.oo', 'env', 'legacy-node.LOCAL')
    await mkdir(environmentDirectory, { recursive: true })
    await writeFile(path.join(environmentDirectory, 'create.sh'), 'legacy\n', 'utf8')

    const result = await listWorktreeEnvironments(workspaceRoot)

    expect(result.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'legacy-node',
        isLocal: true,
        source: 'user'
      })
    ]))
  })

  it('does not run shell base scripts as Windows worktree environment defaults', async () => {
    vi.doMock('node:process', async () => {
      const actual = await vi.importActual<typeof import('node:process')>('node:process')
      return {
        ...actual,
        platform: 'win32'
      }
    })
    const { runConfiguredWorktreeEnvironmentScripts } = await import('#~/services/worktree-environments.js')
    const environmentDir = path.join(primaryWorkspaceRoot, '.oo', 'env', 'env-windows-default')
    await mkdir(environmentDir, { recursive: true })
    await writeFile(path.join(environmentDir, 'create.sh'), 'exit 42\n', 'utf8')

    await expect(
      runConfiguredWorktreeEnvironmentScripts({
        operation: 'create',
        workspaceFolder: workspaceRoot,
        environmentId: 'env-windows-default'
      })
    ).resolves.toEqual([])
  })

  it('marks local worktree environments as user config and ignores them from git', async () => {
    const {
      getWorktreeEnvironment,
      saveWorktreeEnvironment
    } = await import('#~/services/worktree-environments.js')

    await saveWorktreeEnvironment(
      'env-private',
      {
        scripts: {
          create: 'printf "private\\n"'
        }
      },
      undefined,
      'user'
    )
    const environment = await getWorktreeEnvironment('env-private', undefined, 'user')
    const gitignore = await readFile(path.join(primaryWorkspaceRoot, '.gitignore'), 'utf8')

    expect(environment).toMatchObject({
      id: 'env-private',
      path: path.join(primaryWorkspaceRoot, '.oo', 'env.local', 'env-private'),
      source: 'user',
      isLocal: true
    })
    expect(gitignore.split(/\r?\n/)).toContain('.oo/env.local/')
  })

  it('uses an explicitly selected worktree environment when creating a managed worktree', async () => {
    const { provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    db.createSession('Explicit Env', 'sess-explicit-env')

    const environmentDir = path.join(primaryWorkspaceRoot, '.oo', 'env', 'env-explicit')
    await mkdir(environmentDir, { recursive: true })
    await writeFile(
      path.join(environmentDir, getBaseScriptFileName('create')),
      buildScriptContent(
        'printf "%s\\n" "$ONEWORKS_WORKTREE_ENV" > explicit-env.log\n',
        'Set-Content -Path explicit-env.log -Value "$($env:ONEWORKS_WORKTREE_ENV)"\n'
      ),
      'utf8'
    )

    const workspace = await provisionSessionWorkspace('sess-explicit-env', {
      worktreeEnvironment: 'env-explicit'
    })
    const log = await readFile(path.join(workspace.workspaceFolder, 'explicit-env.log'), 'utf8')

    expect(workspace.worktreeEnvironment).toBe('env-explicit')
    expect(log.trim()).toBe('env-explicit')
  })

  it('runs configured destroy scripts when create scripts fail after creating a managed worktree', async () => {
    const { provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    db.createSession('Create Fail Cleanup Env', 'sess-create-fail-cleanup')

    const environmentDir = path.join(primaryWorkspaceRoot, '.oo', 'env', 'env-create-fail-cleanup')
    const markerPath = path.join(primaryWorkspaceRoot, 'create-fail-destroy.log')
    await mkdir(environmentDir, { recursive: true })
    await writeFile(
      path.join(environmentDir, getBaseScriptFileName('create')),
      buildScriptContent(
        'printf "created\\n" > create-resource.log\nexit 17\n',
        'Set-Content -Path create-resource.log -Value "created"\nexit 17\n'
      ),
      'utf8'
    )
    await writeFile(
      path.join(environmentDir, getBaseScriptFileName('destroy')),
      buildScriptContent(
        `printf "%s:%s\\n" "$ONEWORKS_WORKTREE_PATH" "$ONEWORKS_WORKTREE_FORCE" > "${markerPath}"\n`,
        `Set-Content -Path "${markerPath}" -Value "$($env:ONEWORKS_WORKTREE_PATH):$($env:ONEWORKS_WORKTREE_FORCE)"\n`
      ),
      'utf8'
    )

    await expect(
      provisionSessionWorkspace('sess-create-fail-cleanup', {
        worktreeEnvironment: 'env-create-fail-cleanup'
      })
    ).rejects.toThrow('Worktree environment script failed')
    await expect(readFile(markerPath, 'utf8')).resolves.toBe(
      `${resolveExpectedManagedWorktreePath(primaryWorkspaceRoot, workspaceRoot, 'sess-create-fail-cleanup')}:true\n`
    )
  })

  it('runs configured worktree environment destroy scripts before removing a managed worktree', async () => {
    const { deleteSessionWorkspace, provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    db.createSession('Destroy Env', 'sess-destroy-env')

    await writeFile(
      path.join(workspaceRoot, '.oo.config.json'),
      `${JSON.stringify({ conversation: { worktreeEnvironment: 'env-destroy' } }, null, 2)}\n`,
      'utf8'
    )
    const environmentDir = path.join(primaryWorkspaceRoot, '.oo', 'env', 'env-destroy')
    const markerPath = path.join(primaryWorkspaceRoot, 'destroy.log')
    await mkdir(environmentDir, { recursive: true })
    await writeFile(
      path.join(environmentDir, getBaseScriptFileName('destroy')),
      buildScriptContent(
        `printf "%s:%s\\n" "$ONEWORKS_WORKTREE_PATH" "$ONEWORKS_WORKTREE_FORCE" > "${markerPath}"\n`,
        `Set-Content -Path "${markerPath}" -Value "$($env:ONEWORKS_WORKTREE_PATH):$($env:ONEWORKS_WORKTREE_FORCE)"\n`
      ),
      'utf8'
    )
    const platformScriptFileName = getPlatformScriptFileName('destroy')
    if (platformScriptFileName != null) {
      await writeFile(
        path.join(environmentDir, platformScriptFileName),
        buildScriptContent(
          `printf "platform:%s\n" "$ONEWORKS_WORKTREE_FORCE" > "${markerPath}"\n`,
          `Set-Content -Path "${markerPath}" -Value "platform:$($env:ONEWORKS_WORKTREE_FORCE)"\n`
        ),
        'utf8'
      )
    }

    const workspace = await provisionSessionWorkspace('sess-destroy-env')
    await deleteSessionWorkspace('sess-destroy-env', { force: true })
    const log = await readFile(markerPath, 'utf8')

    expect(log.trim()).toBe(
      platformScriptFileName == null ? `${workspace.worktreePath}:true` : 'platform:true'
    )
  })

  it('runs configured worktree environment start scripts for a workspace', async () => {
    const { runConfiguredWorktreeEnvironmentScripts } = await import('#~/services/worktree-environments.js')

    await writeFile(
      path.join(workspaceRoot, '.oo.config.json'),
      `${JSON.stringify({ conversation: { worktreeEnvironment: 'env-start' } }, null, 2)}\n`,
      'utf8'
    )
    const environmentDir = path.join(primaryWorkspaceRoot, '.oo', 'env', 'env-start')
    const markerPath = path.join(workspaceRoot, 'start.log')
    await mkdir(environmentDir, { recursive: true })
    await writeFile(
      path.join(environmentDir, getBaseScriptFileName('start')),
      buildScriptContent(
        `printf "%s:%s\\n" "$ONEWORKS_SESSION_ID" "$ONEWORKS_WORKTREE_OPERATION" > "${markerPath}"\n`,
        `Set-Content -Path "${markerPath}" -Value "$($env:ONEWORKS_SESSION_ID):$($env:ONEWORKS_WORKTREE_OPERATION)"\n`
      ),
      'utf8'
    )

    await runConfiguredWorktreeEnvironmentScripts({
      operation: 'start',
      workspaceFolder: workspaceRoot,
      sessionId: 'sess-start'
    })

    expect((await readFile(markerPath, 'utf8')).trim()).toBe('sess-start:start')
  })

  it('keeps the repo root directory name as the final segment when forking from an existing managed worktree', async () => {
    const { provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    db.createSession('Parent', 'sess-parent')
    db.createSession('Child', 'sess-child')

    const parentWorkspace = await provisionSessionWorkspace('sess-parent')
    const childWorkspace = await provisionSessionWorkspace('sess-child', {
      sourceSessionId: 'sess-parent'
    })

    expect(path.basename(parentWorkspace.workspaceFolder)).toBe(path.basename(workspaceRoot))
    expect(path.basename(childWorkspace.workspaceFolder)).toBe(path.basename(workspaceRoot))
    expect(childWorkspace.workspaceFolder).toBe(
      resolveExpectedManagedWorktreePath(primaryWorkspaceRoot, workspaceRoot, 'sess-child')
    )
  })

  it('transfers a managed worktree to a retained local workspace without deleting files', async () => {
    const {
      provisionSessionWorkspace,
      transferSessionWorkspaceToLocal
    } = await import('#~/services/session/workspace.js')
    db.createSession('Managed', 'sess-local')

    const managedWorkspace = await provisionSessionWorkspace('sess-local')
    const transferredWorkspace = await transferSessionWorkspaceToLocal('sess-local')

    expect(transferredWorkspace).toMatchObject({
      sessionId: 'sess-local',
      kind: 'external_workspace',
      workspaceFolder: managedWorkspace.workspaceFolder,
      worktreePath: managedWorkspace.worktreePath,
      cleanupPolicy: 'retain',
      state: 'ready'
    })
  })

  it('refuses to delete a dirty managed worktree unless forced', async () => {
    const { deleteSessionWorkspace, provisionSessionWorkspace } = await import('#~/services/session/workspace.js')
    db.createSession('Dirty', 'sess-dirty')
    const workspace = await provisionSessionWorkspace('sess-dirty')

    await writeFile(path.join(workspace.workspaceFolder, 'dirty.txt'), 'dirty\n', 'utf8')

    await expect(deleteSessionWorkspace('sess-dirty')).rejects.toMatchObject({
      code: 'session_worktree_not_clean'
    })
  })
})
