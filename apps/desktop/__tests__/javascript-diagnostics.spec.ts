import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createJavaScriptErrorReport } from '@oneworks/diagnostics'
import type { DiagnosticEvent, DiagnosticExporter } from '@oneworks/diagnostics'
import { FileDiagnosticJournal } from '@oneworks/diagnostics/node'

import { createDesktopJavaScriptDiagnostics } from '../src/main/javascript-diagnostics'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(async directory => {
      await fs.rm(directory, { force: true, recursive: true })
    })
  )
})

describe('desktop JavaScript diagnostics', () => {
  it('journals renderer exceptions and gates OTLP dynamically', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-desktop-javascript-'))
    tempDirectories.push(directory)
    const remoteEvents: DiagnosticEvent[] = []
    const remoteExporter: DiagnosticExporter = {
      export: event => {
        remoteEvents.push(event)
      }
    }
    let enabled = false
    const diagnostics = createDesktopJavaScriptDiagnostics({
      directory,
      environment: 'test',
      getReportingEnabled: () => enabled,
      otlpExporter: remoteExporter,
      serviceVersion: '1.2.3'
    })
    const report = createJavaScriptErrorReport(new TypeError('private token'), {
      serviceVersion: '1.2.3',
      source: 'client.react_render',
      surface: 'desktop'
    })

    await expect(diagnostics.record(report)).resolves.toMatchObject({ reported: false })
    enabled = true
    await expect(diagnostics.record(report)).resolves.toMatchObject({ reported: true })

    const localEvents = new FileDiagnosticJournal({ directory }).readEvents()
    expect(localEvents).toHaveLength(6)
    expect(remoteEvents).toHaveLength(3)
    expect(localEvents.at(-1)?.operation.failure?.fingerprint).toBe(report.fingerprint)
    expect(JSON.stringify(localEvents)).not.toContain('private token')
  })

  it('rejects non-desktop reports at the IPC boundary', async () => {
    const localEvents: DiagnosticEvent[] = []
    const diagnostics = createDesktopJavaScriptDiagnostics({
      directory: '/unused',
      environment: 'test',
      getReportingEnabled: () => true,
      localExporter: {
        export: event => {
          localEvents.push(event)
        }
      },
      otlpExporter: false
    })
    const report = createJavaScriptErrorReport(new Error('private'), {
      source: 'client.window_error',
      surface: 'web'
    })

    await expect(diagnostics.record(report)).resolves.toEqual({ recordedLocally: false, reported: false })
    expect(localEvents).toEqual([])
  })
})
