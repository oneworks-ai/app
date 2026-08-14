/* eslint-disable max-lines -- managed provenance, composition, and source policy share one resolver. */
import { constants, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx } from '@oneworks/types'
import {
  ensureManagedNpmCli,
  resolveManagedNpmCliInstallOptions,
  resolveManagedNpmCliPaths,
  resolveUserShellBinaryPath
} from '@oneworks/utils/managed-npm-cli'

import { resolveDshAdapterConfig } from './config'

export const DSH_ACP_PACKAGE = '@deepseek-ai/dsh-acp-demo'
export const DSH_VERSION = '0.1.0-rc.6'
export const DSH_BINARY = 'dsh-acp-demo'

export const DSH_OFFICIAL_COMPOSITION_PACKAGES = [
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-sandbox-local',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-pwsh-sandbox',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-fs-observation-policy',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-todo'
] as const

const readPackageVersion = (installDir: string, packageName: string) => {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(installDir, 'node_modules', packageName, 'package.json'), 'utf8')
    ) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

const isOfficialCompositionComplete = (installDir: string, version: string) => {
  if (
    readPackageVersion(installDir, DSH_ACP_PACKAGE) !== version ||
    !DSH_OFFICIAL_COMPOSITION_PACKAGES.every(packageName => readPackageVersion(installDir, packageName) === version)
  ) return false
  try {
    const scopeDir = resolve(installDir, 'node_modules', '@deepseek-ai')
    return readdirSync(scopeDir, { withFileTypes: true })
      .filter(entry => entry.name.startsWith('dsh-') && statSync(resolve(scopeDir, entry.name)).isDirectory())
      .every(entry => readPackageVersion(installDir, `@deepseek-ai/${entry.name}`) === version)
  } catch {
    return false
  }
}

const normalizeExistingPath = (value: string) => {
  try {
    return realpathSync(value)
  } catch {
    return resolve(value)
  }
}

const isExecutableFile = async (value: string) => {
  try {
    if (!statSync(value).isFile()) return false
    if (process.platform !== 'win32') await access(value, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const DSH_INSTALL_ENV_ALLOW_KEYS = [
  'ALL_PROXY',
  'ComSpec',
  'FORCE_COLOR',
  'HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NO_COLOR',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE'
]

export const resolveDshCli = async (
  ctx: AdapterCtx,
  options: { defaultSource?: 'managed' | 'system' | 'path' } = {}
) => {
  if (process.platform === 'win32') {
    throw new Error(
      'DSH adapter currently supports macOS and Linux only; Windows npm .cmd launch is not yet verified.'
    )
  }
  const adapterConfig = resolveDshAdapterConfig(ctx)
  const rawConfig = { ...adapterConfig.cli }
  const initialInstallOptions = resolveManagedNpmCliInstallOptions({
    adapterKey: 'dsh',
    defaultPackageName: DSH_ACP_PACKAGE,
    defaultVersion: DSH_VERSION,
    env: ctx.env,
    config: { ...rawConfig, source: rawConfig.source ?? options.defaultSource }
  })
  const envExplicitPath = ctx.env.__ONEWORKS_PROJECT_ADAPTER_DSH_CLI_PATH__?.trim()
  const explicitPath = envExplicitPath ?? rawConfig.path?.trim()
  if (initialInstallOptions.source === 'path' && !explicitPath) {
    throw new Error('DSH CLI source is set to path, but no DSH CLI path is configured.')
  }
  const normalizedExplicitPath = explicitPath == null
    ? undefined
    : (isAbsolute(explicitPath) ? explicitPath : resolve(ctx.cwd, explicitPath))
  if (
    initialInstallOptions.source === 'path' && normalizedExplicitPath != null &&
    !await isExecutableFile(normalizedExplicitPath)
  ) {
    throw new Error(`DSH CLI path is not an executable file: ${normalizedExplicitPath}`)
  }
  const config = {
    ...rawConfig,
    ...(normalizedExplicitPath == null ? {} : { path: normalizedExplicitPath }),
    source: initialInstallOptions.source
  }
  const managedEnv = { ...ctx.env }
  if (normalizedExplicitPath != null) {
    managedEnv.__ONEWORKS_PROJECT_ADAPTER_DSH_CLI_PATH__ = normalizedExplicitPath
  }
  const installOptions = resolveManagedNpmCliInstallOptions({
    adapterKey: 'dsh',
    defaultPackageName: DSH_ACP_PACKAGE,
    defaultVersion: DSH_VERSION,
    env: managedEnv,
    config
  })
  const paths = resolveManagedNpmCliPaths({
    adapterKey: 'dsh',
    binaryName: DSH_BINARY,
    cwd: ctx.cwd,
    env: managedEnv,
    installKey: ['official-acp-composition-v1'],
    packageName: installOptions.packageName,
    version: installOptions.version
  })
  const useOfficialComposition = installOptions.packageName === DSH_ACP_PACKAGE
  if (
    useOfficialComposition &&
    installOptions.source !== 'system' &&
    installOptions.source !== 'path' &&
    installOptions.version !== DSH_VERSION
  ) {
    throw new Error(`DSH managed mode requires the verified official version ${DSH_VERSION}.`)
  }
  if (!useOfficialComposition && installOptions.source !== 'system' && installOptions.source !== 'path') {
    throw new Error(
      `DSH managed mode requires the official ${DSH_ACP_PACKAGE} package composition; ` +
        'use cli.source=system or cli.source=path for a custom binary.'
    )
  }
  if (installOptions.source === 'system') {
    const systemBinaryPath = await resolveUserShellBinaryPath({
      binaryName: DSH_BINARY,
      env: managedEnv,
      omitKeys: ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL']
    })
    if (systemBinaryPath == null || !await isExecutableFile(systemBinaryPath)) {
      throw new Error(`${DSH_BINARY} CLI was not found on PATH.`)
    }
    return { binaryPath: systemBinaryPath, provenance: 'custom' as const }
  }
  const companionPackageSpecs = useOfficialComposition
    ? DSH_OFFICIAL_COMPOSITION_PACKAGES.map(packageName => `${packageName}@${installOptions.version}`)
    : []

  const binaryPath = await ensureManagedNpmCli({
    adapterKey: 'dsh',
    binaryName: DSH_BINARY,
    companionPackageSpecs,
    config,
    cwd: ctx.cwd,
    defaultPackageName: DSH_ACP_PACKAGE,
    defaultVersion: DSH_VERSION,
    env: managedEnv,
    installKey: ['official-acp-composition-v1'],
    logger: ctx.logger,
    migrateLegacyInstall: false,
    subprocessEnvAllowKeys: DSH_INSTALL_ENV_ALLOW_KEYS,
    subprocessEnvOmitKeys: ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'],
    validateBinary: async (binaryPath, env) => {
      if (normalizeExistingPath(binaryPath) === normalizeExistingPath(paths.binaryPath)) {
        return await isExecutableFile(binaryPath) && (
          !useOfficialComposition ||
          isOfficialCompositionComplete(dirname(dirname(dirname(binaryPath))), installOptions.version)
        )
      }
      if (binaryPath.includes('/') || binaryPath.includes('\\')) return isExecutableFile(binaryPath)
      return await resolveUserShellBinaryPath({
        binaryName: binaryPath,
        env,
        omitKeys: ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL']
      }) != null
    }
  })
  const officialManagedBinary = normalizeExistingPath(binaryPath) === normalizeExistingPath(paths.binaryPath) &&
    useOfficialComposition && await isExecutableFile(binaryPath) &&
    isOfficialCompositionComplete(paths.installDir, DSH_VERSION)
  return { binaryPath, provenance: officialManagedBinary ? 'managed-official' as const : 'custom' as const }
}

export const ensureDshCli = async (
  ctx: AdapterCtx,
  options: { defaultSource?: 'managed' | 'system' | 'path' } = {}
) => (await resolveDshCli(ctx, options)).binaryPath

export const initDshAdapter = async (ctx: AdapterCtx) => {
  const resolved = await resolveDshCli(ctx, { defaultSource: 'managed' })
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_DSH_CLI_PATH__ = resolved.binaryPath
  if (resolved.provenance === 'managed-official') {
    ctx.env.__ONEWORKS_PROJECT_ADAPTER_DSH_CLI_PROVENANCE__ = 'managed-official'
  } else {
    delete ctx.env.__ONEWORKS_PROJECT_ADAPTER_DSH_CLI_PROVENANCE__
  }
}
