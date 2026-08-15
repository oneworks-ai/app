import type { AdapterCtx } from '@oneworks/types'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  CODEX_CLI_COMPATIBILITY_RANGE,
  CODEX_CLI_PACKAGE,
  CODEX_CLI_VERSION,
  resolveCodexBinaryPath,
  resolveCodexSystemBinaryPaths
} from '#~/paths.js'
import { resolveCodexAdapterConfig } from '#~/runtime/config.js'

type EnsureCodexCliContext = Pick<AdapterCtx, 'configs' | 'cwd' | 'env'> & {
  logger: Pick<AdapterCtx['logger'], 'info'>
}

export const ensureCodexCli = async (ctx: EnsureCodexCliContext) => {
  const { native: adapterConfig } = resolveCodexAdapterConfig(ctx)
  return await ensureManagedNpmCli({
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
}
