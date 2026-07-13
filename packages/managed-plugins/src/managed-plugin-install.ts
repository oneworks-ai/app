import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { buildConfigJsonVariables, loadConfigState } from '@oneworks/config'
import { loadAdapterPluginInstaller, resolveAdapterRuntimeTarget } from '@oneworks/types'
import type {
  AdapterPluginAddOptions,
  AdapterPluginAddResult,
  AdapterPluginInstaller,
  AdapterPluginManifest
} from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { getManagedPluginConfigPath, getManagedPluginInstallDir } from '@oneworks/utils/managed-plugin'
import { mergeProcessEnvWithProjectEnv } from '@oneworks/utils/project-env'

import { installManagedPluginSource, pathExists, resolveManagedPluginSource } from './managed-plugin-source'
export { installManagedPluginSource, pathExists, resolveManagedPluginSource } from './managed-plugin-source'
export { syncConfiguredMarketplacePlugins } from './managed-plugin-sync'

const MANAGED_NATIVE_PLUGIN_DIR = 'native'
const MANAGED_ONEWORKS_PLUGIN_DIR = 'oneworks'
const MANAGED_PLUGIN_DATA_DIR = 'data'

const toPluginSlug = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin'
)

const mergeManifest = <TManifest extends AdapterPluginManifest>(
  installer: AdapterPluginInstaller<TManifest>,
  manifest: TManifest | undefined,
  overrides: Partial<TManifest> | undefined
) => {
  if (installer.mergeManifest != null) {
    return installer.mergeManifest(manifest, overrides)
  }
  if (manifest == null && overrides == null) return undefined
  return {
    ...(manifest ?? {}),
    ...(overrides ?? {})
  } as TManifest
}

const resolvePluginName = <TManifest extends AdapterPluginManifest>(
  installer: AdapterPluginInstaller<TManifest>,
  pluginRoot: string,
  manifest: TManifest | undefined
) => installer.getPluginName?.({ pluginRoot, manifest }) ?? manifest?.name?.trim() ?? path.basename(pluginRoot)

const writeInstallSummary = (summaryLines: string[]) => {
  process.stdout.write(`${summaryLines.join('\n')}\n`)
}

const resolveManagedPluginDataDir = (
  cwd: string,
  env: NodeJS.ProcessEnv,
  adapter: string,
  pluginSlug: string
) => resolveProjectHomePath(cwd, env, '.local', 'plugins', adapter, pluginSlug, MANAGED_PLUGIN_DATA_DIR)

const resolvePluginInstallEnv = (
  cwd: string,
  env: AdapterPluginAddOptions['env'] | undefined
): NodeJS.ProcessEnv => mergeProcessEnvWithProjectEnv(env, { workspaceFolder: cwd })

export const installAdapterPluginWithInstaller = async <
  TManifest extends AdapterPluginManifest = AdapterPluginManifest,
>(
  installer: AdapterPluginInstaller<TManifest>,
  options: AdapterPluginAddOptions
): Promise<AdapterPluginAddResult> => {
  const cwd = options.cwd ?? process.cwd()
  const env = resolvePluginInstallEnv(cwd, options.env)
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-plugin-'))

  try {
    const resolvedSource = await installer.resolveSource?.({
      cwd,
      env,
      requestedSource: options.source,
      tempDir,
      installSource: (targetDir, source) => installManagedPluginSource(targetDir, cwd, source)
    })
    const source = resolvedSource?.installSource ?? await (
      installer.parseSource?.(cwd, options.source) ?? resolveManagedPluginSource(cwd, options.source)
    )
    const managedSource = resolvedSource?.managedSource ?? source
    const downloadedRoot = await installManagedPluginSource(path.join(tempDir, 'plugin-source'), cwd, source)
    const pluginRoot = await installer.detectPluginRoot(downloadedRoot)
    const manifest = mergeManifest(
      installer,
      await installer.readManifest?.(pluginRoot),
      resolvedSource?.manifestOverrides
    )

    await installer.validateManifest?.({
      manifest,
      pluginRoot,
      requestedSource: options.source
    })

    const pluginName = resolvePluginName(installer, pluginRoot, manifest)
    const pluginSlug = toPluginSlug(
      managedSource.type === 'marketplace'
        ? `${managedSource.marketplace}--${pluginName}`
        : pluginName
    )
    const installDir = getManagedPluginInstallDir(cwd, installer.adapter, pluginSlug, env)
    const nativePluginDir = path.join(installDir, MANAGED_NATIVE_PLUGIN_DIR)
    const oneworksPluginDir = path.join(installDir, MANAGED_ONEWORKS_PLUGIN_DIR)
    const pluginDataDir = resolveManagedPluginDataDir(cwd, env, installer.adapter, pluginSlug)
    const managedConfigPath = getManagedPluginConfigPath(installDir)
    const installConfigExists = await pathExists(managedConfigPath)
    const installDirExists = await pathExists(installDir)
    const pluginDataDirExists = await pathExists(pluginDataDir)

    if (installConfigExists && !options.force) {
      throw new Error(`Plugin ${pluginName} is already installed at ${installDir}. Use --force to replace it.`)
    }

    const installParentDir = path.dirname(installDir)
    await fs.mkdir(installParentDir, { recursive: true })
    const stagingDir = await fs.mkdtemp(path.join(installParentDir, '.install-staging-'))
    const stagingNativePluginDir = path.join(stagingDir, MANAGED_NATIVE_PLUGIN_DIR)
    const stagingOneworksPluginDir = path.join(stagingDir, MANAGED_ONEWORKS_PLUGIN_DIR)
    const stagingConfigPath = getManagedPluginConfigPath(stagingDir)
    const backupDir = path.join(installParentDir, `.install-backup-${randomUUID()}`)

    const config = {
      version: 1 as const,
      adapter: installer.adapter,
      name: pluginName,
      scope: options.scope?.trim() !== '' ? options.scope?.trim() : pluginName,
      installedAt: new Date().toISOString(),
      source: managedSource,
      nativePluginPath: MANAGED_NATIVE_PLUGIN_DIR,
      oneworksPluginPath: MANAGED_ONEWORKS_PLUGIN_DIR
    }

    try {
      await fs.mkdir(pluginDataDir, { recursive: true })
      await fs.cp(pluginRoot, stagingNativePluginDir, { recursive: true })
      await fs.mkdir(stagingOneworksPluginDir, { recursive: true })
      await installer.convertToOneWorks({
        nativePluginRoot: stagingNativePluginDir,
        oneworksRoot: stagingOneworksPluginDir,
        pluginName,
        pluginDataDir,
        manifest
      })
      await fs.writeFile(stagingConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true })
      if (!pluginDataDirExists) {
        await fs.rm(pluginDataDir, { recursive: true, force: true })
      }
      throw error
    }

    let existingInstallMoved = false
    try {
      if (installDirExists) {
        await fs.rename(installDir, backupDir)
        existingInstallMoved = true
      }
      await fs.rename(stagingDir, installDir)
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true })
      if (existingInstallMoved && !await pathExists(installDir)) {
        await fs.rename(backupDir, installDir)
      }
      if (!pluginDataDirExists) {
        await fs.rm(pluginDataDir, { recursive: true, force: true })
      }
      throw error
    }
    if (existingInstallMoved) {
      try {
        await fs.rm(backupDir, { recursive: true, force: true })
      } catch (error) {
        process.stderr.write(
          `Warning: installed ${pluginName}, but could not remove backup ${backupDir}: ${String(error)}\n`
        )
      }
    }

    if (options.silent !== true) {
      writeInstallSummary(
        installer.formatInstallSummary?.({
          pluginName,
          installDir,
          nativePluginDir,
          oneworksPluginDir
        }) ?? [
          `Installed ${installer.displayName ?? installer.adapter} plugin: ${pluginName}`,
          `  Native: ${nativePluginDir}`,
          `  OneWorks: ${oneworksPluginDir}`
        ]
      )
    }

    return {
      config,
      installDir,
      nativePluginDir,
      workspacePluginDir: oneworksPluginDir
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

export const addAdapterPlugin = async (
  adapter: string,
  options: AdapterPluginAddOptions
): Promise<AdapterPluginAddResult> => {
  const cwd = options.cwd ?? process.cwd()
  const env = resolvePluginInstallEnv(cwd, options.env)
  const configState = await loadConfigState({
    cwd,
    env,
    jsonVariables: buildConfigJsonVariables(cwd, env)
  })
  const adapterTarget = resolveAdapterRuntimeTarget(adapter, {
    config: configState.mergedConfig,
    cwd
  })
  const installer = await loadAdapterPluginInstaller(adapterTarget.loadSpecifier)
  return installAdapterPluginWithInstaller(installer, options)
}
