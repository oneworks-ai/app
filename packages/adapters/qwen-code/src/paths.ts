import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx } from '@oneworks/types'
import { resolveManagedNpmCliBinaryPath } from '@oneworks/utils/managed-npm-cli'

const require = createRequire(
  typeof __filename === 'string' ? __filename : resolve(process.cwd(), 'package.json')
)
const adapterPackageDir = dirname(require.resolve('@oneworks/adapter-qwen-code/package.json'))
const bundledPath = resolve(adapterPackageDir, 'node_modules/.bin/qwen')

export const QWEN_CODE_CLI_PACKAGE = '@qwen-code/qwen-code'
export const QWEN_CODE_CLI_VERSION = '0.21.11'
export const QWEN_CODE_CLI_COMPATIBILITY_RANGE = '0.21.11'

const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

export const resolveQwenCodeBinaryPath = (
  env: AdapterCtx['env'],
  cwd?: string
) => {
  const envPath = env.__ONEWORKS_PROJECT_ADAPTER_QWEN_CODE_CLI_PATH__
  if (typeof envPath === 'string' && envPath.trim() !== '') {
    return envPath
  }

  return resolveManagedNpmCliBinaryPath({
    adapterKey: 'qwen-code',
    binaryName: 'qwen',
    bundledPath: existsSync(bundledPath) ? toRealPath(bundledPath) : undefined,
    cwd,
    defaultPackageName: QWEN_CODE_CLI_PACKAGE,
    defaultVersion: QWEN_CODE_CLI_VERSION,
    env
  })
}
