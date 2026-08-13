import { mkdir } from 'node:fs/promises'

import type { AdapterCtx } from '@oneworks/types'
import { ensureManagedNpmCli, probeManagedNpmCliVersion } from '@oneworks/utils/managed-npm-cli'

import {
  DROID_CLI_PACKAGE,
  DROID_CLI_VERSION,
  DROID_CLI_VERSION_ENV,
  DROID_CLI_VERSION_RANGE,
  resolveDroidBundledBinaryPath,
  resolveDroidManagedRuntimeHome
} from '../paths'
import { DROID_CLI_PREPARE_CHILD_ENV_POLICY } from '../prepare-env'
import { resolveDroidAdapterConfig } from './adapter-config'
import { prepareDroidNativeHooks } from './native-hooks'

export const initDroidAdapter = async (ctx: AdapterCtx) => {
  const adapterConfig = resolveDroidAdapterConfig(ctx).native
  const runtimeHome = resolveDroidManagedRuntimeHome(ctx.cwd, ctx.env)
  await mkdir(runtimeHome, { recursive: true })
  const installEnv = {
    ...Object.fromEntries(Object.entries(ctx.env).filter(([key]) => !key.startsWith('FACTORY_'))),
    HOME: runtimeHome,
    USERPROFILE: runtimeHome
  }
  const binaryPath = await ensureManagedNpmCli({
    adapterKey: 'droid',
    binaryName: 'droid',
    bundledPath: resolveDroidBundledBinaryPath(installEnv, adapterConfig.cli),
    config: adapterConfig.cli,
    childEnvPolicy: DROID_CLI_PREPARE_CHILD_ENV_POLICY,
    cwd: ctx.cwd,
    defaultPackageName: DROID_CLI_PACKAGE,
    defaultVersion: DROID_CLI_VERSION,
    env: installEnv,
    logger: ctx.logger,
    validateExplicitPathVersion: true,
    versionRange: DROID_CLI_VERSION_RANGE
  })
  const actualVersion = await probeManagedNpmCliVersion({
    binaryPath,
    childEnvPolicy: DROID_CLI_PREPARE_CHILD_ENV_POLICY,
    cwd: ctx.cwd,
    env: installEnv
  })
  if (actualVersion == null) throw new Error('Factory Droid CLI version could not be determined after validation.')
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__ = binaryPath
  ctx.env[DROID_CLI_VERSION_ENV] = actualVersion
  prepareDroidNativeHooks(ctx)
}
