import { defineAdapterCliPreparer } from '@oneworks/types'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  CLAUDE_CODE_CLI_COMPATIBILITY_RANGE,
  CLAUDE_CODE_CLI_PACKAGE,
  CLAUDE_CODE_CLI_VERSION,
  CLAUDE_CODE_ROUTER_CLI_COMPATIBILITY_RANGE,
  CLAUDE_CODE_ROUTER_CLI_PACKAGE,
  CLAUDE_CODE_ROUTER_CLI_VERSION,
  resolveAdapterCliPath,
  resolveClaudeCliPath,
  resolveClaudeCodeRouterSystemBinaryPaths,
  resolveClaudeCodeSystemBinaryPaths
} from './ccr/paths'
import { resolveClaudeCodeAdapterConfig } from './runtime-config'

const prepareClaudeCli = async (
  ctx: Parameters<Parameters<typeof defineAdapterCliPreparer>[0]['prepare']>[0]
) => {
  const { native: adapterConfig } = resolveClaudeCodeAdapterConfig(ctx)
  const binaryPath = await ensureManagedNpmCli({
    adapterKey: 'claude_code',
    binaryName: 'claude',
    bundledPath: resolveClaudeCliPath(ctx.cwd, ctx.env, adapterConfig.cli),
    config: adapterConfig.cli,
    cwd: ctx.cwd,
    defaultPackageName: CLAUDE_CODE_CLI_PACKAGE,
    defaultVersion: CLAUDE_CODE_CLI_VERSION,
    env: ctx.env,
    logger: ctx.logger,
    preferSystem: adapterConfig.cli?.source == null,
    systemBinaryPaths: await resolveClaudeCodeSystemBinaryPaths(ctx.env),
    versionRange: CLAUDE_CODE_CLI_COMPATIBILITY_RANGE
  })

  return {
    adapter: 'claude-code',
    target: 'cli',
    title: 'Claude Code CLI',
    binaryPath
  }
}

const prepareRouterCli = async (
  ctx: Parameters<Parameters<typeof defineAdapterCliPreparer>[0]['prepare']>[0]
) => {
  const { native: adapterConfig } = resolveClaudeCodeAdapterConfig(ctx)
  const binaryPath = await ensureManagedNpmCli({
    adapterKey: 'claude_code_router',
    binaryName: 'ccr',
    bundledPath: resolveAdapterCliPath(ctx.cwd, ctx.env, adapterConfig.routerCli),
    config: adapterConfig.routerCli,
    cwd: ctx.cwd,
    defaultPackageName: CLAUDE_CODE_ROUTER_CLI_PACKAGE,
    defaultVersion: CLAUDE_CODE_ROUTER_CLI_VERSION,
    env: ctx.env,
    logger: ctx.logger,
    preferSystem: adapterConfig.routerCli?.source == null,
    systemBinaryPaths: await resolveClaudeCodeRouterSystemBinaryPaths(ctx.env),
    versionRange: CLAUDE_CODE_ROUTER_CLI_COMPATIBILITY_RANGE,
    versionArgs: ['version']
  })

  return {
    adapter: 'claude-code',
    target: 'routerCli',
    title: 'Claude Code Router CLI',
    binaryPath
  }
}

export default defineAdapterCliPreparer({
  adapter: 'claude-code',
  title: 'Claude Code',
  targets: [
    {
      key: 'cli',
      title: 'Claude Code CLI',
      aliases: ['claude'],
      configPath: ['cli']
    },
    {
      key: 'routerCli',
      title: 'Claude Code Router CLI',
      aliases: ['ccr', 'router', 'claude-code-router'],
      configPath: ['routerCli']
    }
  ],
  prepare: async (ctx, options) => {
    if (options.target === 'cli') return prepareClaudeCli(ctx)
    if (options.target === 'routerCli') return prepareRouterCli(ctx)
    throw new Error(`Unknown Claude Code CLI prepare target: ${options.target}`)
  }
})
