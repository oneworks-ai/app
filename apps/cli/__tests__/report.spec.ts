import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeProcessEnvWithProjectEnv, resolveProjectHomePath } from '@oneworks/utils'

import { collectReportTargets, resolveReportArchivePath, runReportCommand } from '#~/commands/report.js'

const tempDirs: string[] = []

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-report-'))
  tempDirs.push(cwd)
  return cwd
}

const useProjectHome = (cwd: string, projectsDir = path.join(cwd, '.oneworks-projects')) => {
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = projectsDir
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete process.env.__ONEWORKS_PROJECT_BASE_DIR__
  delete process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
  delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { force: true, recursive: true })))
})

describe('report command', () => {
  it('uses a timestamped tar.gz filename by default', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-20T03:04:05.000Z'))

    const cwd = await createTempDir()

    expect(resolveReportArchivePath(cwd)).toBe(path.join(cwd, 'report-20260320T030405Z.tar.gz'))
  })

  it('collects only existing report targets', async () => {
    const cwd = await createTempDir()
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)

    await fs.mkdir(path.join(homeDir, 'logs'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.claude'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.config/opencode/node_modules'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.oneworks'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.bun'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.mock/.claude.json.backup.1774599210661'), '{}')
    await fs.writeFile(path.join(homeDir, '.mock/ignored.json'), '{}')

    expect(await collectReportTargets(cwd)).toEqual([
      path.join(homeDir, 'logs'),
      path.join(homeDir, '.mock/.claude'),
      path.join(homeDir, '.mock/.config'),
      path.join(homeDir, '.mock/.oneworks'),
      path.join(homeDir, '.mock/.claude.json.backup.1774599210661')
    ])
  })

  it('uses the requested cwd instead of an inherited exact project-home env', async () => {
    const workspaceA = await createTempDir()
    const workspaceB = await createTempDir()
    const projectsDir = await createTempDir()
    useProjectHome(workspaceA, projectsDir)
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceA
    process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = 'workspace-a-home'
    const staleHome = resolveProjectHomePath(workspaceA, process.env)
    const targetEnv = mergeProcessEnvWithProjectEnv(undefined, { workspaceFolder: workspaceB })
    const targetHome = resolveProjectHomePath(workspaceB, targetEnv)

    await fs.mkdir(path.join(staleHome, 'logs'), { recursive: true })
    await fs.mkdir(path.join(targetHome, 'logs'), { recursive: true })
    await fs.writeFile(path.join(staleHome, 'logs/stale.log'), 'stale')
    await fs.writeFile(path.join(targetHome, 'logs/target.log'), 'target')

    expect(await collectReportTargets(workspaceB)).toEqual([
      path.join(targetHome, 'logs')
    ])
  })

  it('creates an archive containing logs, caches and selected mock data', async () => {
    const cwd = await createTempDir()
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await fs.mkdir(path.join(homeDir, 'logs'), { recursive: true })
    await fs.mkdir(path.join(homeDir, 'caches'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.claude'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.config/opencode/plugins'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.config/opencode/node_modules/pkg'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.codex'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.oneworks'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.bun'), { recursive: true })

    await fs.writeFile(path.join(homeDir, 'logs/session.log'), 'log data')
    await fs.writeFile(path.join(homeDir, 'caches/task.json'), '{"ok":true}')
    await fs.writeFile(path.join(homeDir, '.mock/.claude/settings.json'), '{"mock":true}')
    await fs.writeFile(path.join(homeDir, '.mock/.config/opencode/plugins/oneworks-hooks.js'), 'export {}')
    await fs.writeFile(path.join(homeDir, '.mock/.config/opencode/node_modules/pkg/index.js'), 'module.exports = {}')
    await fs.writeFile(path.join(homeDir, '.mock/.codex/hooks.json'), '{"hook":true}')
    await fs.writeFile(path.join(homeDir, '.mock/.oneworks/state.json'), '{"state":true}')
    await fs.writeFile(path.join(homeDir, '.mock/.claude.json.backup.1774599210661'), '{"backup":true}')
    await fs.writeFile(path.join(homeDir, '.mock/.bun/install.log'), 'skip me')

    const result = await runReportCommand({ cwd, filename: 'bundle' })

    expect(result).not.toBeNull()
    expect(result?.archivePath).toBe(path.join(cwd, 'bundle.tar.gz'))

    const archiveListing = execFileSync('tar', ['-tzf', result!.archivePath], {
      encoding: 'utf-8'
    })

    expect(archiveListing).toContain('logs/session.log')
    expect(archiveListing).toContain('caches/task.json')
    expect(archiveListing).toContain('.mock/.claude/settings.json')
    expect(archiveListing).toContain('.mock/.config/opencode/plugins/oneworks-hooks.js')
    expect(archiveListing).toContain('.mock/.codex/hooks.json')
    expect(archiveListing).toContain('.mock/.oneworks/state.json')
    expect(archiveListing).toContain('.mock/.claude.json.backup.1774599210661')
    expect(archiveListing).not.toContain('.mock/.bun/install.log')
    expect(archiveListing).not.toContain('.mock/.config/opencode/node_modules/pkg/index.js')
    expect(logSpy).toHaveBeenCalledWith(`Report archive created: ${result!.archivePath}`)
  })

  it('creates an archive when the project home lives outside the workspace', async () => {
    const cwd = await createTempDir()
    const projectsDir = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-report-home-'))
    tempDirs.push(projectsDir)
    useProjectHome(cwd, projectsDir)
    const homeDir = resolveProjectHomePath(cwd, process.env)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await fs.mkdir(path.join(homeDir, 'logs'), { recursive: true })
    await fs.mkdir(path.join(homeDir, 'caches'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.codex'), { recursive: true })
    await fs.writeFile(path.join(homeDir, 'logs/session.log'), 'log data')
    await fs.writeFile(path.join(homeDir, 'caches/task.json'), '{"ok":true}')
    await fs.writeFile(path.join(homeDir, '.mock/.codex/config.json'), '{"mock":true}')

    const result = await runReportCommand({ cwd, filename: 'outside-home' })

    expect(result).not.toBeNull()
    expect(result?.sources.every(source => source.startsWith(homeDir))).toBe(true)
    expect(result?.archivePath).toBe(path.join(cwd, 'outside-home.tar.gz'))

    const archiveListing = execFileSync('tar', ['-tzf', result!.archivePath], {
      encoding: 'utf-8'
    })

    expect(archiveListing).toContain('logs/session.log')
    expect(archiveListing).toContain('caches/task.json')
    expect(archiveListing).toContain('.mock/.codex/config.json')
    await expect(fs.access(path.join(cwd, '.oo/logs'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(logSpy).toHaveBeenCalledWith(`Report archive created: ${result!.archivePath}`)
  })

  it('includes logger payload files referenced by prefixed log symlinks', async () => {
    const cwd = await createTempDir()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)
    const payloadStoreDir = path.join(homeDir, 'caches/.logger-payloads/sha256/ab/cd')
    const payloadRefDir = path.join(homeDir, 'logs/server/task-1/session-1.payloads')
    const payloadStorePath = path.join(payloadStoreDir, 'abcd.json')
    const payloadRefPath = path.join(payloadRefDir, 'stdout.json')

    await fs.mkdir(payloadStoreDir, { recursive: true })
    await fs.mkdir(payloadRefDir, { recursive: true })
    await fs.writeFile(path.join(homeDir, 'logs/server/task-1/session-1.log.md'), 'payload: stdout.json')
    await fs.writeFile(payloadStorePath, '"large stdout"')
    await fs.symlink(path.relative(payloadRefDir, payloadStorePath), payloadRefPath)

    expect(await collectReportTargets(cwd)).toEqual([
      path.join(homeDir, 'logs'),
      path.join(homeDir, 'caches')
    ])

    const result = await runReportCommand({ cwd, filename: 'bundle-payloads' })

    expect(result).not.toBeNull()

    const archiveListing = execFileSync('tar', ['-tzf', result!.archivePath], {
      encoding: 'utf-8'
    })

    expect(archiveListing).toContain('caches/.logger-payloads/sha256/ab/cd/abcd.json')
    expect(logSpy).toHaveBeenCalledWith(`Report archive created: ${result!.archivePath}`)
  })

  it('does not include arbitrary symlink targets from the log tree', async () => {
    const cwd = await createTempDir()
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)
    const logDir = path.join(homeDir, 'logs/task-1/session-1.payloads')
    const externalTarget = path.join(cwd, 'private-token.txt')

    await fs.mkdir(logDir, { recursive: true })
    await fs.writeFile(path.join(homeDir, 'logs/task-1/session-1.log.md'), 'payload: private.json')
    await fs.writeFile(externalTarget, 'do not archive')
    await fs.symlink(path.relative(logDir, externalTarget), path.join(logDir, 'private.json'))

    expect(await collectReportTargets(cwd)).toEqual([
      path.join(homeDir, 'logs')
    ])
  })

  it('omits mock-home symlinks that would expose real home paths in the archive', async () => {
    const cwd = await createTempDir()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)
    const externalTarget = path.join(cwd, 'real-home-secret.json')

    await fs.mkdir(path.join(homeDir, '.mock/.config'), { recursive: true })
    await fs.writeFile(externalTarget, '{"secret":true}')
    await fs.symlink(externalTarget, path.join(homeDir, '.mock/.config/real-home-secret.json'))

    const result = await runReportCommand({ cwd, filename: 'mock-symlink' })

    expect(result).not.toBeNull()
    const archiveListing = execFileSync('tar', ['-tzf', result!.archivePath], {
      encoding: 'utf-8'
    })
    const verboseListing = execFileSync('tar', ['-tvzf', result!.archivePath], {
      encoding: 'utf-8'
    })

    expect(archiveListing).not.toContain('.mock/.config/real-home-secret.json')
    expect(verboseListing).not.toContain(externalTarget)
    expect(logSpy).toHaveBeenCalledWith(`Report archive created: ${result!.archivePath}`)
  })

  it('returns null when no report targets exist', async () => {
    const cwd = await createTempDir()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await runReportCommand({ cwd })

    expect(result).toBeNull()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No reportable files found under .oo assets or '))
  })

  it('rejects archive paths inside included directories', async () => {
    const cwd = await createTempDir()
    useProjectHome(cwd)
    const homeLogsDir = resolveProjectHomePath(cwd, process.env, 'logs')

    await fs.mkdir(homeLogsDir, { recursive: true })

    await expect(runReportCommand({
      cwd,
      filename: path.join(homeLogsDir, 'report')
    })).rejects.toThrow(homeLogsDir)
  })

  it('packages files from the env-configured ai base dir', async () => {
    const cwd = await createTempDir()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = '.oneworks'
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)

    await fs.mkdir(path.join(homeDir, 'logs'), { recursive: true })
    await fs.mkdir(path.join(homeDir, 'caches'), { recursive: true })
    await fs.writeFile(path.join(homeDir, 'logs/session.log'), 'log data')
    await fs.writeFile(path.join(homeDir, 'caches/task.json'), '{"ok":true}')

    const result = await runReportCommand({ cwd, filename: 'bundle-oneworks' })

    expect(result).not.toBeNull()

    const archiveListing = execFileSync('tar', ['-tzf', result!.archivePath], {
      encoding: 'utf-8'
    })

    expect(archiveListing).toContain('logs/session.log')
    expect(archiveListing).toContain('caches/task.json')
    expect(logSpy).toHaveBeenCalledWith(`Report archive created: ${result!.archivePath}`)
  })

  it('does not backfill old default .oo report data when the project asset dir is reconfigured', async () => {
    const cwd = await createTempDir()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = '.oneworks'
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)

    await fs.mkdir(path.join(cwd, '.oo/logs'), { recursive: true })
    await fs.writeFile(path.join(cwd, '.oo/logs/legacy.log'), 'legacy log')

    const result = await runReportCommand({ cwd, filename: 'legacy-default-ai' })

    expect(result).toBeNull()
    await expect(fs.readFile(path.join(homeDir, 'logs/legacy.log'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(fs.readFile(path.join(cwd, '.oo/logs/legacy.log'), 'utf8')).resolves.toBe('legacy log')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No reportable files found'))
  })
})
