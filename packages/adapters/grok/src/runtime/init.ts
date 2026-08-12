import { mkdir } from 'node:fs/promises'

import type { AdapterCtx } from '@oneworks/types'
import { migrateProjectHomeSegments } from '@oneworks/utils'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  GROK_CLI_PACKAGE,
  GROK_CLI_VERSION,
  resolveGrokBinaryPath,
  resolveGrokManagedRuntimeHome,
  resolveGrokRuntimeBinaryPath
} from '../paths'
import { resolveGrokAdapterConfig } from './config'
import { prepareGrokNativeHooks } from './native-hooks'

export const initGrokAdapter = async (ctx: AdapterCtx) => {
  await migrateProjectHomeSegments(ctx.cwd, ctx.env, ['caches'])
  prepareGrokNativeHooks(ctx)

  const adapterConfig = resolveGrokAdapterConfig(ctx)
  const managedRuntimeHome = resolveGrokManagedRuntimeHome(ctx.cwd, ctx.env)
  await mkdir(managedRuntimeHome, { recursive: true })
  const installEnv = { ...ctx.env, GROK_HOME: managedRuntimeHome }
  const configuredBinaryPath = await ensureManagedNpmCli({
    adapterKey: 'grok',
    binaryName: 'grok',
    bundledPath: resolveGrokBinaryPath(installEnv, ctx.cwd),
    config: adapterConfig.cli,
    cwd: ctx.cwd,
    defaultPackageName: GROK_CLI_PACKAGE,
    defaultVersion: GROK_CLI_VERSION,
    env: installEnv,
    logger: ctx.logger
  })
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_GROK_CLI_PATH__ = resolveGrokRuntimeBinaryPath({
    configuredBinaryPath,
    managedRuntimeHome,
    source: adapterConfig.cli?.source
  })
}
