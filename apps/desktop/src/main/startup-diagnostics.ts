import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { createDiagnosticClient, diagnosticFailureFromError } from '@oneworks/diagnostics'
import type {
  DiagnosticEnvironment,
  DiagnosticExporter,
  DiagnosticFailureDomain,
  DiagnosticOperationSnapshot
} from '@oneworks/diagnostics'
import { FileDiagnosticJournal, createOtlpHttpDiagnosticExporterFromEnv } from '@oneworks/diagnostics/node'
import type { DesktopFirstActionMilestone } from '@oneworks/types'
import { DEFAULT_GLOBAL_OO_CONFIG_FILE, resolveGlobalOneWorksDir } from '@oneworks/utils/ai-path'

import { createDesktopFirstActionDiagnostics } from './first-action-diagnostics'

const DEFAULT_STABLE_DELAY_MS = 30_000
const DEFAULT_READY_TIMEOUT_MS = 120_000

export interface DesktopStartupFailureInput {
  code: string
  domain: DiagnosticFailureDomain
  retryable?: boolean
}

export interface DesktopStartupDiagnosticsOptions {
  architecture?: string
  createId?: () => string
  directory: string
  environment: DiagnosticEnvironment
  now?: () => Date
  otlpExporter?: DiagnosticExporter | false
  platform?: string
  readyTimeoutMs?: number
  serviceVersion?: string
  stableDelayMs?: number
}

export interface DesktopStartupDiagnostics {
  cancel: () => void
  degrade: (error: unknown, input: DesktopStartupFailureInput) => void
  fail: (error: unknown, input: DesktopStartupFailureInput) => void
  flush: () => Promise<void>
  getFirstActionSnapshot: () => DiagnosticOperationSnapshot | undefined
  getSnapshot: () => DiagnosticOperationSnapshot
  markFirstActionMilestone: (milestone: DesktopFirstActionMilestone, sourceId: string) => void
  ready: () => void
  stage: (name: string) => void
}

export const readDesktopDiagnosticReportingEnabled = () => {
  try {
    const configPath = resolve(resolveGlobalOneWorksDir(process.env), DEFAULT_GLOBAL_OO_CONFIG_FILE)
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      diagnostics?: { reporting?: boolean | { enabled?: boolean } }
    }
    const reporting = config.diagnostics?.reporting
    return typeof reporting === 'boolean' ? reporting : reporting?.enabled !== false
  } catch {
    return true
  }
}

export const createDesktopStartupDiagnostics = (
  options: DesktopStartupDiagnosticsOptions
): DesktopStartupDiagnostics => {
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const startupId = createId()
  const journal = new FileDiagnosticJournal({ directory: options.directory })
  const reportOtlpError = (error: unknown) => {
    const name = error instanceof Error ? error.name : 'UnknownError'
    console.warn(`[oneworks-desktop] OTLP diagnostic export failed (${name})`)
  }
  const otlpExporter = options.otlpExporter === false
    ? undefined
    : options.otlpExporter ?? createOtlpHttpDiagnosticExporterFromEnv({
      onError: reportOtlpError
    })
  const recoveredEvents = journal.recoverInterruptedOperations({ createId, now })
  const recoveredExportTasks = otlpExporter == null
    ? []
    : recoveredEvents.map(async event => {
      try {
        await otlpExporter.export(event)
      } catch (error) {
        reportOtlpError(error)
      }
    })

  const client = createDiagnosticClient({
    context: {
      appSessionId: startupId,
      startupId
    },
    createId,
    exporters: [journal, ...(otlpExporter == null ? [] : [otlpExporter])],
    now,
    resource: {
      architecture: options.architecture,
      environment: options.environment,
      platform: options.platform,
      serviceName: 'oneworks-desktop',
      serviceVersion: options.serviceVersion,
      surface: 'desktop'
    }
  })
  const operation = client.startOperation('oneworks.app.startup', {
    operationId: startupId
  })
  const firstAction = createDesktopFirstActionDiagnostics(client)
  const emittedStages = new Set<string>()
  let readyTimer: ReturnType<typeof setTimeout> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined

  const clearTimers = () => {
    if (readyTimer != null) {
      clearTimeout(readyTimer)
      readyTimer = undefined
    }
    if (stableTimer != null) {
      clearTimeout(stableTimer)
      stableTimer = undefined
    }
  }

  const completeWithFailure = (
    method: 'degrade' | 'fail',
    error: unknown,
    input: DesktopStartupFailureInput
  ) => {
    clearTimers()
    operation[method](diagnosticFailureFromError(error, input))
  }

  readyTimer = setTimeout(() => {
    readyTimer = undefined
    operation.timeout({
      code: 'desktop.startup_ready_timeout',
      domain: 'process',
      retryable: true
    })
  }, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
  readyTimer.unref?.()

  return {
    cancel: () => {
      clearTimers()
      operation.cancel({
        code: 'app.quit_before_startup_stable',
        domain: 'process',
        retryable: true
      })
      firstAction.cancel()
    },
    degrade: (error, input) => completeWithFailure('degrade', error, input),
    fail: (error, input) => completeWithFailure('fail', error, input),
    flush: async () => {
      await Promise.all(recoveredExportTasks)
      await client.flush()
    },
    getFirstActionSnapshot: firstAction.getSnapshot,
    getSnapshot: operation.getSnapshot,
    markFirstActionMilestone: firstAction.mark,
    ready: () => {
      if (operation.isReady() || operation.isTerminal()) return
      if (readyTimer != null) {
        clearTimeout(readyTimer)
        readyTimer = undefined
      }
      operation.ready('renderer.interactive')
      stableTimer = setTimeout(() => {
        stableTimer = undefined
        operation.stable()
      }, options.stableDelayMs ?? DEFAULT_STABLE_DELAY_MS)
      stableTimer.unref?.()
    },
    stage: name => {
      if (emittedStages.has(name) || operation.isTerminal()) return
      emittedStages.add(name)
      operation.stage(name)
    }
  }
}
