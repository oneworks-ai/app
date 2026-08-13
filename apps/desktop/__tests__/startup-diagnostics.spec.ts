import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DiagnosticEvent } from '@oneworks/diagnostics'
import { FileDiagnosticJournal } from '@oneworks/diagnostics/node'

import { createDesktopStartupDiagnostics, readDesktopDiagnosticReportingEnabled } from '../src/main/startup-diagnostics'

const tempDirs: string[] = []

const createTempDir = async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-desktop-startup-'))
  tempDirs.push(directory)
  return directory
}

const createIds = () => {
  let index = 0
  return () => `id-${++index}`
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  await Promise.all(tempDirs.splice(0).map(directory => fs.rm(directory, { force: true, recursive: true })))
})

describe('desktop startup diagnostics', () => {
  it('reads the global system diagnostic reporting preference', async () => {
    const home = await createTempDir()
    await fs.mkdir(path.join(home, '.oneworks'), { recursive: true })
    await fs.writeFile(
      path.join(home, '.oneworks', '.oo.config.json'),
      JSON.stringify({
        diagnostics: { reporting: { enabled: false } }
      })
    )
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', home)

    expect(readDesktopDiagnosticReportingEnabled()).toBe(false)
  })

  it('becomes successful only after the renderer is ready and remains stable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'))
    const directory = await createTempDir()
    const diagnostics = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      now: () => new Date(Date.now()),
      otlpExporter: false,
      stableDelayMs: 30_000
    })

    diagnostics.stage('electron.ready')
    vi.advanceTimersByTime(1_250)
    diagnostics.ready()

    expect(diagnostics.getSnapshot()).toMatchObject({
      name: 'oneworks.app.startup',
      readyAt: '2026-08-09T00:00:01.250Z',
      stage: 'renderer.interactive'
    })
    expect(diagnostics.getSnapshot().outcome).toBeUndefined()

    vi.advanceTimersByTime(30_000)

    expect(diagnostics.getSnapshot()).toMatchObject({
      durationMs: 31250,
      outcome: 'success'
    })
    const events = new FileDiagnosticJournal({ directory })
      .readEvents()
      .filter(event => event.operation.name === 'oneworks.app.startup')
    expect(events.map(event => event.kind)).toEqual([
      'operation.started',
      'operation.stage',
      'operation.stage',
      'operation.ready',
      'operation.completed'
    ])
    expect(events.find(event => event.kind === 'operation.ready')?.operation.durationMs).toBe(1_250)
  })

  it('keeps first-action diagnostics alive after startup becomes stable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'))
    const directory = await createTempDir()
    const diagnostics = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      now: () => new Date(Date.now()),
      otlpExporter: false,
      stableDelayMs: 30_000
    })

    diagnostics.ready()
    vi.advanceTimersByTime(30_000)
    expect(diagnostics.getSnapshot().outcome).toBe('success')
    expect(diagnostics.getFirstActionSnapshot()).toBeUndefined()
    expect(new FileDiagnosticJournal({ directory }).readEvents())
      .not.toContainEqual(expect.objectContaining({
        operation: expect.objectContaining({ name: 'oneworks.app.first_action' })
      }))

    vi.advanceTimersByTime(15_000)
    diagnostics.markFirstActionMilestone('submit.accepted', 'renderer-a')
    diagnostics.markFirstActionMilestone('first.submit', 'renderer-a')
    vi.advanceTimersByTime(100)
    diagnostics.markFirstActionMilestone('submit.accepted', 'renderer-a')
    diagnostics.markFirstActionMilestone('submit.accepted', 'renderer-a')
    vi.advanceTimersByTime(300)
    diagnostics.markFirstActionMilestone('first.success', 'renderer-a')
    expect(diagnostics.getFirstActionSnapshot()?.outcome).toBe('success')
    vi.advanceTimersByTime(400)
    diagnostics.markFirstActionMilestone('first.response.received', 'renderer-a')

    expect(diagnostics.getFirstActionSnapshot()).toMatchObject({
      durationMs: 400,
      name: 'oneworks.app.first_action',
      outcome: 'success',
      stage: 'first.success'
    })

    const firstActionEvents = new FileDiagnosticJournal({ directory })
      .readEvents()
      .filter(event => event.operation.name === 'oneworks.app.first_action')
    expect(firstActionEvents.map(event => [event.kind, event.operation.stage])).toEqual([
      ['operation.started', undefined],
      ['operation.stage', 'first.submit'],
      ['operation.stage', 'submit.accepted'],
      ['operation.stage', 'first.success'],
      ['operation.completed', 'first.success']
    ])
  })

  it('keeps the app first action bound to the first submitting workspace window', async () => {
    const directory = await createTempDir()
    const diagnostics = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      otlpExporter: false
    })

    diagnostics.markFirstActionMilestone('first.submit', 'renderer-a')
    diagnostics.markFirstActionMilestone('submit.accepted', 'renderer-a')
    diagnostics.markFirstActionMilestone('first.submit', 'renderer-b')
    diagnostics.markFirstActionMilestone('submit.accepted', 'renderer-b')
    diagnostics.markFirstActionMilestone('first.response.received', 'renderer-b')
    diagnostics.markFirstActionMilestone('first.success', 'renderer-b')
    expect(diagnostics.getFirstActionSnapshot()?.outcome).toBeUndefined()

    diagnostics.markFirstActionMilestone('first.success', 'renderer-a')
    expect(diagnostics.getFirstActionSnapshot()?.outcome).toBe('success')
  })

  it('does not let a lost or late HTTP acknowledgement postpone observed success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'))
    const directory = await createTempDir()
    const diagnostics = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      now: () => new Date(Date.now()),
      otlpExporter: false
    })

    diagnostics.markFirstActionMilestone('first.submit', 'renderer-a:1:document-a')
    vi.advanceTimersByTime(100)
    diagnostics.markFirstActionMilestone('first.success', 'renderer-a:1:document-a')
    expect(diagnostics.getFirstActionSnapshot()).toMatchObject({
      durationMs: 100,
      outcome: 'success',
      stage: 'first.success'
    })

    vi.advanceTimersByTime(200)
    diagnostics.markFirstActionMilestone('submit.accepted', 'renderer-a:1:document-a')
    expect(diagnostics.getFirstActionSnapshot()).toMatchObject({
      durationMs: 100,
      outcome: 'success'
    })

    const events = new FileDiagnosticJournal({ directory })
      .readEvents()
      .filter(event => event.operation.name === 'oneworks.app.first_action')
    expect(events.map(event => [event.kind, event.operation.stage, event.timestamp])).toEqual([
      ['operation.started', undefined, '2026-08-09T00:00:00.000Z'],
      ['operation.stage', 'first.submit', '2026-08-09T00:00:00.000Z'],
      ['operation.stage', 'first.success', '2026-08-09T00:00:00.100Z'],
      ['operation.completed', 'first.success', '2026-08-09T00:00:00.100Z']
    ])
  })

  it('settles failed and user-terminated first actions without reporting success', async () => {
    const failedDirectory = await createTempDir()
    const failed = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory: failedDirectory,
      environment: 'test',
      otlpExporter: false
    })
    failed.markFirstActionMilestone('first.submit', 'renderer-failed')
    failed.markFirstActionMilestone('first.failed', 'renderer-failed')
    expect(failed.getFirstActionSnapshot()).toMatchObject({
      failure: { code: 'app.first_action_failed', domain: 'provider' },
      outcome: 'error',
      stage: 'first.failed'
    })

    const terminatedDirectory = await createTempDir()
    const terminated = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory: terminatedDirectory,
      environment: 'test',
      otlpExporter: false
    })
    terminated.markFirstActionMilestone('first.submit', 'renderer-terminated')
    terminated.markFirstActionMilestone('first.terminated', 'renderer-terminated')
    expect(terminated.getFirstActionSnapshot()).toMatchObject({
      failure: { code: 'app.first_action_terminated', domain: 'process' },
      outcome: 'cancelled',
      stage: 'first.terminated'
    })
  })

  it('does not splice milestones from a reloaded renderer document into the first action', async () => {
    const directory = await createTempDir()
    const diagnostics = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      otlpExporter: false
    })

    diagnostics.markFirstActionMilestone('first.submit', 'web-1:process-1:document-a')
    diagnostics.markFirstActionMilestone('submit.accepted', 'web-1:process-1:document-a')
    diagnostics.markFirstActionMilestone('first.submit', 'web-1:process-1:document-b')
    diagnostics.markFirstActionMilestone('first.success', 'web-1:process-1:document-b')

    expect(diagnostics.getFirstActionSnapshot()?.outcome).toBeUndefined()
  })

  it('does not create first-action diagnostics when the app quits before any submit', async () => {
    const directory = await createTempDir()
    const diagnostics = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      otlpExporter: false
    })

    diagnostics.cancel()

    expect(diagnostics.getSnapshot()).toMatchObject({
      failure: { code: 'app.quit_before_startup_stable' },
      outcome: 'cancelled'
    })
    expect(diagnostics.getFirstActionSnapshot()).toBeUndefined()
    expect(new FileDiagnosticJournal({ directory }).readEvents())
      .not.toContainEqual(expect.objectContaining({
        operation: expect.objectContaining({ name: 'oneworks.app.first_action' })
      }))
  })

  it('cancels an unfinished first-action operation on app quit', async () => {
    const directory = await createTempDir()
    const diagnostics = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      otlpExporter: false
    })

    diagnostics.markFirstActionMilestone('first.submit', 'renderer-a')
    diagnostics.cancel()

    expect(diagnostics.getFirstActionSnapshot()).toMatchObject({
      failure: { code: 'app.quit_before_first_action_success' },
      outcome: 'cancelled'
    })
  })

  it('replays a recovered first-action terminal fact to remote diagnostics', async () => {
    const directory = await createTempDir()
    const interrupted = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      otlpExporter: false
    })
    interrupted.markFirstActionMilestone('first.submit', 'renderer-a')

    const remotelyExported: DiagnosticEvent[] = []
    const recovered = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      otlpExporter: {
        export: event => {
          remotelyExported.push(event)
        }
      }
    })
    await recovered.flush()

    expect(remotelyExported).toContainEqual(expect.objectContaining({
      kind: 'operation.completed',
      operation: expect.objectContaining({
        failure: expect.objectContaining({ code: 'process.terminated_before_completion' }),
        name: 'oneworks.app.first_action',
        outcome: 'abandoned'
      })
    }))
  })

  it('records a classified degraded outcome without raw error details', async () => {
    const directory = await createTempDir()
    const diagnostics = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      otlpExporter: false
    })

    diagnostics.degrade(new Error('workspace=/private/example token=secret'), {
      code: 'workspace.server_startup_failed',
      domain: 'server',
      retryable: true
    })

    const journal = new FileDiagnosticJournal({ directory })
    const events = journal.readEvents()
    expect(events.at(-1)?.operation).toMatchObject({
      failure: {
        code: 'workspace.server_startup_failed',
        domain: 'server',
        retryable: true,
        type: 'Error'
      },
      outcome: 'degraded'
    })
    expect(JSON.stringify(events)).not.toContain('/private/example')
    expect(JSON.stringify(events)).not.toContain('token=secret')
  })

  it('marks startup as timed out when no renderer becomes interactive', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'))
    const directory = await createTempDir()
    const diagnostics = createDesktopStartupDiagnostics({
      createId: createIds(),
      directory,
      environment: 'test',
      now: () => new Date(Date.now()),
      otlpExporter: false,
      readyTimeoutMs: 5_000
    })

    diagnostics.stage('server.ready')
    vi.advanceTimersByTime(5_000)

    expect(diagnostics.getSnapshot()).toMatchObject({
      durationMs: 5000,
      failure: {
        code: 'desktop.startup_ready_timeout',
        domain: 'process',
        retryable: true
      },
      outcome: 'timeout',
      stage: 'server.ready'
    })
  })
})
