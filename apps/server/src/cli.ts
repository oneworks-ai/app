import { resolve } from 'node:path'
import process from 'node:process'

import { InvalidArgumentError, program } from 'commander'

import { applyServerRuntimeEnv, runRuntimeEntry } from './cli-runtime'
import { getServerDescription, getServerVersion } from './package-config'

interface ServerCliOptions {
  allowCors?: boolean
  configDir?: string
  dataDir?: string
  host?: string
  logDir?: string
  manager?: boolean
  port?: string
  publicBaseUrl?: string
  workspace?: string
  wsPath?: string
}

const parsePort = (value: string) => {
  const normalizedValue = value.trim()
  const port = Number.parseInt(normalizedValue, 10)
  if (!Number.isInteger(port) || String(port) !== normalizedValue || port < 1 || port > 65535) {
    throw new InvalidArgumentError('port must be an integer between 1 and 65535')
  }

  return normalizedValue
}

const parseWsPath = (value: string) => {
  const normalizedValue = value.trim()
  if (!normalizedValue.startsWith('/')) {
    throw new InvalidArgumentError('ws-path must start with "/"')
  }

  return normalizedValue
}

program
  .name('oneworks-server')
  .description(getServerDescription())
  .version(getServerVersion())
  .showHelpAfterError()
  .option('--host <host>', 'Server host')
  .option('--port <port>', 'Server port', parsePort)
  .option('--ws-path <path>', 'WebSocket path', parseWsPath)
  .option('--workspace <path>', 'Workspace root for config and assets')
  .option('--config-dir <path>', 'Override config directory')
  .option('--data-dir <path>', 'Override server data directory')
  .option('--log-dir <path>', 'Override server log directory')
  .option('--manager', 'Run the manager server without binding a workspace')
  .option('--public-base-url <url>', 'External base URL used in links')
  .option('--allow-cors', 'Enable CORS for remote clients')
  .addHelpText(
    'after',
    `
Examples:
  npx oneworks server
  npx oneworks server --host 0.0.0.0 --port 8787 --allow-cors
`
  )
  .action(async (options: ServerCliOptions) => {
    if (options.manager === true && options.workspace?.trim()) {
      throw new Error('Use either --manager or --workspace, not both.')
    }

    const packageDir = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? resolve(process.cwd(), 'apps/server')
    const env = applyServerRuntimeEnv({
      cwd: process.cwd(),
      packageDir,
      options,
      defaults: {
        allowCors: false,
        clientMode: 'none',
        entryKind: 'server',
        serverRole: options.manager === true ? 'manager' : 'workspace',
        serverHost: '127.0.0.1',
        serverPort: '8787',
        serverWsPath: '/ws',
        workspaceMode: options.manager === true ? 'optional' : 'required'
      }
    })

    const exitCode = await runRuntimeEntry({
      entryPath: resolve(packageDir, 'src/index.ts'),
      env
    })

    if (exitCode !== 0) {
      process.exit(exitCode)
    }
  })

void program.parseAsync(process.argv)
