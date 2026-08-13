import { existsSync, realpathSync } from 'node:fs'
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
const CODEX_NATIVE_TARGETS: Partial<
  Record<
    NodeJS.Platform,
    Partial<
      Record<string, {
        packageName: string
        targetTriple: string
      }>
    >
  >
> = {
  darwin: {
    arm64: {
      packageName: '@openai/codex-darwin-arm64',
      targetTriple: 'aarch64-apple-darwin'
    },
    x64: {
      packageName: '@openai/codex-darwin-x64',
      targetTriple: 'x86_64-apple-darwin'
    }
  },
  linux: {
    arm64: {
      packageName: '@openai/codex-linux-arm64',
      targetTriple: 'aarch64-unknown-linux-musl'
    },
    x64: {
      packageName: '@openai/codex-linux-x64',
      targetTriple: 'x86_64-unknown-linux-musl'
    }
  },
  win32: {
    arm64: {
      packageName: '@openai/codex-win32-arm64',
      targetTriple: 'aarch64-pc-windows-msvc'
    },
    x64: {
      packageName: '@openai/codex-win32-x64',
      targetTriple: 'x86_64-pc-windows-msvc'
    }
  }
}

const readFilesystemPath = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const normalizeFilesystemPath = (value: string, platform: NodeJS.Platform = process.platform) => (
  platform === 'win32' ? value.replaceAll('\\', '/') : value
)

const resolveOfficialCodexLauncherPath = (
  binaryPath: string,
  platform: NodeJS.Platform = process.platform
) => {
  const candidates: string[] = []
  try {
    candidates.push(realpathSync(binaryPath))
  } catch {
    // A Windows command shim may not have a directly executable extension-free sibling.
  }

  const normalizedBinaryPath = normalizeFilesystemPath(binaryPath, platform)
  if (/\/node_modules\/\.bin\/codex(?:\.(?:cmd|ps1))?$/iu.test(normalizedBinaryPath)) {
    candidates.push(resolve(dirname(binaryPath), '..', '@openai', 'codex', 'bin', 'codex.js'))
  }

  return candidates.find((candidate) => (
    normalizeFilesystemPath(candidate, platform).endsWith('/@openai/codex/bin/codex.js') &&
    existsSync(candidate)
  ))
}

export const resolveOfficialCodexNativeBinaryPath = (
  binaryPath: string,
  runtime: {
    arch?: string
    platform?: NodeJS.Platform
  } = {}
) => {
  const platform = runtime.platform ?? process.platform
  const arch = runtime.arch ?? process.arch
  const nativeTarget = CODEX_NATIVE_TARGETS[platform]?.[arch]
  if (nativeTarget == null) return binaryPath

  const launcherPath = resolveOfficialCodexLauncherPath(binaryPath, platform)
  if (launcherPath == null) return binaryPath

  try {
    const launcherRequire = createRequire(launcherPath)
    const platformPackageJsonPath = launcherRequire.resolve(`${nativeTarget.packageName}/package.json`)
    const executableName = platform === 'win32' ? 'codex.exe' : 'codex'
    const nativeBinaryPath = resolve(
      dirname(platformPackageJsonPath),
      'vendor',
      nativeTarget.targetTriple,
      'bin',
      executableName
    )
    return existsSync(nativeBinaryPath) ? nativeBinaryPath : binaryPath
  } catch {
    return binaryPath
  }
}

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

    const realHome = readFilesystemPath(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
      readFilesystemPath(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
      readFilesystemPath(env.HOME) ??
      readFilesystemPath(process.env.HOME)

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
): string => {
  const binaryPath = resolveManagedNpmCliBinaryPath({
    adapterKey: 'codex',
    binaryName: 'codex',
    bundledPath: existsSync(bundledPath) ? bundledPath : undefined,
    cwd,
    defaultPackageName: CODEX_CLI_PACKAGE,
    defaultVersion: CODEX_CLI_VERSION,
    env
  })
  return resolveOfficialCodexNativeBinaryPath(binaryPath)
}
