import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { createDiagnosticClient, parseJavaScriptErrorReport, recordJavaScriptError } from '@oneworks/diagnostics'
import type {
  DiagnosticClient,
  DiagnosticEnvironment,
  DiagnosticExporter,
  JavaScriptErrorReport
} from '@oneworks/diagnostics'
import { FileDiagnosticJournal, createOtlpHttpDiagnosticExporterFromEnv } from '@oneworks/diagnostics/node'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { loadConfigState } from '#~/services/config/index.js'

export interface JavaScriptDiagnosticsRecorderOptions {
  createId?: () => string
  directory: string
  environment: DiagnosticEnvironment
  getReportingEnabled?: () => Promise<boolean> | boolean
  localExporter?: DiagnosticExporter
  now?: () => Date
  otlpExporter?: DiagnosticExporter | false
  platform?: string
}

export interface JavaScriptDiagnosticsRecordResult {
  recordedLocally: boolean
  reported: boolean
}

const clientKey = (report: JavaScriptErrorReport) => `${report.surface}:${report.serviceVersion ?? ''}`

export const readServerDiagnosticReportingEnabled = async () => {
  try {
    const state = await loadConfigState()
    const reporting = state.globalSource?.resolvedConfig?.diagnostics?.reporting
    return typeof reporting === 'boolean' ? reporting : reporting?.enabled !== false
  } catch {
    return true
  }
}

export const createJavaScriptDiagnosticsRecorder = (
  options: JavaScriptDiagnosticsRecorderOptions
) => {
  const localExporter = options.localExporter ?? new FileDiagnosticJournal({ directory: options.directory })
  const otlpExporter = options.otlpExporter === false
    ? undefined
    : options.otlpExporter ?? createOtlpHttpDiagnosticExporterFromEnv({
      onError: error => {
        const name = error instanceof Error ? error.name : 'UnknownError'
        console.warn(`[javascript-diagnostics] OTLP export failed (${name})`)
      }
    })
  const localClients = new Map<string, DiagnosticClient>()
  const remoteClients = new Map<string, DiagnosticClient>()
  const createClient = (report: JavaScriptErrorReport, exporter: DiagnosticExporter) =>
    createDiagnosticClient({
      createId: options.createId ?? randomUUID,
      exporters: [exporter],
      now: options.now,
      resource: {
        architecture: process.arch,
        environment: options.environment,
        platform: options.platform ?? process.platform,
        serviceName: 'oneworks-client',
        serviceVersion: report.serviceVersion,
        surface: report.surface
      }
    })
  const getClient = (
    clients: Map<string, DiagnosticClient>,
    report: JavaScriptErrorReport,
    exporter: DiagnosticExporter
  ) => {
    const key = clientKey(report)
    const existing = clients.get(key)
    if (existing != null) return existing
    const client = createClient(report, exporter)
    clients.set(key, client)
    return client
  }

  return {
    flush: async () => {
      await Promise.all([
        ...[...localClients.values()].map(async client => await client.flush()),
        ...[...remoteClients.values()].map(async client => await client.flush())
      ])
    },
    record: async (rawReport: unknown): Promise<JavaScriptDiagnosticsRecordResult> => {
      const report = parseJavaScriptErrorReport(rawReport)
      if (report == null) return { recordedLocally: false, reported: false }

      const localClient = getClient(localClients, report, localExporter)
      recordJavaScriptError(localClient, report)
      await localClient.flush()

      const reportingEnabled = await (options.getReportingEnabled?.() ?? true)
      if (!reportingEnabled || otlpExporter == null) {
        return { recordedLocally: true, reported: false }
      }

      const remoteClient = getClient(remoteClients, report, otlpExporter)
      recordJavaScriptError(remoteClient, report)
      await remoteClient.flush()
      return { recordedLocally: true, reported: true }
    }
  }
}

let defaultRecorder: ReturnType<typeof createJavaScriptDiagnosticsRecorder> | undefined

const getDefaultRecorder = () => {
  defaultRecorder ??= createJavaScriptDiagnosticsRecorder({
    directory: resolveProjectHomePath(process.cwd(), process.env, 'diagnostics', 'server-javascript'),
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    getReportingEnabled: readServerDiagnosticReportingEnabled
  })
  return defaultRecorder
}

export const recordClientJavaScriptError = async (report: unknown) => (
  await getDefaultRecorder().record(report)
)

export const flushClientJavaScriptDiagnostics = async () => {
  await defaultRecorder?.flush()
}
