import { execFile } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { AdapterCtx } from '@oneworks/types'
import { migrateProjectHomeSegments } from '@oneworks/utils'
import {
  ensureManagedNpmCli,
  resolveManagedNpmCliInstallOptions,
  resolveUserShellBinaryPath
} from '@oneworks/utils/managed-npm-cli'

import {
  JUNIE_CLI_PACKAGE,
  JUNIE_CLI_VERSION,
  JUNIE_CLI_VERSION_RANGE,
  isJunieLauncher,
  resolveJunieBinaryPath,
  resolveJunieInstalledBinary,
  resolveJunieManagedDataDir,
  resolveJunieManagedHomeDir,
  resolveJunieUserDataDir
} from '../paths'
import { prepareJunieNativeHooks } from './native-hooks'
import { buildJunieChildEnv, resolveJunieAdapterConfig } from './shared'

const execFileAsync = promisify(execFile)

export const validateJunieVersionOutput = (output: string) => {
  const match = output.match(/Junie version:\s*(\d+)\.(\d+)\.(\d+)\s+\((\d+)\.(\d+)\)/u)
  if (match == null) {
    throw new Error('Could not parse Junie CLI version; expected the official "Junie version: 26.8.x (2651.4)" format.')
  }
  const [, major, minor, patch, buildMajor, buildMinor] = match.map(Number)
  if (major !== 26 || minor !== 8 || patch < 10 || buildMajor !== 2651 || buildMinor !== 4) {
    throw new Error(
      `Unsupported Junie CLI version ${major}.${minor}.${patch} (${buildMajor}.${buildMinor}); ` +
        'this adapter conservatively supports the 26.8 / 2651.4 json-stream contract.'
    )
  }
}

export const ensureJunieCli = async (ctx: AdapterCtx) => {
  const adapterConfig = resolveJunieAdapterConfig(ctx)
  const installOptions = resolveManagedNpmCliInstallOptions({
    adapterKey: 'junie',
    config: adapterConfig.cli,
    defaultPackageName: JUNIE_CLI_PACKAGE,
    defaultVersion: JUNIE_CLI_VERSION,
    env: ctx.env
  })
  const configuredPath = ctx.env.__ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_PATH__?.trim() ??
    adapterConfig.cli?.path?.trim()
  if (configuredPath != null && configuredPath !== '' && !isAbsolute(configuredPath)) {
    throw new Error(`Configured Junie CLI path must be absolute: ${configuredPath}`)
  }
  const source = installOptions.source ?? (configuredPath == null || configuredPath === '' ? 'managed' : 'path')
  const managedHomeDir = resolveJunieManagedHomeDir(ctx.env)
  const managedDataDir = resolveJunieManagedDataDir(ctx.env)
  const resolverEnv = buildJunieChildEnv({
    adapterConfig,
    env: ctx.env,
    includeAuth: false,
    isolated: {
      HOME: managedHomeDir,
      USERPROFILE: managedHomeDir,
      XDG_CACHE_HOME: resolve(managedHomeDir, '.cache'),
      XDG_CONFIG_HOME: resolve(managedHomeDir, '.config'),
      XDG_DATA_HOME: resolve(managedHomeDir, '.local', 'share'),
      JUNIE_HOME: managedDataDir,
      JUNIE_DATA: managedDataDir
    }
  })
  const ensuredBinaryPath = await ensureManagedNpmCli({
    adapterKey: 'junie',
    binaryName: 'junie',
    bundledPath: configuredPath || resolveJunieBinaryPath(resolverEnv, ctx.cwd),
    config: adapterConfig.cli,
    cwd: ctx.cwd,
    defaultPackageName: JUNIE_CLI_PACKAGE,
    defaultVersion: JUNIE_CLI_VERSION,
    env: resolverEnv,
    installHomeDir: source === 'managed' ? managedHomeDir : undefined,
    logger: ctx.logger,
    commandCheckTimeoutMs: 180_000,
    childEnvPolicy: 'minimal',
    versionRange: JUNIE_CLI_VERSION_RANGE
  })
  const shellBinaryPath = source === 'system' && ensuredBinaryPath === 'junie'
    ? await resolveUserShellBinaryPath({
      binaryName: 'junie',
      childEnvPolicy: 'minimal',
      env: resolverEnv,
      timeoutMs: 180_000
    })
    : undefined
  const launcherPath = shellBinaryPath ?? ensuredBinaryPath
  const distributionDataDir = source === 'managed' ? managedDataDir : resolveJunieUserDataDir(ctx.env)
  const launcherRequiresDistribution = isJunieLauncher(launcherPath)
  const installedBinaryPath = launcherRequiresDistribution
    ? resolveJunieInstalledBinary(distributionDataDir)
    : undefined
  if (launcherRequiresDistribution && installedBinaryPath == null) {
    throw new Error(
      `Junie launcher ${launcherPath} does not expose an installed executable under ${distributionDataDir}; ` +
        'reinstall Junie or configure the actual executable path.'
    )
  }
  const binaryPath = installedBinaryPath ?? launcherPath
  const probeEnv = Object.fromEntries(
    Object.entries(resolverEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
  const version = await execFileAsync(binaryPath, ['--version'], {
    cwd: ctx.cwd,
    env: probeEnv,
    timeout: 180_000
  })
  validateJunieVersionOutput(`${String(version.stdout ?? '')}\n${String(version.stderr ?? '')}`)
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_PATH__ = binaryPath
  return binaryPath
}

export const initJunieAdapter = async (ctx: AdapterCtx) => {
  await migrateProjectHomeSegments(ctx.cwd, ctx.env, ['caches'])
  prepareJunieNativeHooks(ctx)
  await ensureJunieCli(ctx)
}
