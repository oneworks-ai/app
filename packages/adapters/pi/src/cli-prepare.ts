import { defineAdapterCliPreparer } from '@oneworks/types'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  PI_CLI_PACKAGE,
  PI_CLI_VERSION,
  PI_CLI_VERSION_RANGE,
  assertPiNodeVersion,
  resolvePiBinaryPath
} from '#~/paths.js'
import { resolvePiAdapterConfig } from '#~/runtime/session/config.js'

export default defineAdapterCliPreparer({
  adapter: 'pi',
  title: 'Pi',
  targets: [{
    key: 'cli',
    title: 'Pi CLI',
    aliases: ['pi'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => {
    assertPiNodeVersion()
    const adapterConfig = resolvePiAdapterConfig(ctx as Parameters<typeof resolvePiAdapterConfig>[0])
    const binaryPath = await ensureManagedNpmCli({
      adapterKey: 'pi',
      binaryName: 'pi',
      bundledPath: resolvePiBinaryPath(ctx.env, ctx.cwd, adapterConfig.native.cli),
      config: {
        ...adapterConfig.native.cli,
        source: adapterConfig.native.cli?.source ?? 'managed'
      },
      cwd: ctx.cwd,
      defaultPackageName: PI_CLI_PACKAGE,
      defaultVersion: PI_CLI_VERSION,
      env: ctx.env,
      ignoreInstallScripts: true,
      logger: ctx.logger,
      versionRange: PI_CLI_VERSION_RANGE
    })

    return {
      adapter: 'pi',
      target: 'cli',
      title: 'Pi CLI',
      binaryPath
    }
  }
})
