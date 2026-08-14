import { defineAdapterCliPreparer } from '@oneworks/types'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import { CLINE_CLI_PACKAGE, CLINE_CLI_VERSION, resolveClineBinaryPath, resolveClineCliSource } from './paths'
import { resolveClineAdapterConfig } from './runtime/prepare'

export default defineAdapterCliPreparer({
  adapter: 'cline',
  title: 'Cline',
  targets: [{
    key: 'cli',
    title: 'Cline CLI',
    aliases: ['cline'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => {
    const adapterConfig = resolveClineAdapterConfig(ctx as Parameters<typeof resolveClineAdapterConfig>[0])
    const source = resolveClineCliSource(ctx.env, adapterConfig.cli)
    const cliConfig = source === 'managed'
      ? { ...adapterConfig.cli, source, version: CLINE_CLI_VERSION }
      : adapterConfig.cli
    const binaryPath = await ensureManagedNpmCli({
      adapterKey: 'cline',
      binaryName: 'cline',
      bundledPath: resolveClineBinaryPath(ctx.env, ctx.cwd, cliConfig),
      config: cliConfig,
      cwd: ctx.cwd,
      defaultPackageName: CLINE_CLI_PACKAGE,
      defaultVersion: CLINE_CLI_VERSION,
      env: source === 'managed'
        ? { ...ctx.env, __ONEWORKS_PROJECT_ADAPTER_CLINE_INSTALL_VERSION__: CLINE_CLI_VERSION }
        : ctx.env,
      ignoreInstallScripts: true,
      logger: ctx.logger,
      versionRange: CLINE_CLI_VERSION
    })
    return { adapter: 'cline', target: 'cli', title: 'Cline CLI', binaryPath }
  }
})
