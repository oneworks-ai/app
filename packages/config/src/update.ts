import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import process from 'node:process'

import type { Config, ConfigSource } from '@oneworks/types'
import {
  DEFAULT_GLOBAL_OO_CONFIG_FILE,
  resolvePrimaryWorkspaceFolder,
  resolveProjectConfigDir,
  resolveProjectWorkspaceFolder
} from '@oneworks/utils'
import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'
import { dump, load } from 'js-yaml'

import { resetConfigCache, resolveGlobalConfigDir } from './load'

export type { ConfigSource } from '@oneworks/types'

interface UpdateConfigFileBaseOptions {
  workspaceFolder?: string
  source: ConfigSource
  section: string
}

export type UpdateConfigFileOptions =
  & UpdateConfigFileBaseOptions
  & (
    | {
      resolveValue?: never
      value: unknown
    }
    | {
      resolveValue: (currentConfig: Config) => Promise<unknown> | unknown
      value?: never
    }
  )

const sensitiveHeaderKeys = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie'
])

const shouldMaskKey = (key: string) => {
  const normalized = key.trim().toLowerCase()
  if (normalized === 'apikeyenv' || normalized === 'api_key_env' || normalized === 'api-key-env') return false
  return sensitiveHeaderKeys.has(normalized) || /key|token|secret|password/i.test(key)
}

const projectConfigPaths = [
  './.oo.config.json',
  './infra/.oo.config.json',
  './.oo.config.yaml',
  './.oo.config.yml',
  './infra/.oo.config.yaml',
  './infra/.oo.config.yml'
]

const userConfigPaths = [
  './.oo.dev.config.json',
  './infra/.oo.dev.config.json',
  './.oo.dev.config.yaml',
  './.oo.dev.config.yml',
  './infra/.oo.dev.config.yaml',
  './infra/.oo.dev.config.yml'
]

const globalConfigPath = DEFAULT_GLOBAL_OO_CONFIG_FILE

export const resolveWritableConfigPath = (
  workspaceFolder: string,
  source: ConfigSource,
  env: Record<string, string | null | undefined> = process.env
) => {
  if (source === 'global') {
    const globalConfigDir = resolveGlobalConfigDir(env)
    return resolve(globalConfigDir, globalConfigPath)
  }

  const resolvedWorkspaceFolder = resolveProjectWorkspaceFolder(workspaceFolder, env)
  const configFolder = resolveProjectConfigDir(workspaceFolder, env) ?? resolvedWorkspaceFolder
  const paths = source === 'project' ? projectConfigPaths : userConfigPaths
  for (const path of paths) {
    const resolvedPath = resolve(configFolder, path)
    if (existsSync(resolvedPath)) {
      return resolvedPath
    }
  }

  if (source === 'user') {
    const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(resolvedWorkspaceFolder, env)
    if (primaryWorkspaceFolder != null) {
      for (const path of paths) {
        const resolvedPath = resolve(primaryWorkspaceFolder, path)
        if (existsSync(resolvedPath)) {
          return resolvedPath
        }
      }
      return resolve(primaryWorkspaceFolder, paths[0])
    }
  }

  return resolve(configFolder, paths[0])
}

const parseConfigContent = (format: string, content: string) => {
  if (format === '.yaml' || format === '.yml') {
    return (load(content) ?? {}) as Record<string, unknown>
  }
  return JSON.parse(content) as Record<string, unknown>
}

const serializeConfigContent = (format: string, value: Record<string, unknown>) => {
  if (format === '.yaml' || format === '.yml') {
    return `${dump(value, { noRefs: true, lineWidth: 120 })}\n`
  }
  return `${JSON.stringify(value, null, 2)}\n`
}

const isDanglingSymlink = async (filePath: string) => {
  if (existsSync(filePath)) return false

  try {
    return (await lstat(filePath)).isSymbolicLink()
  } catch {
    return false
  }
}

const prepareWritableConfigPath = async (configPath: string, hasExisting: boolean) => {
  if (!hasExisting && await isDanglingSymlink(configPath)) {
    await unlink(configPath)
  }
  await mkdir(dirname(configPath), { recursive: true })
}

const writeConfigFileAtomic = async (targetPath: string, content: string, hasExisting: boolean) => {
  const mode = hasExisting ? (await stat(targetPath)).mode : 0o600
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx', mode })
    await rename(tempPath, targetPath)
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

const resolveCanonicalWriteTarget = async (configPath: string) => {
  try {
    return await realpath(configPath)
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }

  const missingSegments = [basename(configPath)]
  let parentPath = dirname(configPath)
  while (true) {
    try {
      return resolve(await realpath(parentPath), ...missingSegments)
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
      const nextParent = dirname(parentPath)
      if (nextParent === parentPath) throw error
      missingSegments.unshift(basename(parentPath))
      parentPath = nextParent
    }
  }
}

const withCanonicalConfigWriteLock = async <T>(
  configPath: string,
  callback: (targetPath: string) => Promise<T>
) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const targetPath = await resolveCanonicalWriteTarget(configPath)
    const result = await withDirectoryInstallLock({
      lockDir: `${targetPath}.oneworks-write-lock`
    }, async () => {
      const lockedTargetPath = await resolveCanonicalWriteTarget(configPath)
      return lockedTargetPath === targetPath
        ? { retry: false as const, value: await callback(targetPath) }
        : { retry: true as const }
    })
    if (!result.retry) return result.value
  }
  throw new Error(`Config write target changed repeatedly while waiting for its lock: ${configPath}`)
}

const mergeMaskedValues = (incoming: unknown, existing: unknown): unknown => {
  if (Array.isArray(incoming)) return incoming
  if (incoming != null && typeof incoming === 'object') {
    const incomingRecord = incoming as Record<string, unknown>
    const existingRecord = (existing != null && typeof existing === 'object')
      ? (existing as Record<string, unknown>)
      : {}
    return Object.entries(incomingRecord).reduce<Record<string, unknown>>((acc, [key, val]) => {
      if (shouldMaskKey(key) && val === '******') {
        acc[key] = existingRecord[key]
      } else {
        acc[key] = mergeMaskedValues(val, existingRecord[key])
      }
      return acc
    }, {})
  }
  return incoming
}

const hasOwn = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key)

const projectDesktopUpdateKeys = new Set(['autoUpdate', 'updateChannel', 'moduleUpdateChannels'])

const isProjectDesktopUpdatePatch = (source: ConfigSource, section: string, value: unknown) => {
  if (source !== 'project' || section !== 'desktop') return false
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false

  const keys = Object.keys(value)
  return keys.every(key => projectDesktopUpdateKeys.has(key))
}

export const resolveConfigSectionWriteError = (source: ConfigSource, section: string, value?: unknown) => {
  if (section === 'desktop' && source !== 'global' && !isProjectDesktopUpdatePatch(source, section, value)) {
    return 'Config section "desktop" can only be written to global config, except project desktop auto-update settings.'
  }
  return section === 'appearance' && source !== 'global'
    ? `Config section "${section}" can only be written to global config.`
    : undefined
}

const updateConfigSection = (config: Config, section: string, value: unknown): Config => {
  const nextConfig: Config = { ...config }
  const sectionValue = (value != null && typeof value === 'object')
    ? (value as Record<string, unknown>)
    : {}

  const updateField = <T extends keyof Config>(
    key: T,
    nextValue: Config[T] | undefined,
    shouldUpdate = true
  ) => {
    if (!shouldUpdate) {
      return
    }
    if (nextValue === undefined) {
      delete nextConfig[key]
    } else {
      nextConfig[key] = nextValue
    }
  }

  switch (section) {
    case 'general': {
      updateField('baseDir', sectionValue.baseDir as Config['baseDir'], hasOwn(sectionValue, 'baseDir'))
      updateField(
        'disableGlobalConfig',
        sectionValue.disableGlobalConfig as Config['disableGlobalConfig'],
        hasOwn(sectionValue, 'disableGlobalConfig')
      )
      updateField('effort', sectionValue.effort as Config['effort'], hasOwn(sectionValue, 'effort'))
      updateField(
        'defaultAdapter',
        sectionValue.defaultAdapter as Config['defaultAdapter'],
        hasOwn(sectionValue, 'defaultAdapter')
      )
      updateField(
        'defaultModelService',
        sectionValue.defaultModelService as Config['defaultModelService'],
        hasOwn(sectionValue, 'defaultModelService')
      )
      updateField(
        'defaultModel',
        sectionValue.defaultModel as Config['defaultModel'],
        hasOwn(sectionValue, 'defaultModel')
      )
      updateField(
        'recommendedModels',
        sectionValue.recommendedModels as Config['recommendedModels'],
        hasOwn(sectionValue, 'recommendedModels')
      )
      updateField(
        'interfaceLanguage',
        sectionValue.interfaceLanguage as Config['interfaceLanguage'],
        hasOwn(sectionValue, 'interfaceLanguage')
      )
      updateField(
        'modelLanguage',
        sectionValue.modelLanguage as Config['modelLanguage'],
        hasOwn(sectionValue, 'modelLanguage')
      )
      updateField(
        'announcements',
        sectionValue.announcements as Config['announcements'],
        hasOwn(sectionValue, 'announcements')
      )
      updateField(
        'permissions',
        mergeMaskedValues(sectionValue.permissions, config.permissions) as Config['permissions'],
        hasOwn(sectionValue, 'permissions')
      )
      updateField(
        'env',
        mergeMaskedValues(sectionValue.env, config.env) as Config['env'],
        hasOwn(sectionValue, 'env')
      )
      updateField(
        'notifications',
        mergeMaskedValues(sectionValue.notifications, config.notifications) as Config['notifications'],
        hasOwn(sectionValue, 'notifications')
      )
      updateField(
        'messageLinks',
        mergeMaskedValues(sectionValue.messageLinks, config.messageLinks) as Config['messageLinks'],
        hasOwn(sectionValue, 'messageLinks')
      )
      updateField(
        'skills',
        mergeMaskedValues(sectionValue.skills, config.skills) as Config['skills'],
        hasOwn(sectionValue, 'skills')
      )
      updateField(
        'skillsMeta',
        mergeMaskedValues(sectionValue.skillsMeta, config.skillsMeta) as Config['skillsMeta'],
        hasOwn(sectionValue, 'skillsMeta')
      )
      updateField(
        'skillRegistries',
        mergeMaskedValues(sectionValue.skillRegistries, config.skillRegistries) as Config['skillRegistries'],
        hasOwn(sectionValue, 'skillRegistries')
      )
      updateField(
        'nativeHistoryImport',
        mergeMaskedValues(
          sectionValue.nativeHistoryImport,
          config.nativeHistoryImport
        ) as Config['nativeHistoryImport'],
        hasOwn(sectionValue, 'nativeHistoryImport')
      )
      updateField(
        'webAuth',
        mergeMaskedValues(sectionValue.webAuth, config.webAuth) as Config['webAuth'],
        hasOwn(sectionValue, 'webAuth')
      )
      updateField(
        'shortcuts',
        mergeMaskedValues(sectionValue.shortcuts, config.shortcuts) as Config['shortcuts'],
        hasOwn(sectionValue, 'shortcuts')
      )
      return nextConfig
    }
    case 'conversation': {
      updateField('conversation', mergeMaskedValues(sectionValue, config.conversation) as Config['conversation'])
      return nextConfig
    }
    case 'models': {
      updateField(
        'models',
        mergeMaskedValues(sectionValue, config.models) as Config['models']
      )
      return nextConfig
    }
    case 'modelServices': {
      updateField(
        'modelServices',
        mergeMaskedValues(sectionValue, config.modelServices) as Config['modelServices']
      )
      return nextConfig
    }
    case 'workspaces': {
      updateField(
        'workspaces',
        mergeMaskedValues(sectionValue, config.workspaces) as Config['workspaces']
      )
      return nextConfig
    }
    case 'channels': {
      updateField(
        'channels',
        mergeMaskedValues(sectionValue, config.channels) as Config['channels']
      )
      return nextConfig
    }
    case 'server': {
      updateField(
        'server',
        mergeMaskedValues(sectionValue, config.server) as Config['server']
      )
      return nextConfig
    }
    case 'adapters': {
      updateField('adapters', mergeMaskedValues(sectionValue, config.adapters) as Config['adapters'])
      return nextConfig
    }
    case 'appearance': {
      const appearanceConfig = config.appearance ?? {}
      const nextAppearance: NonNullable<Config['appearance']> = {}
      if (hasOwn(sectionValue, 'historyTimelineMode')) {
        nextAppearance.historyTimelineMode = sectionValue.historyTimelineMode as NonNullable<
          Config['appearance']
        >['historyTimelineMode']
      } else if (appearanceConfig.historyTimelineMode !== undefined) {
        nextAppearance.historyTimelineMode = appearanceConfig.historyTimelineMode
      }
      if (hasOwn(sectionValue, 'primaryColor')) {
        nextAppearance.primaryColor = sectionValue.primaryColor as NonNullable<Config['appearance']>['primaryColor']
      } else if (appearanceConfig.primaryColor !== undefined) {
        nextAppearance.primaryColor = appearanceConfig.primaryColor
      }
      if (hasOwn(sectionValue, 'themeMode')) {
        nextAppearance.themeMode = sectionValue.themeMode as NonNullable<Config['appearance']>['themeMode']
      } else if (appearanceConfig.themeMode !== undefined) {
        nextAppearance.themeMode = appearanceConfig.themeMode
      }
      if (hasOwn(sectionValue, 'themePack')) {
        nextAppearance.themePack = sectionValue.themePack as NonNullable<Config['appearance']>['themePack']
      } else if (appearanceConfig.themePack !== undefined) {
        nextAppearance.themePack = appearanceConfig.themePack
      }
      if (hasOwn(sectionValue, 'themePacks')) {
        nextAppearance.themePacks = sectionValue.themePacks as NonNullable<Config['appearance']>['themePacks']
      } else if (appearanceConfig.themePacks !== undefined) {
        nextAppearance.themePacks = appearanceConfig.themePacks
      }
      updateField('appearance', nextAppearance)
      return nextConfig
    }
    case 'desktop': {
      updateField('desktop', mergeMaskedValues(sectionValue, config.desktop) as Config['desktop'])
      return nextConfig
    }
    case 'plugins': {
      updateField('plugins', sectionValue.plugins as Config['plugins'])
      updateField(
        'marketplaces',
        sectionValue.marketplaces as Config['marketplaces'],
        hasOwn(sectionValue, 'marketplaces')
      )
      return nextConfig
    }
    case 'mcp': {
      updateField(
        'mcpServers',
        mergeMaskedValues(sectionValue.mcpServers, config.mcpServers) as Config['mcpServers']
      )
      updateField(
        'defaultIncludeMcpServers',
        sectionValue.defaultIncludeMcpServers as Config['defaultIncludeMcpServers']
      )
      updateField(
        'defaultExcludeMcpServers',
        sectionValue.defaultExcludeMcpServers as Config['defaultExcludeMcpServers']
      )
      updateField(
        'noDefaultOneworksMcpServer',
        sectionValue.noDefaultOneworksMcpServer as Config['noDefaultOneworksMcpServer']
      )
      return nextConfig
    }
    case 'auth': {
      updateField('webAuth', mergeMaskedValues(sectionValue, config.webAuth) as Config['webAuth'])
      return nextConfig
    }
    case 'voice': {
      updateField('voice', mergeMaskedValues(sectionValue, config.voice) as Config['voice'])
      return nextConfig
    }
    case 'shortcuts': {
      updateField('shortcuts', mergeMaskedValues(sectionValue, config.shortcuts) as Config['shortcuts'])
      return nextConfig
    }
    case 'experiments': {
      updateField('experiments', mergeMaskedValues(sectionValue, config.experiments) as Config['experiments'])
      return nextConfig
    }
    case 'diagnostics': {
      updateField('diagnostics', mergeMaskedValues(sectionValue, config.diagnostics) as Config['diagnostics'])
      return nextConfig
    }
    default: {
      updateField(section as keyof Config, sectionValue as Config[keyof Config])
      return nextConfig
    }
  }
}

export const updateConfigFile = async (options: UpdateConfigFileOptions) => {
  const workspaceFolder = options.workspaceFolder ?? process.cwd()
  const configPath = resolveWritableConfigPath(workspaceFolder, options.source)
  return withCanonicalConfigWriteLock(configPath, async (targetPath) => {
    const format = extname(configPath).toLowerCase()
    const hasExisting = existsSync(configPath)
    const existingContent = hasExisting ? await readFile(targetPath, 'utf-8') : ''
    const existingConfig = hasExisting ? parseConfigContent(format, existingContent) : {}
    const value = options.resolveValue == null
      ? options.value
      : await options.resolveValue(existingConfig as Config)
    const writeError = resolveConfigSectionWriteError(options.source, options.section, value)
    if (writeError != null) {
      throw new Error(writeError)
    }
    const updatedConfig = updateConfigSection(existingConfig as Config, options.section, value)

    await prepareWritableConfigPath(configPath, hasExisting)
    await writeConfigFileAtomic(
      targetPath,
      serializeConfigContent(format, updatedConfig as Record<string, unknown>),
      hasExisting
    )

    resetConfigCache()
    return { configPath, updatedConfig }
  })
}
