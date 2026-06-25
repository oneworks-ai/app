import { defineAdapterCliPreparer } from '@oneworks/types'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  CODEX_CLI_COMPATIBILITY_RANGE,
  CODEX_CLI_PACKAGE,
  CODEX_CLI_VERSION,
  resolveCodexBinaryPath,
  resolveCodexSystemBinaryPaths
} from '#~/paths.js'
import { resolveCodexAdapterConfig } from '#~/runtime/config.js'

export default defineAdapterCliPreparer({
  adapter: 'codex',
  title: 'Codex',
  targets: [{
    key: 'cli',
    title: 'Codex CLI',
    aliases: ['codex'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => {
    const { native: adapterConfig } = resolveCodexAdapterConfig(ctx)
    const binaryPath = await ensureManagedNpmCli({
      adapterKey: 'codex',
      binaryName: 'codex',
      bundledPath: resolveCodexBinaryPath(ctx.env, ctx.cwd),
      config: adapterConfig.cli,
      cwd: ctx.cwd,
      defaultPackageName: CODEX_CLI_PACKAGE,
      defaultVersion: CODEX_CLI_VERSION,
      env: ctx.env,
      logger: ctx.logger,
      preferSystem: adapterConfig.cli?.source == null,
      systemBinaryPaths: await resolveCodexSystemBinaryPaths(ctx.env),
      versionRange: CODEX_CLI_COMPATIBILITY_RANGE
    })

    return {
      adapter: 'codex',
      target: 'cli',
      title: 'Codex CLI',
      binaryPath
    }
  }
})
