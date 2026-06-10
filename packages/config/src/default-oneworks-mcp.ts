import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import type { Config } from '@oneworks/types'
import { CANONICAL_ONEWORKS_MCP_SERVER_NAME } from '@oneworks/utils'

import { mergeUniqueList } from './merge'

export const DEFAULT_ONEWORKS_MCP_SERVER_NAME = CANONICAL_ONEWORKS_MCP_SERVER_NAME
export const DEFAULT_ONEWORKS_MCP_PERMISSION_NAME = DEFAULT_ONEWORKS_MCP_SERVER_NAME

export const resolveUseDefaultOneworksMcpServer = (options: {
  runtimeValue?: boolean
  projectConfig?: Config
  userConfig?: Config
}) => (
  options.runtimeValue ??
    (options.userConfig?.noDefaultOneworksMcpServer != null
      ? !options.userConfig.noDefaultOneworksMcpServer
      : undefined) ??
    (options.projectConfig?.noDefaultOneworksMcpServer != null
      ? !options.projectConfig.noDefaultOneworksMcpServer
      : undefined) ??
    true
)

export const resolveDefaultOneworksMcpServerConfig = () => {
  try {
    const packageResolver = typeof require === 'function'
      ? require
      : createRequire(resolve(process.cwd(), '__oneworks_config_mcp_resolver__.js'))
    const workspacePackageJsonPath = resolve(process.cwd(), 'packages/mcp/package.json')
    const packageJsonPath = existsSync(workspacePackageJsonPath)
      ? workspacePackageJsonPath
      : resolvePublishedMcpPackageJsonPath(packageResolver)
    const packageDir = dirname(packageJsonPath)
    return {
      command: process.execPath,
      args: [resolve(packageDir, 'cli.js')]
    } satisfies NonNullable<Config['mcpServers']>[string]
  } catch {
    return undefined
  }
}

const withDefaultOneworksMcpPermission = (
  config: Config | undefined
) => {
  if (config == null) return undefined

  return {
    ...config,
    permissions: {
      ...(config.permissions ?? {}),
      allow: mergeUniqueList(
        config.permissions?.allow,
        [DEFAULT_ONEWORKS_MCP_PERMISSION_NAME]
      )
    }
  } satisfies Config
}

export const mergeDefaultOneworksMcpPermissions = (options: {
  runtimeValue?: boolean
  projectConfig?: Config
  userConfig?: Config
}) => {
  if (!resolveUseDefaultOneworksMcpServer(options)) {
    return [options.projectConfig, options.userConfig] as const
  }

  if (options.projectConfig != null) {
    return [
      withDefaultOneworksMcpPermission(options.projectConfig),
      options.userConfig
    ] as const
  }

  if (options.userConfig != null) {
    return [
      options.projectConfig,
      withDefaultOneworksMcpPermission(options.userConfig)
    ] as const
  }

  return [options.projectConfig, options.userConfig] as const
}

const resolvePublishedMcpPackageJsonPath = (packageResolver: NodeJS.Require) => {
  try {
    const appRuntimePackageJsonPath = packageResolver.resolve('@oneworks/app-runtime/package.json')
    return createRequire(appRuntimePackageJsonPath).resolve('@oneworks/mcp/package.json')
  } catch {
    return packageResolver.resolve('@oneworks/mcp/package.json')
  }
}
