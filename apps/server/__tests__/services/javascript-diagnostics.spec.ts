import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createJavaScriptErrorReport } from '@oneworks/diagnostics'
import type { DiagnosticEvent, DiagnosticExporter } from '@oneworks/diagnostics'
import { FileDiagnosticJournal } from '@oneworks/diagnostics/node'

import { createJavaScriptDiagnosticsRecorder } from '../../src/services/javascript-diagnostics.js'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(async directory => {
      await fs.rm(directory, { force: true, recursive: true })
    })
  )
})

describe('server JavaScript diagnostics', () => {
  it('always journals safe facts and only reports when the personal setting is enabled', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-js-diagnostics-'))
    tempDirectories.push(directory)
    const remoteEvents: DiagnosticEvent[] = []
    const remoteExporter: DiagnosticExporter = {
      export: event => {
        remoteEvents.push(event)
      }
    }
    let reportingEnabled = false
    const recorder = createJavaScriptDiagnosticsRecorder({
      directory,
      environment: 'test',
      getReportingEnabled: () => reportingEnabled,
      otlpExporter: remoteExporter
    })
    const error = new Error('secret prompt and token')
    error.stack = 'Error: secret prompt and token\n    at render (/Users/private/App.tsx:1:2)'
    const report = createJavaScriptErrorReport(error, {
      serviceVersion: '1.2.3',
      source: 'client.window_error',
      surface: 'web'
    })

    await expect(recorder.record(report)).resolves.toEqual({ recordedLocally: true, reported: false })
    reportingEnabled = true
    await expect(recorder.record(report)).resolves.toEqual({ recordedLocally: true, reported: true })

    const localEvents = new FileDiagnosticJournal({ directory }).readEvents()
    expect(localEvents).toHaveLength(6)
    expect(remoteEvents).toHaveLength(3)
    expect(localEvents.at(-1)?.operation.failure).toMatchObject({
      fingerprint: report.fingerprint,
      type: 'Error'
    })
    expect(JSON.stringify(localEvents)).not.toContain('secret prompt')
    expect(JSON.stringify(localEvents)).not.toContain('/Users/private')
  })

  it('rejects malformed reports before touching exporters', async () => {
    const localExporter = { export: vi.fn() }
    const recorder = createJavaScriptDiagnosticsRecorder({
      directory: '/unused',
      environment: 'test',
      localExporter,
      otlpExporter: false
    })

    await expect(recorder.record({ fingerprint: 'raw stack' })).resolves.toEqual({
      recordedLocally: false,
      reported: false
    })
    expect(localExporter.export).not.toHaveBeenCalled()
  })
})
