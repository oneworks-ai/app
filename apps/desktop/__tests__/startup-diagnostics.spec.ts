import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
    const events = new FileDiagnosticJournal({ directory }).readEvents()
    expect(events.map(event => event.kind)).toEqual([
      'operation.started',
      'operation.stage',
      'operation.stage',
      'operation.ready',
      'operation.completed'
    ])
    expect(events.find(event => event.kind === 'operation.ready')?.operation.durationMs).toBe(1_250)
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
