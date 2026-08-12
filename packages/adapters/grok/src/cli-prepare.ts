import { defineAdapterCliPreparer } from '@oneworks/types'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  GROK_CLI_PACKAGE,
  GROK_CLI_VERSION,
  resolveGrokBinaryPath,
  resolveGrokManagedRuntimeHome,
  resolveGrokRuntimeBinaryPath
} from './paths'
import { resolveGrokAdapterConfig } from './runtime/config'

export default defineAdapterCliPreparer({
  adapter: 'grok',
  title: 'Grok',
  targets: [{
    key: 'cli',
    title: 'Grok Build CLI',
    aliases: ['grok'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => {
    const adapterConfig = resolveGrokAdapterConfig(ctx as Parameters<typeof resolveGrokAdapterConfig>[0])
    const managedRuntimeHome = resolveGrokManagedRuntimeHome(ctx.cwd, ctx.env)
    const installEnv = { ...ctx.env, GROK_HOME: managedRuntimeHome }
    const configuredBinaryPath = await ensureManagedNpmCli({
      adapterKey: 'grok',
      binaryName: 'grok',
      bundledPath: resolveGrokBinaryPath(installEnv, ctx.cwd),
      config: {
        ...adapterConfig.cli,
        source: adapterConfig.cli?.source ?? 'managed'
      },
      cwd: ctx.cwd,
      defaultPackageName: GROK_CLI_PACKAGE,
      defaultVersion: GROK_CLI_VERSION,
      env: installEnv,
      logger: ctx.logger
    })

    return {
      adapter: 'grok',
      target: 'cli',
      title: 'Grok Build CLI',
      binaryPath: resolveGrokRuntimeBinaryPath({
        configuredBinaryPath,
        managedRuntimeHome,
        source: adapterConfig.cli?.source
      })
    }
  }
})
