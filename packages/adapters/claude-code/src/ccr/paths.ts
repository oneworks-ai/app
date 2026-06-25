import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, resolve } from 'node:path'
import process from 'node:process'

import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'
import { resolveManagedNpmCliBinaryPath, resolveUserShellBinaryPath } from '@oneworks/utils/managed-npm-cli'

const require = createRequire(import.meta.url ?? __filename)

export const CLAUDE_CODE_CLI_PACKAGE = '@anthropic-ai/claude-code'
export const CLAUDE_CODE_CLI_VERSION = 'latest'
export const CLAUDE_CODE_CLI_COMPATIBILITY_RANGE = '>=2.1.114'
export const CLAUDE_CODE_ROUTER_CLI_PACKAGE = '@musistudio/claude-code-router'
export const CLAUDE_CODE_ROUTER_CLI_VERSION = 'latest'
export const CLAUDE_CODE_ROUTER_CLI_COMPATIBILITY_RANGE = '>=1.0.73'
const USER_SHELL_CHECK_TIMEOUT_MS = 3000

export const toRealPath = (targetPath: string) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}

const resolvePackageDir = (packageName: string) => (
  dirname(require.resolve(`${packageName}/package.json`))
)

const resolvePackageBinPath = (packageName: string, binName?: string) => {
  const packageJSONPath = require.resolve(`${packageName}/package.json`)
  const packageDir = dirname(packageJSONPath)
  const packageJSON = JSON.parse(readFileSync(packageJSONPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }

  const relativeBinPath = typeof packageJSON.bin === 'string'
    ? packageJSON.bin
    : typeof packageJSON.bin === 'object' && packageJSON.bin != null
    ? (
      (binName != null && packageJSON.bin[binName] != null)
        ? packageJSON.bin[binName]
        : Object.values(packageJSON.bin).find(value => typeof value === 'string')
    )
    : undefined

  if (relativeBinPath == null || relativeBinPath === '') {
    throw new Error(`Cannot resolve binary path for ${packageName}`)
  }

  return toRealPath(resolve(packageDir, relativeBinPath))
}

const resolvePackageBinPathOrUndefined = (packageName: string, binName?: string) => {
  try {
    return resolvePackageBinPath(packageName, binName)
  } catch {
    return undefined
  }
}

export const resolveClaudeCodeSystemBinaryPaths = async (
  env: Record<string, string | null | undefined> = process.env
) => {
  const userShellClaudePath = await resolveUserShellBinaryPath({
    binaryName: 'claude',
    env,
    timeoutMs: USER_SHELL_CHECK_TIMEOUT_MS
  })
  return userShellClaudePath == null ? [] : [userShellClaudePath]
}

export const resolveClaudeCodeRouterSystemBinaryPaths = async (
  env: Record<string, string | null | undefined> = process.env
) => {
  const userShellRouterPath = await resolveUserShellBinaryPath({
    binaryName: 'ccr',
    env,
    timeoutMs: USER_SHELL_CHECK_TIMEOUT_MS
  })
  return userShellRouterPath == null ? [] : [userShellRouterPath]
}

/**
 * Resolve the CCR (claude-code-router) binary path.
 * Resolved from the managed shared cache before adapter dependency fallback.
 */
export const resolveAdapterCliPath = (
  cwd?: string,
  env: Record<string, string | null | undefined> = process.env,
  config?: ManagedNpmCliConfig
) =>
  resolveManagedNpmCliBinaryPath({
    adapterKey: 'claude_code_router',
    binaryName: 'ccr',
    bundledPath: resolvePackageBinPathOrUndefined(CLAUDE_CODE_ROUTER_CLI_PACKAGE, 'ccr'),
    config,
    cwd,
    defaultPackageName: CLAUDE_CODE_ROUTER_CLI_PACKAGE,
    defaultVersion: CLAUDE_CODE_ROUTER_CLI_VERSION,
    env
  })

/**
 * Resolve the Claude Code binary path from managed shared cache before adapter dependency fallback.
 */
export const resolveClaudeCliPath = (
  cwd?: string,
  env: Record<string, string | null | undefined> = process.env,
  config?: ManagedNpmCliConfig
) =>
  resolveManagedNpmCliBinaryPath({
    adapterKey: 'claude_code',
    binaryName: 'claude',
    bundledPath: resolvePackageBinPathOrUndefined(CLAUDE_CODE_CLI_PACKAGE, 'claude'),
    config,
    cwd,
    defaultPackageName: CLAUDE_CODE_CLI_PACKAGE,
    defaultVersion: CLAUDE_CODE_CLI_VERSION,
    env
  })

const resolveTransformerCandidateNames = (name: string) => {
  const extension = extname(name)
  const baseName = extension === '' ? name : name.slice(0, -extension.length)

  return {
    source: [
      `${baseName}.ts`,
      `${baseName}.js`
    ],
    dist: [
      `${baseName}.js`,
      `${baseName}.mjs`,
      `${baseName}.cjs`
    ]
  }
}

export const resolveTransformerRuntimePreloadPath = () => {
  const adapterPackageDir = resolvePackageDir('@oneworks/adapter-claude-code')
  const candidates = [
    resolve(adapterPackageDir, '../../register/preload.js'),
    resolve(adapterPackageDir, '../../register/esbuild.js')
  ]

  const localRuntimePath = candidates.find(candidate => existsSync(candidate))
  if (localRuntimePath != null) {
    return toRealPath(localRuntimePath)
  }

  try {
    return toRealPath(require.resolve('esbuild-register'))
  } catch {
    return undefined
  }
}

export const resolveTransformerPath = (name: string) => {
  const adapterPackageDir = resolvePackageDir('@oneworks/adapter-claude-code')
  const candidateNames = resolveTransformerCandidateNames(name)
  const candidates = [
    ...[
      'src/ccr/transformers',
      'src/ccr-transformers',
      'ccr/transformers',
      'ccr-transformers'
    ].flatMap(baseDir =>
      candidateNames.source.map(relativePath => (
        resolve(adapterPackageDir, baseDir, relativePath)
      ))
    ),
    ...[
      'dist/ccr/transformers',
      'dist/ccr-transformers'
    ].flatMap(baseDir =>
      candidateNames.dist.map(relativePath => (
        resolve(adapterPackageDir, baseDir, relativePath)
      ))
    )
  ]

  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]
}
