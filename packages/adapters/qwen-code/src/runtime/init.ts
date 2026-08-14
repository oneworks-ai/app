import type { AdapterCtx } from '@oneworks/types'
import { migrateProjectHomeSegments } from '@oneworks/utils'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  QWEN_CODE_CLI_COMPATIBILITY_RANGE,
  QWEN_CODE_CLI_PACKAGE,
  QWEN_CODE_CLI_VERSION,
  resolveQwenCodeBinaryPath
} from '../paths'
import { resolveQwenCodeAdapterConfig } from './config'
import { prepareQwenNativeHooks } from './native-hooks'

export const initQwenCodeAdapter = async (ctx: AdapterCtx) => {
  await migrateProjectHomeSegments(ctx.cwd, ctx.env, ['caches', '.mock'])
  prepareQwenNativeHooks(ctx)
  const adapterConfig = resolveQwenCodeAdapterConfig(ctx)
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_QWEN_CODE_CLI_PATH__ = await ensureManagedNpmCli({
    adapterKey: 'qwen-code',
    binaryName: 'qwen',
    bundledPath: resolveQwenCodeBinaryPath(ctx.env, ctx.cwd),
    config: adapterConfig.cli,
    cwd: ctx.cwd,
    defaultPackageName: QWEN_CODE_CLI_PACKAGE,
    defaultVersion: QWEN_CODE_CLI_VERSION,
    env: ctx.env,
    logger: ctx.logger,
    validateExplicitPathVersion: true,
    versionRange: QWEN_CODE_CLI_COMPATIBILITY_RANGE
  })
}
