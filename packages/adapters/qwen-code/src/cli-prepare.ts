import { defineAdapterCliPreparer } from '@oneworks/types'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import {
  QWEN_CODE_CLI_COMPATIBILITY_RANGE,
  QWEN_CODE_CLI_PACKAGE,
  QWEN_CODE_CLI_VERSION,
  resolveQwenCodeBinaryPath
} from '#~/paths.js'
import { resolveQwenCodeAdapterConfig } from '#~/runtime/config.js'

export default defineAdapterCliPreparer({
  adapter: 'qwen-code',
  title: 'Qwen Code',
  targets: [{
    key: 'cli',
    title: 'Qwen Code CLI',
    aliases: ['qwen'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => {
    const adapterConfig = resolveQwenCodeAdapterConfig(ctx as Parameters<typeof resolveQwenCodeAdapterConfig>[0])
    const binaryPath = await ensureManagedNpmCli({
      adapterKey: 'qwen-code',
      binaryName: 'qwen',
      bundledPath: resolveQwenCodeBinaryPath(ctx.env, ctx.cwd),
      config: {
        ...adapterConfig.cli,
        source: adapterConfig.cli?.source ?? 'managed'
      },
      cwd: ctx.cwd,
      defaultPackageName: QWEN_CODE_CLI_PACKAGE,
      defaultVersion: QWEN_CODE_CLI_VERSION,
      env: ctx.env,
      logger: ctx.logger,
      validateExplicitPathVersion: true,
      versionRange: QWEN_CODE_CLI_COMPATIBILITY_RANGE
    })

    return {
      adapter: 'qwen-code',
      target: 'cli',
      title: 'Qwen Code CLI',
      binaryPath
    }
  }
})
