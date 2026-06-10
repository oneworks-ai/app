import fs, { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeProcessEnvWithProjectEnv, resolveProjectHomePath } from '@oneworks/utils'

import { runClearCommand } from '#~/commands/clear.js'

const tempDirs: string[] = []

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'ow-clear-'))
  tempDirs.push(cwd)
  return cwd
}

const exists = async (target: string) => {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  delete process.env.__ONEWORKS_PROJECT_BASE_DIR__
  delete process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
  delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { force: true, recursive: true })))
})

describe('clear command', () => {
  it('clears logs and preserves claude-code-router config assets', async () => {
    const cwd = await createTempDir()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(cwd, '.oneworks-projects')
    const homeLogsDir = resolveProjectHomePath(cwd, process.env, 'logs')
    const homeCachesDir = resolveProjectHomePath(cwd, process.env, 'caches')
    const homeMockDir = resolveProjectHomePath(cwd, process.env, '.mock')

    await fs.mkdir(path.join(cwd, '.logs/sub'), { recursive: true })
    await fs.mkdir(homeLogsDir, { recursive: true })
    await fs.mkdir(homeCachesDir, { recursive: true })
    await fs.mkdir(path.join(cwd, '.oo/benchmarks/specs/demo/logs'), { recursive: true })
    await fs.mkdir(path.join(homeMockDir, '.claude/debug'), { recursive: true })
    await fs.mkdir(path.join(homeMockDir, '.claude-code-router/logs'), { recursive: true })
    await fs.mkdir(path.join(homeMockDir, '.claude-code-router/20260330-0000-01-./logs'), {
      recursive: true
    })
    await fs.mkdir(path.join(homeMockDir, '.claude-code-router/plugins'), { recursive: true })

    await fs.writeFile(path.join(cwd, '.logs/sub/task.log'), 'old log')
    await fs.writeFile(path.join(homeLogsDir, 'session.log'), 'session log')
    await fs.writeFile(path.join(homeCachesDir, 'cache.json'), '{"ok":true}')
    await fs.writeFile(path.join(cwd, '.oo/benchmarks/specs/demo/logs/run.log'), 'benchmark')
    await fs.writeFile(path.join(homeMockDir, '.claude/debug/debug.log'), 'debug')
    await fs.writeFile(path.join(homeMockDir, '.claude-code-router/logs/ccr-1.log'), 'router log')
    await fs.writeFile(path.join(homeMockDir, '.claude-code-router/claude-code-router.log'), 'root log')
    await fs.writeFile(path.join(homeMockDir, '.claude-code-router/.claude-code-router.pid'), '100')
    await fs.writeFile(path.join(homeMockDir, '.claude-code-router/config.json'), '{"router":true}')
    await fs.writeFile(path.join(homeMockDir, '.claude-code-router/plugins/plugin.js'), 'export {}')
    await fs.writeFile(
      path.join(homeMockDir, '.claude-code-router/20260330-0000-01-./logs/session.log'),
      'dated log'
    )

    await runClearCommand({ cwd })

    expect(await exists(path.join(cwd, '.logs'))).toBe(false)
    expect(await exists(path.join(homeLogsDir, 'session.log'))).toBe(false)
    expect(await exists(path.join(homeCachesDir, 'cache.json'))).toBe(false)
    expect(await exists(path.join(cwd, '.oo/benchmarks/specs/demo/logs'))).toBe(false)
    expect(await exists(path.join(homeMockDir, '.claude/debug'))).toBe(false)
    expect(await exists(path.join(homeMockDir, '.claude-code-router/logs'))).toBe(false)
    expect(await exists(path.join(homeMockDir, '.claude-code-router/claude-code-router.log'))).toBe(false)
    expect(await exists(path.join(homeMockDir, '.claude-code-router/20260330-0000-01-.'))).toBe(false)

    expect(await exists(path.join(homeLogsDir, '.gitkeep'))).toBe(true)
    expect(await exists(path.join(homeCachesDir, '.gitkeep'))).toBe(true)
    expect(await exists(path.join(homeMockDir, '.claude-code-router/.claude-code-router.pid'))).toBe(true)
    expect(await exists(path.join(homeMockDir, '.claude-code-router/config.json'))).toBe(true)
    expect(await exists(path.join(homeMockDir, '.claude-code-router/plugins/plugin.js'))).toBe(true)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Clear logs and cache successfully (.oo assets, '))
  })

  it('clears project-home files when the ai base dir is reconfigured', async () => {
    const cwd = await createTempDir()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = '.oneworks'
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(cwd, '.oneworks-projects')
    const homeLogsDir = resolveProjectHomePath(cwd, process.env, 'logs')
    const homeCachesDir = resolveProjectHomePath(cwd, process.env, 'caches')

    await fs.mkdir(path.join(cwd, '.oneworks/logs'), { recursive: true })
    await fs.mkdir(path.join(cwd, '.oneworks/caches'), { recursive: true })
    await fs.mkdir(homeLogsDir, { recursive: true })
    await fs.mkdir(homeCachesDir, { recursive: true })
    await fs.writeFile(path.join(cwd, '.oneworks/logs/session.log'), 'session log')
    await fs.writeFile(path.join(cwd, '.oneworks/caches/cache.json'), '{"ok":true}')
    await fs.writeFile(path.join(homeLogsDir, 'session.log'), 'session log')
    await fs.writeFile(path.join(homeCachesDir, 'cache.json'), '{"ok":true}')

    await runClearCommand({ cwd })

    expect(await exists(path.join(cwd, '.oneworks/logs/session.log'))).toBe(true)
    expect(await exists(path.join(cwd, '.oneworks/caches/cache.json'))).toBe(true)
    expect(await exists(path.join(homeLogsDir, 'session.log'))).toBe(false)
    expect(await exists(path.join(homeCachesDir, 'cache.json'))).toBe(false)
    expect(await exists(path.join(homeLogsDir, '.gitkeep'))).toBe(true)
    expect(await exists(path.join(homeCachesDir, '.gitkeep'))).toBe(true)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Clear logs and cache successfully (.oneworks assets, ')
    )
  })

  it('clears project-home runtime data for the primary workspace from a worktree', async () => {
    const primary = await createTempDir()
    const worktree = await createTempDir()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = worktree
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primary
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(worktree, '.oneworks-projects')
    const homeLogsDir = resolveProjectHomePath(primary, process.env, 'logs')
    const homeCachesDir = resolveProjectHomePath(primary, process.env, 'caches')
    const homeMockLogDir = resolveProjectHomePath(primary, process.env, '.mock/.claude-code-router/logs')
    const homeMockSessionDir = resolveProjectHomePath(
      primary,
      process.env,
      '.mock/.claude-code-router/20260330-0000-01-./logs'
    )

    await fs.mkdir(homeLogsDir, { recursive: true })
    await fs.mkdir(homeCachesDir, { recursive: true })
    await fs.mkdir(homeMockLogDir, { recursive: true })
    await fs.mkdir(homeMockSessionDir, { recursive: true })

    await fs.writeFile(path.join(homeLogsDir, 'home.log'), 'home log')
    await fs.writeFile(path.join(homeCachesDir, 'home.json'), '{"home":true}')
    await fs.writeFile(path.join(homeMockLogDir, 'router.log'), 'router log')
    await fs.writeFile(path.join(homeMockSessionDir, 'session.log'), 'session log')

    await runClearCommand({ cwd: worktree })

    expect(await exists(path.join(homeLogsDir, 'home.log'))).toBe(false)
    expect(await exists(path.join(homeCachesDir, 'home.json'))).toBe(false)
    expect(await exists(homeMockLogDir)).toBe(false)
    expect(await exists(path.dirname(homeMockSessionDir))).toBe(false)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Clear logs and cache successfully (.oo assets, '))
  })

  it('uses the requested cwd instead of an inherited exact project-home env', async () => {
    const workspaceA = await createTempDir()
    const workspaceB = await createTempDir()
    const projectsDir = await createTempDir()
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = projectsDir
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceA
    process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = 'workspace-a-home'
    const staleHome = resolveProjectHomePath(workspaceA, process.env)
    const targetEnv = mergeProcessEnvWithProjectEnv(undefined, { workspaceFolder: workspaceB })
    const targetHome = resolveProjectHomePath(workspaceB, targetEnv)

    await fs.mkdir(path.join(staleHome, 'logs'), { recursive: true })
    await fs.mkdir(path.join(targetHome, 'logs'), { recursive: true })
    await fs.writeFile(path.join(staleHome, 'logs/stale.log'), 'keep')
    await fs.writeFile(path.join(targetHome, 'logs/target.log'), 'clear')

    await runClearCommand({ cwd: workspaceB })

    expect(await exists(path.join(staleHome, 'logs/stale.log'))).toBe(true)
    expect(await exists(path.join(targetHome, 'logs/target.log'))).toBe(false)
    expect(await exists(path.join(targetHome, 'logs/.gitkeep'))).toBe(true)
  })
})
