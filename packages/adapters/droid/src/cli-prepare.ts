import { defineAdapterCliPreparer } from '@oneworks/types'
import { ensureManagedNpmCli, probeManagedNpmCliVersion } from '@oneworks/utils/managed-npm-cli'

import {
  DROID_CLI_PACKAGE,
  DROID_CLI_VERSION,
  DROID_CLI_VERSION_ENV,
  DROID_CLI_VERSION_RANGE,
  resolveDroidBundledBinaryPath,
  resolveDroidManagedRuntimeHome
} from './paths'
import { DROID_CLI_PREPARE_CHILD_ENV_POLICY } from './prepare-env'
import { resolveDroidAdapterConfig } from './runtime/adapter-config'

export default defineAdapterCliPreparer({
  adapter: 'droid',
  title: 'Factory Droid',
  targets: [{
    key: 'cli',
    title: 'Factory Droid CLI',
    aliases: ['droid'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => {
    const adapterConfig = resolveDroidAdapterConfig(
      ctx as Parameters<typeof resolveDroidAdapterConfig>[0]
    ).native
    const runtimeHome = resolveDroidManagedRuntimeHome(ctx.cwd, ctx.env)
    const binaryPath = await ensureManagedNpmCli({
      adapterKey: 'droid',
      binaryName: 'droid',
      bundledPath: resolveDroidBundledBinaryPath(ctx.env, adapterConfig.cli),
      config: {
        ...adapterConfig.cli,
        source: adapterConfig.cli?.source ?? 'managed'
      },
      childEnvPolicy: DROID_CLI_PREPARE_CHILD_ENV_POLICY,
      cwd: ctx.cwd,
      defaultPackageName: DROID_CLI_PACKAGE,
      defaultVersion: DROID_CLI_VERSION,
      versionRange: DROID_CLI_VERSION_RANGE,
      validateExplicitPathVersion: true,
      env: {
        ...Object.fromEntries(Object.entries(ctx.env).filter(([key]) => !key.startsWith('FACTORY_'))),
        HOME: runtimeHome,
        USERPROFILE: runtimeHome
      },
      logger: ctx.logger
    })
    const actualVersion = await probeManagedNpmCliVersion({
      binaryPath,
      childEnvPolicy: DROID_CLI_PREPARE_CHILD_ENV_POLICY,
      cwd: ctx.cwd,
      env: {
        ...Object.fromEntries(Object.entries(ctx.env).filter(([key]) => !key.startsWith('FACTORY_'))),
        HOME: runtimeHome,
        USERPROFILE: runtimeHome
      }
    })
    if (actualVersion == null) throw new Error('Factory Droid CLI version could not be determined after validation.')
    ctx.env[DROID_CLI_VERSION_ENV] = actualVersion

    return { adapter: 'droid', target: 'cli', title: 'Factory Droid CLI', binaryPath }
  }
})
