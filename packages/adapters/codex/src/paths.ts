import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx } from '@oneworks/types'
import { resolveManagedNpmCliBinaryPath, resolveUserShellBinaryPath } from '@oneworks/utils/managed-npm-cli'

const require = createRequire(import.meta.url ?? __filename)
const adapterPackageDir = dirname(require.resolve('@oneworks/adapter-codex/package.json'))
const bundledPath = resolve(adapterPackageDir, 'node_modules/.bin/codex')
const USER_SHELL_CHECK_TIMEOUT_MS = 3000

export const CODEX_CLI_PACKAGE = '@openai/codex'
export const CODEX_CLI_VERSION = 'latest'
export const CODEX_CLI_COMPATIBILITY_RANGE = '>=0.130.0'

const CODEX_APP_CLI_RELATIVE_PATH = 'Applications/Codex.app/Contents/Resources/codex'

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const resolveCodexSystemBinaryPaths = (
  env: AdapterCtx['env'] = {}
): Promise<string[]> => {
  const resolvePaths = async () => {
    const userShellCodexBinaryPath = await resolveUserShellBinaryPath({
      binaryName: 'codex',
      env,
      timeoutMs: USER_SHELL_CHECK_TIMEOUT_MS
    })
    if (process.platform !== 'darwin') {
      return Array.from(
        new Set([
          ...(userShellCodexBinaryPath == null ? [] : [userShellCodexBinaryPath])
        ])
      )
    }

    const realHome = normalizeNonEmptyString(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
      normalizeNonEmptyString(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
      normalizeNonEmptyString(env.HOME) ??
      normalizeNonEmptyString(process.env.HOME)

    return Array.from(
      new Set([
        ...(userShellCodexBinaryPath == null ? [] : [userShellCodexBinaryPath]),
        '/Applications/Codex.app/Contents/Resources/codex',
        ...(realHome == null ? [] : [resolve(realHome, CODEX_APP_CLI_RELATIVE_PATH)])
      ])
    )
  }

  return resolvePaths()
}

/**
 * Returns the path to the codex binary.
 *
 * Resolution order:
 *   1. `__ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__` env override
 *   2. primary workspace managed CLI cache
 *   3. `<adapterPackageDir>/node_modules/.bin/codex`  (bundled compatibility fallback)
 *   4. `codex` on PATH
 */
export const resolveCodexBinaryPath = (
  env: AdapterCtx['env'],
  cwd?: string
): string =>
  resolveManagedNpmCliBinaryPath({
    adapterKey: 'codex',
    binaryName: 'codex',
    bundledPath: existsSync(bundledPath) ? bundledPath : undefined,
    cwd,
    defaultPackageName: CODEX_CLI_PACKAGE,
    defaultVersion: CODEX_CLI_VERSION,
    env
  })
