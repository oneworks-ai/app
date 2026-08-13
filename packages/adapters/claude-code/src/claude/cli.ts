import type { AdapterCtx } from '@oneworks/types'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  CLAUDE_CODE_CLI_COMPATIBILITY_RANGE,
  CLAUDE_CODE_CLI_PACKAGE,
  CLAUDE_CODE_CLI_VERSION,
  resolveClaudeCliPath,
  resolveClaudeCodeSystemBinaryPaths
} from '../ccr/paths'
import type { ClaudeCodeAdapterConfig } from '../config-schema'

const CLAUDE_CLI_PATH_ENV = '__ONEWORKS_PROJECT_ADAPTER_CLAUDE_CODE_CLI_PATH__'

export const ensureClaudeCliPath = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger'>
  env: Record<string, string | null | undefined>
  cliConfig?: ClaudeCodeAdapterConfig['cli']
}) => {
  const cachedPath = params.ctx.env[CLAUDE_CLI_PATH_ENV]
  if (cachedPath != null && cachedPath.trim() !== '') {
    return cachedPath
  }

  const cliPath = await ensureManagedNpmCli({
    adapterKey: 'claude_code',
    binaryName: 'claude',
    bundledPath: resolveClaudeCliPath(params.ctx.cwd, params.env, params.cliConfig),
    config: params.cliConfig,
    cwd: params.ctx.cwd,
    defaultPackageName: CLAUDE_CODE_CLI_PACKAGE,
    defaultVersion: CLAUDE_CODE_CLI_VERSION,
    env: params.env,
    logger: params.ctx.logger,
    preferSystem: params.cliConfig?.source == null,
    systemBinaryPaths: await resolveClaudeCodeSystemBinaryPaths(params.env),
    versionRange: CLAUDE_CODE_CLI_COMPATIBILITY_RANGE
  })
  params.ctx.env[CLAUDE_CLI_PATH_ENV] = cliPath
  return cliPath
}
