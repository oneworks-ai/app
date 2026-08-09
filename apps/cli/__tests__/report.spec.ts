import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDiagnosticClient, createJavaScriptErrorReport, recordJavaScriptError } from '@oneworks/diagnostics'
import { FileDiagnosticJournal } from '@oneworks/diagnostics/node'
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

const readBundleFromArchive = async (archivePath: string, cwd: string) => {
  const extractDirectory = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-report-extract-'))
  tempDirs.push(extractDirectory)
  execFileSync('tar', ['-xzf', archivePath, '-C', extractDirectory])
  return JSON.parse(await fs.readFile(path.join(extractDirectory, 'support-bundle.json'), 'utf8')) as {
    events: Array<{
      context: Record<string, string>
      operation: { failure?: { fingerprint?: string }; id: string }
    }>
    privacy: { rawLogsIncluded: boolean }
    summary: { eventCount: number }
  }
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

  it('retains the legacy target inspector without using those targets in support bundles', async () => {
    const cwd = await createTempDir()
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)

    await fs.mkdir(path.join(homeDir, 'logs'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.claude'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.config/opencode/node_modules'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.oneworks'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.mock/.claude.json.backup.1774599210661'), '{}')

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

    expect(await collectReportTargets(workspaceB)).toEqual([
      path.join(targetHome, 'logs')
    ])
  })

  it('archives only a privacy-safe diagnostic bundle and pseudonymizes identifiers', async () => {
    const cwd = await createTempDir()
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)
    const diagnosticDirectory = path.join(homeDir, 'diagnostics/cli')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const journal = new FileDiagnosticJournal({ directory: diagnosticDirectory })
    const client = createDiagnosticClient({
      context: { userId: 'raw-user-id' },
      exporters: [journal],
      resource: { serviceName: 'oneworks-cli', surface: 'cli' }
    })
    client.startOperation('oneworks.cli.command').succeed()
    const javascriptJournal = new FileDiagnosticJournal({
      directory: path.join(homeDir, 'diagnostics/server-javascript')
    })
    const javascriptClient = createDiagnosticClient({
      exporters: [javascriptJournal],
      resource: { serviceName: 'oneworks-client', surface: 'web' }
    })
    const rawError = new Error('secret prompt and token')
    rawError.stack = 'Error: secret prompt and token\n    at render (/Users/private/App.tsx:1:2)'
    const javascriptReport = createJavaScriptErrorReport(rawError, {
      source: 'client.window_error',
      surface: 'web'
    })
    recordJavaScriptError(javascriptClient, javascriptReport)

    await fs.mkdir(path.join(homeDir, 'logs'), { recursive: true })
    await fs.mkdir(path.join(homeDir, '.mock/.codex'), { recursive: true })
    await fs.writeFile(path.join(homeDir, 'logs/session.log'), 'secret prompt and token')
    await fs.writeFile(path.join(homeDir, '.mock/.codex/auth.json'), '{"token":"secret"}')

    const result = await runReportCommand({ cwd, filename: 'bundle' })
    const archiveListing = execFileSync('tar', ['-tzf', result.archivePath], { encoding: 'utf-8' })
    const bundle = await readBundleFromArchive(result.archivePath, cwd)

    expect(archiveListing.trim()).toBe('support-bundle.json')
    expect(bundle.summary.eventCount).toBeGreaterThan(0)
    expect(bundle.events[0]?.context.userId).not.toBe('raw-user-id')
    expect(bundle.events.some(event => (
      event.operation.failure?.fingerprint === javascriptReport.fingerprint
    ))).toBe(true)
    expect(bundle.privacy.rawLogsIncluded).toBe(false)
    expect(JSON.stringify(bundle)).not.toContain('secret prompt')
    expect(JSON.stringify(bundle)).not.toContain('/Users/private')
    expect(logSpy).toHaveBeenCalledWith(
      `Privacy-safe diagnostic support bundle created: ${result.archivePath}`
    )
  })

  it('creates an empty support bundle when no diagnostic events exist', async () => {
    const cwd = await createTempDir()
    useProjectHome(cwd)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await runReportCommand({ cwd, filename: 'empty' })
    const bundle = await readBundleFromArchive(result.archivePath, cwd)

    expect(bundle.summary.eventCount).toBe(0)
    expect(result.sources).toEqual([
      resolveProjectHomePath(cwd, process.env, 'diagnostics', 'cli'),
      resolveProjectHomePath(cwd, process.env, 'diagnostics', 'server-javascript')
    ])
    expect(logSpy).toHaveBeenCalledWith(
      `Privacy-safe diagnostic support bundle created: ${result.archivePath}`
    )
  })

  it('does not backfill or archive old default .oo data when the asset dir is reconfigured', async () => {
    const cwd = await createTempDir()
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = '.oneworks'
    useProjectHome(cwd)
    const homeDir = resolveProjectHomePath(cwd, process.env)

    await fs.mkdir(path.join(cwd, '.oo/logs'), { recursive: true })
    await fs.writeFile(path.join(cwd, '.oo/logs/legacy.log'), 'legacy log')

    const result = await runReportCommand({ cwd, filename: 'legacy-default-ai' })
    const archiveListing = execFileSync('tar', ['-tzf', result.archivePath], { encoding: 'utf-8' })

    expect(archiveListing).not.toContain('legacy.log')
    await expect(fs.readFile(path.join(homeDir, 'logs/legacy.log'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(fs.readFile(path.join(cwd, '.oo/logs/legacy.log'), 'utf8')).resolves.toBe('legacy log')
  })
})
