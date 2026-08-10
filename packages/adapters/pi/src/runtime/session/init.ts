import type { AdapterCtx } from '@oneworks/types'
import { migrateProjectHomeSegments } from '@oneworks/utils'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  PI_CLI_PACKAGE,
  PI_CLI_VERSION,
  PI_CLI_VERSION_RANGE,
  assertPiNodeVersion,
  resolvePiBinaryPath
} from '#~/paths.js'
import { resolvePiAdapterConfig } from './config'

export const initPiAdapter = async (ctx: AdapterCtx) => {
  assertPiNodeVersion()
  await migrateProjectHomeSegments(ctx.cwd, ctx.env, ['caches', '.mock'])
  const adapterConfig = resolvePiAdapterConfig(ctx).native
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_PI_CLI_PATH__ = await ensureManagedNpmCli({
    adapterKey: 'pi',
    binaryName: 'pi',
    bundledPath: resolvePiBinaryPath(ctx.env, ctx.cwd, adapterConfig.cli),
    config: adapterConfig.cli,
    cwd: ctx.cwd,
    defaultPackageName: PI_CLI_PACKAGE,
    defaultVersion: PI_CLI_VERSION,
    env: ctx.env,
    ignoreInstallScripts: true,
    logger: ctx.logger,
    versionRange: PI_CLI_VERSION_RANGE
  })
}
