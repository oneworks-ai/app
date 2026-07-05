import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { InvalidArgumentError } from 'commander'
import type { Command } from 'commander'

import { applyServerRuntimeEnv, runRuntimeEntry } from '@oneworks/server/cli-runtime'
import { resolveActiveModulePackageDirSync } from '@oneworks/server/module-update-cache'

const nodeRequire = createRequire(__filename)

interface DaemonCliOptions {
  allowCors?: boolean
  base?: string
  configDir?: string
  dataDir?: string
  host?: string
  logDir?: string
  port?: string
  publicBaseUrl?: string
  webAuth?: boolean
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

const resolveServerPackageDir = () => (
  resolveActiveModulePackageDirSync('@oneworks/server') ??
    dirname(nodeRequire.resolve('@oneworks/server/package.json'))
)

export const registerDaemonCommand = (program: Command) => {
  program
    .command('daemon')
    .description('Start a OneWorks daemon service for local or relay workspace access')
    .option('--host <host>', 'Daemon host')
    .option('--port <port>', 'Daemon port', parsePort)
    .option('--ws-path <path>', 'WebSocket path', parseWsPath)
    .option('--workspace <path>', 'Default workspace used for device identity and local config')
    .option('--config-dir <path>', 'Override config directory')
    .option('--data-dir <path>', 'Override server data directory')
    .option('--log-dir <path>', 'Override server log directory')
    .option('--public-base-url <url>', 'External base URL used in links')
    .option('--allow-cors', 'Enable CORS for remote clients')
    .option('--web-auth', 'Enable browser web auth checks')
    .addHelpText(
      'after',
      `
Examples:
  npx oneworks daemon
  npx oneworks daemon --host 0.0.0.0 --port 8787 --workspace /workspaces/project-a
`
    )
    .action(async (options: DaemonCliOptions) => {
      const serverPackageDir = resolveServerPackageDir()
      const env = applyServerRuntimeEnv({
        cwd: process.cwd(),
        packageDir: serverPackageDir,
        options,
        defaults: {
          allowCors: false,
          clientMode: 'none',
          entryKind: 'server',
          serverRole: 'manager',
          serverHost: '127.0.0.1',
          serverPort: '8787',
          serverWsPath: '/ws',
          workspaceMode: 'optional'
        }
      })
      env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__ = options.webAuth === true ? 'true' : 'false'

      const exitCode = await runRuntimeEntry({
        entryPath: resolve(serverPackageDir, 'src/index.ts'),
        env
      })

      if (exitCode !== 0) {
        process.exit(exitCode)
      }
    })
}
