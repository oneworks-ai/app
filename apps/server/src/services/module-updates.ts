/* eslint-disable max-lines -- module update management owns registry lookup, cache install, and response mapping. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { updateConfigFile } from '@oneworks/config'
import { isModuleUpdateChannel, resolveAdapterPackageName } from '@oneworks/types'
import type {
  Config,
  ModuleUpdateActivation,
  ModuleUpdateChangelog,
  ModuleUpdateChannel,
  ModuleUpdateChannelSettings,
  ModuleUpdateGroup,
  ModuleUpdateInstallResponse,
  ModuleUpdateItem,
  ModuleUpdateKind,
  ModuleUpdateSettingsPatch,
  ModuleUpdatesResponse
} from '@oneworks/types'

import {
  readPackageInfo,
  readPackageInfoSync,
  resolveAdapterPackageCacheDir,
  resolveAdapterPackageInstallDir,
  resolveBootstrapDataDir,
  resolveGenericPackageCacheDir,
  resolveGenericPackageInstallDir,
  sanitizeModulePackageName,
  writeActiveModulePackage
} from '#~/module-update-cache.js'

import { loadConfigState } from './config/index.js'

const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const DEFAULT_NPM_VIEW_TIMEOUT_MS = 45_000

interface ModuleUpdateTarget {
  activation: ModuleUpdateActivation
  group: ModuleUpdateGroup
  id: string
  kind: ModuleUpdateKind
  label: string
  packageName: string
}

interface TargetChannelResolution {
  channel: ModuleUpdateChannel
  configuredChannel?: ModuleUpdateChannel
}
interface ModuleUpdateCheckOptions {
  language?: string
}

interface RunBufferedCommandOptions {
  args: string[]
  command: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

const nodeRequire = createRequire(__filename)

const moduleUpdateTargets: ModuleUpdateTarget[] = [
  {
    activation: 'restart',
    group: 'core',
    id: 'web',
    kind: 'runtime',
    label: 'Web shell',
    packageName: '@oneworks/web'
  },
  {
    activation: 'restart',
    group: 'core',
    id: 'client',
    kind: 'client',
    label: 'Client UI',
    packageName: '@oneworks/client'
  },
  {
    activation: 'restart',
    group: 'core',
    id: 'server',
    kind: 'server',
    label: 'Server',
    packageName: '@oneworks/server'
  },
  ...[
    ['claude-code', 'Claude Code adapter'],
    ['codex', 'Codex adapter'],
    ['copilot', 'Copilot adapter'],
    ['gemini', 'Gemini adapter'],
    ['kimi', 'Kimi adapter'],
    ['opencode', 'OpenCode adapter']
  ].map(([adapter, label]) => ({
    activation: 'new-session' as const,
    group: 'adapter' as const,
    id: `adapter:${adapter}`,
    kind: 'adapter' as const,
    label,
    packageName: resolveAdapterPackageName(adapter)
  })),
  ...[
    ['chrome-devtools', 'Chrome DevTools plugin'],
    ['cli-skills', 'CLI Skills plugin'],
    ['demo', 'Demo plugin'],
    ['demo-extension', 'Demo extension plugin'],
    ['logger', 'Logger plugin'],
    ['standard-dev', 'Standard Dev plugin']
  ].map(([plugin, label]) => ({
    activation: 'restart' as const,
    group: 'plugin' as const,
    id: `plugin:${plugin}`,
    kind: 'plugin' as const,
    label,
    packageName: `@oneworks/plugin-${plugin}`
  }))
]

const unique = <T>(values: T[]) => [...new Set(values)]

const compareVersionLike = (left: string, right: string) => (
  left.localeCompare(right, 'en', {
    numeric: true,
    sensitivity: 'base'
  })
)

const parseVersionForComparison = (version: string) => {
  const normalizedVersion = version.trim().replace(/^v/i, '').split('+')[0]
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9a-z-.]+))?$/i.exec(normalizedVersion)
  if (match == null) return undefined

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? '0'),
    patch: Number(match[3] ?? '0'),
    prerelease: match[4]?.split('.').filter(Boolean) ?? []
  }
}

const comparePrereleaseIdentifier = (left: string, right: string) => {
  const leftIsNumeric = /^\d+$/.test(left)
  const rightIsNumeric = /^\d+$/.test(right)
  if (leftIsNumeric && rightIsNumeric) return Number(left) - Number(right)
  if (leftIsNumeric !== rightIsNumeric) return leftIsNumeric ? -1 : 1
  return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })
}

const compareVersionPrecedence = (left: string, right: string) => {
  const leftVersion = parseVersionForComparison(left)
  const rightVersion = parseVersionForComparison(right)
  if (leftVersion == null || rightVersion == null) return compareVersionLike(left, right)

  for (const key of ['major', 'minor', 'patch'] as const) {
    const diff = leftVersion[key] - rightVersion[key]
    if (diff !== 0) return diff
  }

  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) return 0
  if (leftVersion.prerelease.length === 0) return 1
  if (rightVersion.prerelease.length === 0) return -1

  const identifierCount = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index]
    const rightIdentifier = rightVersion.prerelease[index]
    if (leftIdentifier == null) return -1
    if (rightIdentifier == null) return 1
    const diff = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier)
    if (diff !== 0) return diff
  }
  return 0
}

const resolveHighestVersion = (versions: Array<string | undefined>) => (
  versions
    .filter((version): version is string => version != null)
    .sort((left, right) => compareVersionPrecedence(right, left))[0]
)

const resolveNpmTag = (channel: ModuleUpdateChannel) => channel === 'stable' ? 'latest' : channel

const normalizeNpmTagToChannel = (value: string | undefined): ModuleUpdateChannel | undefined => {
  const tag = value?.trim().toLowerCase()
  if (tag == null || tag === '') return undefined
  if (tag === 'latest') return 'stable'
  return isModuleUpdateChannel(tag) ? tag : undefined
}

const normalizeModuleUpdateChannelMap = (value: unknown): Record<string, ModuleUpdateChannel> => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, ModuleUpdateChannel>>(
    (acc, [key, channel]) => {
      const normalizedKey = key.trim()
      if (normalizedKey === '' || !isModuleUpdateChannel(channel)) return acc
      acc[normalizedKey] = channel
      return acc
    },
    {}
  )
}

const resolveProjectNpmrc = () => {
  const projectNpmrc = path.resolve(process.cwd(), '.npmrc')
  return existsSync(projectNpmrc) ? projectNpmrc : undefined
}

const resolvePackageManagerEnv = (cacheSubdir: string): NodeJS.ProcessEnv => {
  const bootstrapDataDir = resolveBootstrapDataDir()
  const userConfig = process.env.npm_config_userconfig ?? process.env.NPM_CONFIG_USERCONFIG ?? resolveProjectNpmrc()

  return {
    ...process.env,
    HOME: process.env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.HOME,
    USERPROFILE: process.env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.USERPROFILE,
    npm_config_cache: path.join(bootstrapDataDir, cacheSubdir),
    npm_config_replace_registry_host: 'never',
    npm_config_update_notifier: 'false',
    NPM_CONFIG_REPLACE_REGISTRY_HOST: 'never',
    ...(userConfig != null
      ? {
        NPM_CONFIG_USERCONFIG: userConfig,
        npm_config_userconfig: userConfig
      }
      : {})
  }
}

const runBufferedCommand = async (input: RunBufferedCommandOptions) => {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: 'pipe'
  })

  let stdout = ''
  let stderr = ''
  let killTimeout: NodeJS.Timeout | undefined
  const timeout = input.timeoutMs != null && input.timeoutMs > 0
    ? setTimeout(() => {
      child.kill('SIGTERM')
      killTimeout = setTimeout(() => {
        if (child.exitCode == null && child.signalCode == null) {
          child.kill('SIGKILL')
        }
      }, 1_000)
      killTimeout.unref()
    }, input.timeoutMs)
    : undefined

  child.stdout?.on('data', chunk => {
    stdout += String(chunk)
  })
  child.stderr?.on('data', chunk => {
    stderr += String(chunk)
  })

  return await new Promise<{ code: number; stderr: string; stdout: string }>((resolve, reject) => {
    child.once('error', (error) => {
      if (timeout != null) clearTimeout(timeout)
      if (killTimeout != null) clearTimeout(killTimeout)
      reject(error)
    })
    child.once('exit', (code) => {
      if (timeout != null) clearTimeout(timeout)
      if (killTimeout != null) clearTimeout(killTimeout)
      resolve({
        code: code ?? 0,
        stderr,
        stdout
      })
    })
  })
}

const parseVersionOutput = (spec: string, output: string) => {
  const normalizedOutput = output.trim()
  if (!normalizedOutput) {
    throw new Error(`No version was returned for ${spec}.`)
  }

  try {
    const parsed = JSON.parse(normalizedOutput) as unknown
    if (typeof parsed === 'string' && parsed.trim()) {
      return parsed.trim()
    }
    if (Array.isArray(parsed)) {
      const versions = parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      const latestVersion = resolveHighestVersion(versions)
      if (latestVersion != null) return latestVersion
    }
  } catch {
    // Fall through to unquoted output parsing.
  }

  const unquotedOutput = normalizedOutput.replace(/^"|"$/g, '').trim()
  if (!unquotedOutput) {
    throw new Error(`Invalid published version for ${spec}: ${normalizedOutput}`)
  }
  return unquotedOutput
}

const resolvePublishedPackageVersion = async (packageName: string, npmTag: string) => {
  const spec = `${packageName}@${npmTag}`
  const result = await runBufferedCommand({
    args: ['view', spec, 'version', '--json'],
    command: NPM_BIN,
    env: resolvePackageManagerEnv('npm-cache'),
    timeoutMs: DEFAULT_NPM_VIEW_TIMEOUT_MS
  })
  if (result.code !== 0) {
    throw new Error(`Failed to resolve ${spec}:\n${result.stderr.trim()}`)
  }
  return parseVersionOutput(spec, result.stdout)
}

const resolveRuntimePackageJsonCandidates = (packageName: string) => {
  const packageDir = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__?.trim()
  const candidates = [
    packageDir == null || packageDir === '' ? undefined : path.join(packageDir, 'package.json')
  ].filter((candidate): candidate is string => candidate != null)

  const requireBases = unique([
    packageDir == null || packageDir === '' ? undefined : path.join(packageDir, '__oneworks_module_updates__.cjs'),
    path.join(process.cwd(), '__oneworks_module_updates__.cjs'),
    __filename
  ].filter((value): value is string => value != null))

  for (const base of requireBases) {
    try {
      const packageJsonPath = createRequire(base).resolve(`${packageName}/package.json`)
      candidates.push(packageJsonPath)
    } catch {
      // Continue through package resolution fallbacks.
    }
  }

  try {
    candidates.push(nodeRequire.resolve(`${packageName}/package.json`))
  } catch {
    // Ignore unresolved optional modules.
  }

  return unique(candidates)
}

const readCurrentPackageVersion = (packageName: string) => {
  for (const packageJsonPath of resolveRuntimePackageJsonCandidates(packageName)) {
    const info = readPackageInfoSync(packageJsonPath)
    if (info?.name === packageName && info.version != null) {
      return info.version
    }
  }
  return undefined
}

const inferChannelFromVersion = (version: string | undefined): ModuleUpdateChannel | undefined => {
  if (version == null) return undefined
  const parsedVersion = parseVersionForComparison(version)
  for (const identifier of parsedVersion?.prerelease ?? []) {
    const normalizedIdentifier = identifier.toLowerCase()
    if (isModuleUpdateChannel(normalizedIdentifier)) return normalizedIdentifier
  }
  return parsedVersion == null ? undefined : 'stable'
}

const inferDefaultModuleUpdateChannel = (): ModuleUpdateChannel => (
  moduleUpdateTargets
    .map(target => inferChannelFromVersion(readCurrentPackageVersion(target.packageName)))
    .find((channel): channel is ModuleUpdateChannel => channel != null) ?? 'stable'
)

const resolveModuleUpdateChannelSettings = async (): Promise<ModuleUpdateChannelSettings> => {
  const envChannel = normalizeNpmTagToChannel(process.env.ONEWORKS_MODULE_UPDATE_CHANNEL) ??
    normalizeNpmTagToChannel(process.env.ONEWORKS_BOOTSTRAP_PACKAGE_TAG)

  try {
    const { mergedConfig } = await loadConfigState()
    return {
      defaultChannel: envChannel ??
        (isModuleUpdateChannel(mergedConfig.desktop?.updateChannel)
          ? mergedConfig.desktop.updateChannel
          : inferDefaultModuleUpdateChannel()),
      moduleChannels: normalizeModuleUpdateChannelMap(mergedConfig.desktop?.moduleUpdateChannels)
    }
  } catch (error) {
    console.warn('[module-updates] failed to load update channel config', error)
    return {
      defaultChannel: envChannel ?? inferDefaultModuleUpdateChannel(),
      moduleChannels: {}
    }
  }
}

const resolveTargetChannel = (
  settings: ModuleUpdateChannelSettings,
  target: ModuleUpdateTarget
): TargetChannelResolution => {
  const configuredChannel = settings.moduleChannels[target.id] ?? settings.moduleChannels[target.packageName]
  return {
    channel: configuredChannel ?? settings.defaultChannel,
    ...(configuredChannel == null ? {} : { configuredChannel })
  }
}

const findCachedPackageVersion = (target: ModuleUpdateTarget) => {
  const cacheRoot = target.kind === 'adapter'
    ? path.join(resolveBootstrapDataDir(), 'adapter-packages', sanitizeModulePackageName(target.packageName))
    : path.join(resolveBootstrapDataDir(), 'npm', sanitizeModulePackageName(target.packageName))
  let versions: string[]
  try {
    versions = readdirSync(cacheRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return undefined
  }

  return versions
    .map((version) => {
      const cacheDir = path.join(cacheRoot, version)
      const packageDir = target.kind === 'adapter'
        ? resolveAdapterPackageInstallDir(cacheDir, target.packageName)
        : resolveGenericPackageInstallDir(cacheDir, target.packageName)
      const info = readPackageInfoSync(path.join(packageDir, 'package.json'))
      return info?.name === target.packageName && info.version === version ? version : undefined
    })
    .filter((version): version is string => version != null)
    .sort((left, right) => compareVersionPrecedence(right, left))[0]
}

const normalizeChangelogPackageName = (packageName: string) => (
  packageName
    .replace(/^@oneworks\//, '')
    .replace(/^@/, '')
    .replace(/\//g, '-')
)

const normalizeChangelogLanguageToken = (value: string) => {
  const normalized = value
    .split(';')[0]
    ?.trim()
    .replaceAll('_', '-')
    .toLowerCase()
  if (normalized == null || normalized === '' || !/^[a-z]{2}(?:-[a-z0-9]+)*$/.test(normalized)) {
    return undefined
  }
  return normalized
}

const resolveChangelogLanguageCandidates = (language: string | undefined) => {
  const candidates = (language ?? '')
    .split(',')
    .flatMap((part) => {
      const normalized = normalizeChangelogLanguageToken(part)
      if (normalized == null) return []
      const baseLanguage = normalized.split('-')[0]
      return baseLanguage == null || baseLanguage === normalized
        ? [normalized]
        : [normalized, baseLanguage]
    })
  return unique(candidates)
}

const encodeChangelogAssetPath = (filePath: string) => Buffer.from(filePath, 'utf8').toString('base64url')

const decodeChangelogAssetPath = (value: string) => Buffer.from(value, 'base64url').toString('utf8')

const isExternalMarkdownUrl = (value: string) => (
  /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(value)
)

const rewriteChangelogImageUrls = (body: string, changelogFilePath: string) => (
  body.replace(
    /(!\[[^\]]*\]\()([^)\s]+)((?:\s+["'][^"']*["'])?\))/g,
    (match: string, prefix: string, rawUrl: string, suffix: string) => {
      if (isExternalMarkdownUrl(rawUrl)) return match
      let decodedUrl = rawUrl
      try {
        decodedUrl = decodeURIComponent(rawUrl)
      } catch {
        // Keep the original URL if it is not URI-encoded.
      }
      const resolvedAssetPath = path.resolve(path.dirname(changelogFilePath), decodedUrl)
      const changelogDir = path.dirname(changelogFilePath)
      if (resolvedAssetPath !== changelogDir && !resolvedAssetPath.startsWith(`${changelogDir}${path.sep}`)) {
        return match
      }
      return `${prefix}/api/module-updates/changelog-assets/${encodeChangelogAssetPath(resolvedAssetPath)}${suffix}`
    }
  )
)

export const resolveModuleUpdateChangelogAsset = async (encodedPath: string) => {
  let decodedPath: string
  try {
    decodedPath = decodeChangelogAssetPath(encodedPath)
  } catch {
    throw new Error('Invalid changelog asset path')
  }

  const resolvedPath = path.resolve(decodedPath)
  const allowedRoots = resolveChangelogRootCandidates().map(root => path.resolve(root))
  const isAllowed = allowedRoots.some(root => resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`))
  if (!isAllowed) {
    throw new Error('Changelog asset is outside allowed changelog roots')
  }

  const info = await stat(resolvedPath)
  if (!info.isFile()) {
    throw new Error('Changelog asset is not a file')
  }

  return { filePath: resolvedPath }
}

const resolveChangelogRootCandidates = () =>
  unique([
    path.resolve(process.cwd(), 'changelog'),
    process.env.__ONEWORKS_PROJECT_ROOT__ == null
      ? undefined
      : path.resolve(process.env.__ONEWORKS_PROJECT_ROOT__, 'changelog'),
    process.env.__ONEWORKS_REPO_ROOT__ == null
      ? undefined
      : path.resolve(process.env.__ONEWORKS_REPO_ROOT__, 'changelog')
  ].filter((candidate): candidate is string => candidate != null))

const listChangelogVersions = (changelogRoot: string) => {
  try {
    return readdirSync(changelogRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

const readFirstExistingChangelogFile = async (paths: string[]) => {
  for (const filePath of paths) {
    try {
      return {
        body: await readFile(filePath, 'utf8'),
        path: filePath
      }
    } catch {
      // Continue through package-specific and release-summary fallbacks.
    }
  }
  return undefined
}

const resolveModuleUpdateChangelog = async (
  target: ModuleUpdateTarget,
  fromVersion: string | undefined,
  toVersion: string | undefined,
  options: ModuleUpdateCheckOptions = {}
): Promise<ModuleUpdateChangelog | undefined> => {
  if (fromVersion == null || toVersion == null || compareVersionPrecedence(toVersion, fromVersion) <= 0) {
    return undefined
  }

  const packageSlug = normalizeChangelogPackageName(target.packageName)
  const languageCandidates = resolveChangelogLanguageCandidates(options.language)
  const entries: ModuleUpdateChangelog['entries'] = []

  for (const changelogRoot of resolveChangelogRootCandidates()) {
    const versions = listChangelogVersions(changelogRoot)
      .filter(version => compareVersionPrecedence(version, fromVersion) > 0)
      .filter(version => compareVersionPrecedence(version, toVersion) <= 0)
      .sort(compareVersionPrecedence)

    for (const version of versions) {
      const entry = await readFirstExistingChangelogFile([
        ...languageCandidates.map(language => path.join(changelogRoot, version, `${packageSlug}.${language}.md`)),
        path.join(changelogRoot, version, `${packageSlug}.md`),
        ...languageCandidates.map(language => path.join(changelogRoot, version, `readme.${language}.md`)),
        path.join(changelogRoot, version, 'readme.md')
      ])
      if (entry == null) continue
      entries.push({
        body: rewriteChangelogImageUrls(entry.body.trim(), entry.path),
        path: path.relative(process.cwd(), entry.path),
        version
      })
    }
    if (entries.length > 0) break
  }

  return {
    entries,
    fromVersion,
    toVersion
  }
}

const buildModuleUpdateItem = (input: {
  cachedVersion?: string
  channel: ModuleUpdateChannel
  changelog?: ModuleUpdateChangelog
  configuredChannel?: ModuleUpdateChannel
  currentVersion?: string
  errorMessage?: string
  latestVersion?: string
  npmTag: string
  target: ModuleUpdateTarget
}): ModuleUpdateItem => {
  const { cachedVersion, currentVersion, latestVersion, target } = input
  const currentOrCachedVersion = resolveHighestVersion([currentVersion, cachedVersion])
  const cachedIsNewerThanCurrent = cachedVersion != null &&
    (currentVersion == null || compareVersionPrecedence(cachedVersion, currentVersion) > 0)
  const updateAvailable = latestVersion != null && (
    currentOrCachedVersion == null || compareVersionPrecedence(latestVersion, currentOrCachedVersion) > 0
  )

  return {
    activation: target.activation,
    ...(cachedVersion == null ? {} : { cachedVersion }),
    channel: input.channel,
    ...(input.changelog == null ? {} : { changelog: input.changelog }),
    ...(input.configuredChannel == null ? {} : { configuredChannel: input.configuredChannel }),
    ...(currentVersion == null ? {} : { currentVersion }),
    ...(input.errorMessage == null ? {} : { errorMessage: input.errorMessage }),
    group: target.group,
    id: target.id,
    kind: target.kind,
    label: target.label,
    ...(latestVersion == null ? {} : { latestVersion }),
    needsActivation: target.kind !== 'adapter' && cachedIsNewerThanCurrent,
    npmTag: input.npmTag,
    packageName: target.packageName,
    updateAvailable
  }
}

const resolveModuleUpdateItem = async (
  target: ModuleUpdateTarget,
  channel: ModuleUpdateChannel,
  configuredChannel?: ModuleUpdateChannel,
  options: ModuleUpdateCheckOptions = {}
) => {
  const npmTag = resolveNpmTag(channel)
  const currentVersion = readCurrentPackageVersion(target.packageName)
  const cachedVersion = findCachedPackageVersion(target)
  try {
    const latestVersion = await resolvePublishedPackageVersion(target.packageName, npmTag)
    const installedVersion = resolveHighestVersion([currentVersion, cachedVersion])
    const changelog = await resolveModuleUpdateChangelog(target, installedVersion, latestVersion, options)
    return buildModuleUpdateItem({
      cachedVersion,
      channel,
      changelog,
      configuredChannel,
      currentVersion,
      latestVersion,
      npmTag,
      target
    })
  } catch (error) {
    return buildModuleUpdateItem({
      cachedVersion,
      channel,
      configuredChannel,
      currentVersion,
      errorMessage: error instanceof Error ? error.message : String(error),
      npmTag,
      target
    })
  }
}

export const checkModuleUpdates = async (
  options: ModuleUpdateCheckOptions = {}
): Promise<ModuleUpdatesResponse> => {
  const settings = await resolveModuleUpdateChannelSettings()
  const npmTag = resolveNpmTag(settings.defaultChannel)
  const modules = await Promise.all(moduleUpdateTargets.map((target) => {
    const { channel, configuredChannel } = resolveTargetChannel(settings, target)
    return resolveModuleUpdateItem(target, channel, configuredChannel, options)
  }))

  return {
    checkedAt: new Date().toISOString(),
    channel: settings.defaultChannel,
    moduleChannels: settings.moduleChannels,
    modules,
    npmTag
  }
}

const getModuleUpdateTarget = (id: string) => (
  moduleUpdateTargets.find(target => target.id === id)
)

const getValidModuleUpdateChannelKeys = () =>
  new Set(
    moduleUpdateTargets.flatMap(target => [target.id, target.packageName])
  )

const pickProjectDesktopUpdateConfig = (desktopConfig: Config['desktop'] | undefined): Config['desktop'] => {
  if (desktopConfig == null) return {}
  return {
    ...(typeof desktopConfig.autoUpdate === 'boolean' ? { autoUpdate: desktopConfig.autoUpdate } : {}),
    ...(isModuleUpdateChannel(desktopConfig.updateChannel) ? { updateChannel: desktopConfig.updateChannel } : {}),
    moduleUpdateChannels: normalizeModuleUpdateChannelMap(desktopConfig.moduleUpdateChannels)
  }
}

const normalizeSettingsPatch = (input: ModuleUpdateSettingsPatch) => {
  const defaultChannel = input.defaultChannel
  if (defaultChannel != null && !isModuleUpdateChannel(defaultChannel)) {
    throw new Error(`Invalid default module update channel: ${defaultChannel}`)
  }

  const validKeys = getValidModuleUpdateChannelKeys()
  const moduleChannels = Object.entries(input.moduleChannels ?? {}).reduce<Record<string, ModuleUpdateChannel | null>>(
    (acc, [key, channel]) => {
      const normalizedKey = key.trim()
      if (normalizedKey === '') return acc
      if (!validKeys.has(normalizedKey)) {
        throw new Error(`Unknown module update channel target: ${normalizedKey}`)
      }
      if (channel == null) {
        acc[normalizedKey] = null
        return acc
      }
      if (!isModuleUpdateChannel(channel)) {
        throw new Error(`Invalid module update channel for ${normalizedKey}: ${channel}`)
      }
      acc[normalizedKey] = channel
      return acc
    },
    {}
  )

  return {
    ...(defaultChannel == null ? {} : { defaultChannel }),
    moduleChannels
  }
}

export const updateModuleUpdateSettings = async (
  input: ModuleUpdateSettingsPatch,
  options: ModuleUpdateCheckOptions = {}
): Promise<ModuleUpdatesResponse> => {
  const patch = normalizeSettingsPatch(input)
  const state = await loadConfigState()
  const desktopConfig = pickProjectDesktopUpdateConfig(state.projectSource?.rawConfig?.desktop)
  const nextDesktopConfig: Config['desktop'] = { ...desktopConfig }

  if (patch.defaultChannel != null) {
    nextDesktopConfig.updateChannel = patch.defaultChannel
  }

  if (Object.keys(patch.moduleChannels).length > 0) {
    const nextModuleChannels = {
      ...normalizeModuleUpdateChannelMap(nextDesktopConfig.moduleUpdateChannels)
    }
    for (const [key, channel] of Object.entries(patch.moduleChannels)) {
      if (channel == null) {
        delete nextModuleChannels[key]
      } else {
        nextModuleChannels[key] = channel
      }
    }
    if (Object.keys(nextModuleChannels).length > 0) {
      nextDesktopConfig.moduleUpdateChannels = nextModuleChannels
    } else {
      delete nextDesktopConfig.moduleUpdateChannels
    }
  } else if (
    nextDesktopConfig.moduleUpdateChannels != null &&
    Object.keys(nextDesktopConfig.moduleUpdateChannels).length === 0
  ) {
    delete nextDesktopConfig.moduleUpdateChannels
  }

  await updateConfigFile({
    workspaceFolder: state.workspaceFolder,
    source: 'project',
    section: 'desktop',
    value: nextDesktopConfig
  })

  return checkModuleUpdates(options)
}

const formatInstallError = (message: string, stderr: string) => {
  const detail = stderr.trim()
  return detail ? `${message}\n${detail}` : message
}

const installNpmPackage = async (target: ModuleUpdateTarget, version: string) => {
  const cacheDir = target.kind === 'adapter'
    ? resolveAdapterPackageCacheDir(target.packageName, version)
    : resolveGenericPackageCacheDir(target.packageName, version)
  const packageDir = target.kind === 'adapter'
    ? resolveAdapterPackageInstallDir(cacheDir, target.packageName)
    : resolveGenericPackageInstallDir(cacheDir, target.packageName)
  const installedInfo = await readPackageInfo(path.join(packageDir, 'package.json'))
  if (installedInfo?.name === target.packageName && installedInfo.version === version) {
    return { cacheDir, packageDir }
  }

  const stagingDir = `${cacheDir}.tmp-${process.pid}-${Date.now()}`
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })

  try {
    const result = await runBufferedCommand({
      args: [
        'install',
        '--prefix',
        stagingDir,
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        `${target.packageName}@${version}`
      ],
      command: NPM_BIN,
      env: resolvePackageManagerEnv(target.kind === 'adapter' ? 'adapter-packages/npm-cache' : 'npm-cache')
    })

    if (result.code !== 0) {
      throw new Error(formatInstallError(`Failed to install ${target.packageName}@${version}.`, result.stderr))
    }

    await mkdir(path.dirname(cacheDir), { recursive: true })
    await rm(cacheDir, { recursive: true, force: true })
    await rename(stagingDir, cacheDir)
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return { cacheDir, packageDir }
}

const normalizeRequestedVersion = (version: unknown) => {
  if (typeof version !== 'string') return undefined
  const trimmed = version.trim()
  if (trimmed === '') return undefined
  if (!/^[\w.+-]+$/.test(trimmed)) {
    throw new Error(`Invalid module version: ${trimmed}`)
  }
  return trimmed
}

export const installModuleUpdate = async (
  id: string,
  options: { language?: string; version?: unknown } = {}
): Promise<ModuleUpdateInstallResponse> => {
  const target = getModuleUpdateTarget(id)
  if (target == null) {
    throw new Error(`Unknown module update target: ${id}`)
  }

  const settings = await resolveModuleUpdateChannelSettings()
  const { channel, configuredChannel } = resolveTargetChannel(settings, target)
  const npmTag = resolveNpmTag(channel)
  const version = normalizeRequestedVersion(options.version) ??
    await resolvePublishedPackageVersion(target.packageName, npmTag)
  const installedPackage = await installNpmPackage(target, version)
  if (target.kind !== 'adapter') {
    await writeActiveModulePackage({
      packageDir: installedPackage.packageDir,
      packageName: target.packageName,
      version
    })
  }

  return {
    checkedAt: new Date().toISOString(),
    channel: settings.defaultChannel,
    module: await resolveModuleUpdateItem(target, channel, configuredChannel, options),
    moduleChannels: settings.moduleChannels,
    npmTag: resolveNpmTag(settings.defaultChannel)
  }
}
