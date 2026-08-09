import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { createDiagnosticClient, parseJavaScriptErrorReport, recordJavaScriptError } from '@oneworks/diagnostics'
import type { DiagnosticEnvironment, DiagnosticExporter } from '@oneworks/diagnostics'
import { FileDiagnosticJournal, createOtlpHttpDiagnosticExporterFromEnv } from '@oneworks/diagnostics/node'

export interface DesktopJavaScriptDiagnosticsOptions {
  architecture?: string
  createId?: () => string
  directory: string
  environment: DiagnosticEnvironment
  getReportingEnabled: () => boolean
  localExporter?: DiagnosticExporter
  now?: () => Date
  otlpExporter?: DiagnosticExporter | false
  platform?: string
  serviceVersion?: string
}

export const createDesktopJavaScriptDiagnostics = (
  options: DesktopJavaScriptDiagnosticsOptions
) => {
  const localExporter = options.localExporter ?? new FileDiagnosticJournal({ directory: options.directory })
  const otlpExporter = options.otlpExporter === false
    ? undefined
    : options.otlpExporter ?? createOtlpHttpDiagnosticExporterFromEnv({
      onError: error => {
        const name = error instanceof Error ? error.name : 'UnknownError'
        console.warn(`[oneworks-desktop] JavaScript diagnostic export failed (${name})`)
      }
    })
  const createClient = (exporter: DiagnosticExporter) =>
    createDiagnosticClient({
      createId: options.createId ?? randomUUID,
      exporters: [exporter],
      now: options.now,
      resource: {
        architecture: options.architecture ?? process.arch,
        environment: options.environment,
        platform: options.platform ?? process.platform,
        serviceName: 'oneworks-desktop',
        serviceVersion: options.serviceVersion,
        surface: 'desktop'
      }
    })
  const localClient = createClient(localExporter)
  const remoteClient = otlpExporter == null ? undefined : createClient(otlpExporter)

  return {
    flush: async () => {
      await Promise.all([localClient.flush(), remoteClient?.flush()])
    },
    record: async (rawReport: unknown) => {
      const report = parseJavaScriptErrorReport(rawReport)
      if (report == null || report.surface !== 'desktop') {
        return { recordedLocally: false, reported: false }
      }

      recordJavaScriptError(localClient, report)
      await localClient.flush()
      if (!options.getReportingEnabled() || remoteClient == null) {
        return { recordedLocally: true, reported: false }
      }

      recordJavaScriptError(remoteClient, report)
      await remoteClient.flush()
      return { recordedLocally: true, reported: true }
    }
  }
}
