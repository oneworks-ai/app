import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import type { AdapterCtx } from '@oneworks/types'
import { migrateProjectHomeSegments } from '@oneworks/utils'
import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'

import {
  CURSOR_INSTALL_URL,
  assertCursorInstallVersion,
  resolveCursorManagedBinaryPath,
  resolveCursorManagedRootDir,
  resolveCursorManagedVersionDir
} from '#~/paths.js'
import type { CursorAdapterConfig } from '../config-schema'

import { prepareCursorNativeHooks } from './native-hooks'
import { resolveCursorAdapterConfig, toProcessEnv } from './shared'

const execFileAsync = promisify(execFile)
const COMMAND_CHECK_TIMEOUT_MS = 15_000

const normalizeSource = (value: unknown) => (
  value === 'managed' || value === 'system' || value === 'path' ? value : undefined
)

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeBoolean = (value: unknown) => {
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return undefined
}

export const parseCursorInstallVersion = (installScript: string) => {
  const match = installScript.match(/versions\/([^/\s"']+)\/cursor-agent/u)
  return normalizeNonEmptyString(match?.[1])
}

const canRunCursorBinary = async (binaryPath: string, env: NodeJS.ProcessEnv) => {
  try {
    await execFileAsync(binaryPath, ['--version'], { env, timeout: COMMAND_CHECK_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

const resolveDownloadPlatform = () => {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : undefined
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined
  if (os == null || arch == null) {
    throw new Error(`Managed Cursor CLI installation is unsupported on ${process.platform}/${process.arch}.`)
  }
  return { arch, os }
}

const fetchCursorInstallScript = async () => {
  const response = await fetch(CURSOR_INSTALL_URL, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to resolve the latest Cursor CLI version (${response.status}).`)
  }
  return response.text()
}

const resolveCursorVersion = async (configuredVersion: string | undefined) => {
  if (configuredVersion != null && configuredVersion !== '' && configuredVersion !== 'latest') {
    return assertCursorInstallVersion(configuredVersion)
  }
  const version = parseCursorInstallVersion(await fetchCursorInstallScript())
  if (version == null) {
    throw new Error('Could not determine the latest Cursor CLI version from the official installer.')
  }
  return assertCursorInstallVersion(version)
}

const installManagedCursorCli = async (
  ctx: Pick<AdapterCtx, 'env' | 'logger'>,
  version: string
) => {
  const managedRoot = resolveCursorManagedRootDir(ctx.env)
  const versionsDir = resolve(managedRoot, 'versions')
  const finalDir = resolveCursorManagedVersionDir(ctx.env, version)
  const finalBinary = resolve(finalDir, 'cursor-agent')
  const probeEnv = toProcessEnv(ctx.env)

  await withDirectoryInstallLock({ lockDir: `${managedRoot}.lock` }, async () => {
    if (existsSync(finalBinary) && await canRunCursorBinary(finalBinary, probeEnv)) return

    const { arch, os } = resolveDownloadPlatform()
    const downloadUrl = `https://downloads.cursor.com/lab/${version}/${os}/${arch}/agent-cli-package.tar.gz`
    await mkdir(versionsDir, { recursive: true })
    const tempDir = await mkdtemp(resolve(versionsDir, '.tmp-'))
    const archivePath = resolve(tempDir, 'cursor-agent.tar.gz')
    const extractDir = resolve(tempDir, 'payload')

    try {
      ctx.logger.info(`Installing Cursor Agent CLI ${version} into the global bootstrap cache`)
      await mkdir(extractDir, { recursive: true })
      await execFileAsync('curl', ['-fSL', downloadUrl, '-o', archivePath], { timeout: 5 * 60_000 })
      await execFileAsync('tar', ['--strip-components=1', '-xzf', archivePath, '-C', extractDir], {
        timeout: 2 * 60_000
      })
      const extractedBinary = resolve(extractDir, 'cursor-agent')
      if (!existsSync(extractedBinary)) {
        throw new Error('The Cursor CLI archive did not contain cursor-agent.')
      }
      await chmod(extractedBinary, 0o755)
      await rm(finalDir, { recursive: true, force: true })
      await rename(extractDir, finalDir)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  if (!await canRunCursorBinary(finalBinary, probeEnv)) {
    throw new Error(`Installed Cursor CLI is not executable: ${finalBinary}`)
  }
  return finalBinary
}

export const ensureCursorCli = async (
  ctx: AdapterCtx,
  options: { defaultSource?: 'managed' | 'system' | 'path' } = {}
) => {
  const adapterConfig: CursorAdapterConfig = resolveCursorAdapterConfig(ctx)
  const source = normalizeSource(ctx.env.__ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_SOURCE__) ??
    normalizeSource(adapterConfig.cli?.source) ?? options.defaultSource ?? 'managed'
  const configuredPath = normalizeNonEmptyString(ctx.env.__ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__) ??
    normalizeNonEmptyString(adapterConfig.cliPath) ??
    normalizeNonEmptyString(adapterConfig.cli?.path)
  const configuredVersion = normalizeNonEmptyString(ctx.env.__ONEWORKS_PROJECT_ADAPTER_CURSOR_INSTALL_VERSION__) ??
    normalizeNonEmptyString(adapterConfig.cli?.version)
  const autoInstall = normalizeBoolean(ctx.env.__ONEWORKS_PROJECT_ADAPTER_CURSOR_AUTO_INSTALL__) ??
    adapterConfig.cli?.autoInstall ?? true
  const probeEnv = toProcessEnv(ctx.env)

  if (configuredPath != null) {
    if (!await canRunCursorBinary(configuredPath, probeEnv)) {
      throw new Error(`Configured Cursor CLI path is not executable: ${configuredPath}`)
    }
    ctx.env.__ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__ = configuredPath
    return configuredPath
  }
  if (source === 'path') {
    throw new Error('Cursor CLI source is set to path, but no Cursor CLI path is configured.')
  }

  if (source === 'system') {
    for (const candidate of ['agent', 'cursor-agent']) {
      if (await canRunCursorBinary(candidate, probeEnv)) {
        ctx.env.__ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__ = candidate
        return candidate
      }
    }
    throw new Error('Cursor Agent CLI was not found on PATH. Install it from https://cursor.com/docs/cli/installation.')
  }

  const version = await resolveCursorVersion(configuredVersion)
  const existingBinary = resolveCursorManagedBinaryPath(ctx.env, version)
  if (existingBinary != null && await canRunCursorBinary(existingBinary, probeEnv)) {
    ctx.env.__ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__ = existingBinary
    return existingBinary
  }
  if (!autoInstall) {
    throw new Error(`Cursor Agent CLI ${version} is not installed and automatic installation is disabled.`)
  }

  const binaryPath = await installManagedCursorCli(ctx, version)
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__ = binaryPath
  return binaryPath
}

export const initCursorAdapter = async (ctx: AdapterCtx) => {
  await migrateProjectHomeSegments(ctx.cwd, ctx.env, ['caches', '.mock'])
  prepareCursorNativeHooks(ctx)
  await ensureCursorCli(ctx)
}
