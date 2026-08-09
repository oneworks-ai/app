import process from 'node:process'

import { createDiagnosticClient, diagnosticFailureFromError } from '@oneworks/diagnostics'
import type { DiagnosticOperation } from '@oneworks/diagnostics'
import { FileDiagnosticJournal, createOtlpHttpDiagnosticExporterFromEnv } from '@oneworks/diagnostics/node'
import { mergeProcessEnvWithProjectEnv, resolveProjectHomePath } from '@oneworks/utils'

import { getCliVersion } from './utils'

const cliCommandStages = new Set([
  'accounts',
  'adapter',
  'agent',
  'benchmark',
  'channel',
  'clear',
  'config',
  'daemon',
  'kill',
  'list',
  'memory',
  'plugin',
  'report',
  'run',
  'skills',
  'stop'
])

const resolveCommandStage = (argv: string[]) => {
  const firstArgument = argv.find(argument => !argument.startsWith('-'))
  return firstArgument != null && cliCommandStages.has(firstArgument) ? firstArgument : 'run'
}

export interface CliDiagnostics {
  fail: (error: unknown) => void
  flush: () => Promise<void>
  stage: (name: string) => void
  succeed: () => void
}

const noopDiagnostics: CliDiagnostics = {
  fail: () => {},
  flush: async () => {},
  stage: () => {},
  succeed: () => {}
}

export const createCliDiagnostics = (
  argv: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
  } = {}
): CliDiagnostics => {
  try {
    const cwd = options.cwd ?? process.cwd()
    const env = mergeProcessEnvWithProjectEnv(options.env, { workspaceFolder: cwd })
    const journal = new FileDiagnosticJournal({
      directory: resolveProjectHomePath(cwd, env, 'diagnostics', 'cli')
    })
    journal.recoverInterruptedOperations()
    const otlp = createOtlpHttpDiagnosticExporterFromEnv({
      env,
      onError: error => {
        const name = error instanceof Error ? error.name : 'UnknownError'
        if (env.__ONEWORKS_CLI_DEBUG__ === 'true') {
          console.warn(`[oneworks-cli] OTLP diagnostic export failed (${name})`)
        }
      }
    })
    const client = createDiagnosticClient({
      exporters: [journal, ...(otlp == null ? [] : [otlp])],
      resource: {
        architecture: process.arch,
        environment: env.NODE_ENV === 'production' ? 'production' : 'development',
        platform: process.platform,
        serviceName: 'oneworks-cli',
        serviceVersion: getCliVersion(),
        surface: 'cli'
      }
    })
    const operation: DiagnosticOperation = client.startOperation('oneworks.cli.command')
    operation.stage(`command.${resolveCommandStage(argv)}`)

    return {
      fail: error =>
        operation.fail(diagnosticFailureFromError(error, {
          code: 'cli.command_failed',
          domain: 'process'
        })),
      flush: client.flush,
      stage: name => operation.stage(name),
      succeed: () => operation.succeed()
    }
  } catch {
    return noopDiagnostics
  }
}
