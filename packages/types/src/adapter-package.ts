/* eslint-disable max-lines -- adapter package loading keeps package resolution helpers colocated. */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import type { Adapter } from './adapter'
import type { AdapterCliPreparer } from './adapter-cli-prepare'
import type {
  AdapterModelProviderImportCapability,
  AdapterModelProviderImportDiscoverer,
  AdapterModelProviderImportSource
} from './adapter-model-provider-import'
import { resolveExistingAdapterPackageCacheDir } from './adapter-package-cache'
import type {
  AdapterWorktreeEnvironmentImportCapability,
  AdapterWorktreeEnvironmentImportDiscoverer,
  AdapterWorktreeEnvironmentImportSource
} from './adapter-worktree-environment-import'
import type { AdapterBuiltinModel, Config } from './config'
import type { AdapterNativePluginManager } from './native-host-plugin'
import type { AdapterPluginInstaller } from './native-plugin'

const ADAPTER_SCOPE = '@oneworks'
const ADAPTER_PREFIX = 'adapter-'
const ADAPTER_CLI_PREPARE_EXPORT = '/cli-prepare'
const ADAPTER_MODELS_EXPORT = '/models'
const ADAPTER_MODEL_PROVIDER_IMPORT_EXPORT = '/model-provider-import'
const ADAPTER_WORKTREE_ENVIRONMENT_IMPORT_EXPORT = '/worktree-environment-import'
const ADAPTER_NATIVE_PLUGINS_EXPORT = '/native-plugins'
const ADAPTER_PLUGIN_EXPORT = '/plugins'

interface AdapterModelsExport {
  builtinModels?: unknown
  loadBuiltinModels?: unknown
}

interface AdapterModelProviderImportExport {
  default?: unknown
}

interface AdapterWorktreeEnvironmentImportExport {
  default?: unknown
}

export interface AdapterRuntimeTarget {
  instanceKey: string
  loadSpecifier: string
  runtimeAdapter: string
  packageId?: string
}

export interface ResolveAdapterRuntimeTargetOptions {
  config?: Config
  cwd?: string
}

export interface AdapterPackageLoadOptions {
  cwd?: string
}

const createWorkspaceRequire = (cwd: string) => createRequire(resolve(cwd, '__oneworks_adapter_loader__.cjs'))
const defaultAdapterRequire = createWorkspaceRequire(process.cwd())

const normalizeRuntimePackageDir = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed != null && trimmed !== '' ? trimmed : undefined
}

const unique = <T>(values: T[]) => [...new Set(values)]

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const isPathSpecifier = (value: string) => (
  value.startsWith('.') ||
  value.startsWith('/') ||
  value.startsWith('~') ||
  (!value.startsWith('@') && /[\\/]/.test(value)) ||
  /^[a-z]:[\\/]/i.test(value)
)

const resolvePathSpecifier = (specifier: string, cwd = process.cwd()) => {
  if (specifier === '~') {
    return process.env.HOME != null ? resolve(process.env.HOME) : resolve(cwd, specifier)
  }
  if (specifier.startsWith('~/')) {
    return process.env.HOME != null
      ? resolve(process.env.HOME, specifier.slice(2))
      : resolve(cwd, specifier)
  }
  return isAbsolute(specifier) ? resolve(specifier) : resolve(cwd, specifier)
}

const readPackageJson = (packageRoot: string) => {
  const packageJsonPath = resolve(packageRoot, 'package.json')
  if (!existsSync(packageJsonPath)) return undefined

  try {
    return {
      path: packageJsonPath,
      data: JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        name?: string
        main?: string
        module?: string
        exports?: unknown
      }
    }
  } catch {
    return undefined
  }
}

const resolvePackageExportTarget = (
  entry: unknown,
  preferredConditions: readonly string[],
  patternMatch?: string
): string | undefined => {
  if (typeof entry === 'string') {
    return patternMatch == null ? entry : entry.replaceAll('*', patternMatch)
  }
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const resolved = resolvePackageExportTarget(item, preferredConditions, patternMatch)
      if (resolved != null) return resolved
    }
    return undefined
  }
  if (entry == null || typeof entry !== 'object') return undefined

  const record = entry as Record<string, unknown>
  for (const condition of preferredConditions) {
    const resolved = resolvePackageExportTarget(record[condition], preferredConditions, patternMatch)
    if (resolved != null) return resolved
  }
  for (const value of Object.values(record)) {
    const resolved = resolvePackageExportTarget(value, preferredConditions, patternMatch)
    if (resolved != null) return resolved
  }
  return undefined
}

const matchPackageExportPattern = (patternKey: string, exportKey: string) => {
  const wildcardIndex = patternKey.indexOf('*')
  if (wildcardIndex < 0) return undefined

  const prefix = patternKey.slice(0, wildcardIndex)
  const suffix = patternKey.slice(wildcardIndex + 1)
  if (!exportKey.startsWith(prefix) || !exportKey.endsWith(suffix)) {
    return undefined
  }

  return exportKey.slice(prefix.length, exportKey.length - suffix.length)
}

const comparePackageExportPatternSpecificity = (
  left: { key: string },
  right: { key: string }
) => {
  const leftWildcardIndex = left.key.indexOf('*')
  const rightWildcardIndex = right.key.indexOf('*')

  const leftPrefixLength = leftWildcardIndex < 0 ? left.key.length : leftWildcardIndex
  const rightPrefixLength = rightWildcardIndex < 0 ? right.key.length : rightWildcardIndex
  if (leftPrefixLength !== rightPrefixLength) {
    return rightPrefixLength - leftPrefixLength
  }

  const leftSuffixLength = leftWildcardIndex < 0 ? 0 : left.key.length - leftWildcardIndex - 1
  const rightSuffixLength = rightWildcardIndex < 0 ? 0 : right.key.length - rightWildcardIndex - 1
  if (leftSuffixLength !== rightSuffixLength) {
    return rightSuffixLength - leftSuffixLength
  }

  return right.key.length - left.key.length
}

const resolvePackageExportEntry = (
  exportsField: unknown,
  exportKey: string
): { entry: unknown; patternMatch?: string } | undefined => {
  if (exportKey === '.') {
    if (
      exportsField != null &&
      typeof exportsField === 'object' &&
      !Array.isArray(exportsField) &&
      Object.hasOwn(exportsField as Record<string, unknown>, '.')
    ) {
      return { entry: (exportsField as Record<string, unknown>)['.'] }
    }
    return { entry: exportsField }
  }

  if (exportsField == null || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    return undefined
  }

  const exportsRecord = exportsField as Record<string, unknown>
  if (Object.hasOwn(exportsRecord, exportKey)) {
    return { entry: exportsRecord[exportKey] }
  }

  const matchedPattern = Object.keys(exportsRecord)
    .filter(key => key.startsWith('./') && key.includes('*'))
    .map((key) => {
      const patternMatch = matchPackageExportPattern(key, exportKey)
      return patternMatch == null ? undefined : { key, patternMatch }
    })
    .filter((match): match is { key: string; patternMatch: string } => match != null)
    .sort(comparePackageExportPatternSpecificity)[0]

  if (matchedPattern == null) return undefined

  return {
    entry: exportsRecord[matchedPattern.key],
    patternMatch: matchedPattern.patternMatch
  }
}

const resolvePathPackageExportCandidates = (params: {
  packageRoot: string
  exportKey: string
  workspaceSourcePath: string
}) => {
  const packageJson = readPackageJson(params.packageRoot)
  const candidates: string[] = []
  const pushCandidate = (value: unknown) => {
    const normalized = normalizeNonEmptyString(value)
    if (normalized == null) return
    candidates.push(resolve(params.packageRoot, normalized))
  }

  const exportEntry = resolvePackageExportEntry(packageJson?.data.exports, params.exportKey)
  pushCandidate(resolvePackageExportTarget(exportEntry?.entry, ['__oneworks__', 'default'], exportEntry?.patternMatch))
  pushCandidate(
    resolvePackageExportTarget(exportEntry?.entry, ['require', 'node', 'default'], exportEntry?.patternMatch)
  )
  if (params.exportKey === '.') {
    pushCandidate(packageJson?.data.main)
    pushCandidate(packageJson?.data.module)
  }
  pushCandidate(params.workspaceSourcePath)

  return unique(candidates)
}

const loadPathPackageExport = (params: {
  packageRoot: string
  exportKey: string
  workspaceSourcePath: string
}) => {
  const packageRequire = createRequire(resolve(params.packageRoot, 'package.json'))
  let missingError: unknown

  for (const candidate of resolvePathPackageExportCandidates(params)) {
    if (!existsSync(candidate)) continue
    try {
      return packageRequire(candidate)
    } catch (error) {
      if (isWorkspaceDistMissingError(error)) {
        missingError ??= error
        continue
      }
      throw error
    }
  }

  if (params.exportKey !== '.') {
    if (missingError != null) throw missingError
    const subpath = params.exportKey.startsWith('./') ? params.exportKey.slice(1) : params.exportKey
    const error = new Error(`Cannot find module '${params.packageRoot}${subpath}'`)
    const moduleError = error as NodeJS.ErrnoException
    moduleError.code = 'MODULE_NOT_FOUND'
    throw error
  }

  try {
    return packageRequire(params.packageRoot)
  } catch (error) {
    if (missingError != null) throw missingError
    throw error
  }
}

export const resolveAdapterKeyFromPackageName = (packageName: string) => {
  const normalized = normalizeNonEmptyString(packageName)
  if (normalized == null) return undefined
  if (normalized.startsWith('@oneworks/adapter-')) {
    return normalizeAdapterPackageId(normalized.slice('@oneworks/'.length)).replace(/^adapter-/, '')
  }
  if (normalized.startsWith(ADAPTER_PREFIX)) {
    return normalizeAdapterPackageId(normalized).replace(/^adapter-/, '')
  }
  if (!normalized.startsWith('@')) {
    return normalizeAdapterPackageId(normalized).replace(/^adapter-/, '')
  }
  return normalized
}

const resolveAdapterKeyFromPathPackage = (packageRoot: string) => {
  const packageJson = readPackageJson(packageRoot)
  return packageJson?.data.name == null ? undefined : resolveAdapterKeyFromPackageName(packageJson.data.name)
}

const readConfiguredAdapterPackageId = (adapterKey: string, config?: Config) => {
  const adapters = config?.adapters as Record<string, unknown> | undefined
  const entry = adapters?.[adapterKey]
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
    return undefined
  }
  return normalizeNonEmptyString((entry as Record<string, unknown>).packageId)
}

export const resolveAdapterRuntimeTarget = (
  adapterKey: string,
  options: ResolveAdapterRuntimeTargetOptions = {}
): AdapterRuntimeTarget => {
  const packageId = readConfiguredAdapterPackageId(adapterKey, options.config)
  const rawLoadSpecifier = packageId ?? adapterKey
  const loadSpecifier = isPathSpecifier(rawLoadSpecifier)
    ? resolvePathSpecifier(rawLoadSpecifier, options.cwd)
    : rawLoadSpecifier
  const runtimeAdapter = isPathSpecifier(loadSpecifier)
    ? resolveAdapterKeyFromPathPackage(loadSpecifier) ?? adapterKey
    : resolveAdapterKeyFromPackageName(loadSpecifier) ?? adapterKey

  return {
    instanceKey: adapterKey,
    loadSpecifier,
    runtimeAdapter,
    ...(packageId == null ? {} : { packageId })
  }
}

const createAdapterRequires = (packageName: string) => {
  const cliPackageDir = normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__)
  const packageDir = normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__)
  const explicitCliPackageDir = cliPackageDir != null && cliPackageDir !== packageDir
    ? cliPackageDir
    : undefined

  return unique([
    explicitCliPackageDir,
    resolveExistingAdapterPackageCacheDir(packageName),
    packageDir,
    process.cwd()
  ].filter((value): value is string => value != null)).map(createWorkspaceRequire)
}

const isMissingRequestedModuleError = (error: unknown, request: string) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === 'MODULE_NOT_FOUND' && message.includes(`Cannot find module '${request}'`)
}

const isWorkspaceDistMissingError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === 'MODULE_NOT_FOUND' && message.includes('/dist/')
}

const loadWorkspacePackageExport = (params: {
  packageRequire?: NodeJS.Require
  packageName: string
  sourcePath: string
}) => {
  const packageRequire = params.packageRequire ?? defaultAdapterRequire
  const packageJsonPath = packageRequire.resolve(`${params.packageName}/package.json`)
  return packageRequire(join(dirname(packageJsonPath), params.sourcePath))
}

const loadAdapterPackageExport = (params: {
  packageName: string
  request: string
  packageRoot?: string
  exportKey?: string
  workspaceSourcePath: string
}) => {
  if (params.packageRoot != null) {
    return loadPathPackageExport({
      packageRoot: params.packageRoot,
      exportKey: params.exportKey ?? '.',
      workspaceSourcePath: params.workspaceSourcePath
    })
  }

  let missingError: unknown

  for (const packageRequire of createAdapterRequires(params.packageName)) {
    try {
      return packageRequire(params.request)
    } catch (error) {
      if (isWorkspaceDistMissingError(error)) {
        return loadWorkspacePackageExport({
          packageRequire,
          packageName: params.packageName,
          sourcePath: params.workspaceSourcePath
        })
      }
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
        missingError ??= error
        continue
      }
      if (isMissingRequestedModuleError(error, params.request)) {
        missingError ??= error
        continue
      }
      throw error
    }
  }

  try {
    return defaultAdapterRequire(params.request)
  } catch (error) {
    if (isWorkspaceDistMissingError(error)) {
      return loadWorkspacePackageExport({
        packageName: params.packageName,
        sourcePath: params.workspaceSourcePath
      })
    }
    if (missingError != null && isMissingRequestedModuleError(error, params.request)) {
      throw missingError
    }
    throw error
  }
}

const resolveAdapterLoadTarget = (type: string, options: AdapterPackageLoadOptions = {}) => {
  const trimmed = type.trim()
  if (isPathSpecifier(trimmed)) {
    const packageRoot = resolvePathSpecifier(trimmed, options.cwd)
    const packageName = readPackageJson(packageRoot)?.data.name ?? packageRoot
    return {
      packageName,
      packageRoot
    }
  }
  return {
    packageName: resolveAdapterPackageName(type),
    packageRoot: undefined
  }
}

export const normalizeAdapterPackageId = (type: string) => {
  const trimmed = type.trim()
  if (trimmed.startsWith('@')) return trimmed

  const hasAdapterPrefix = trimmed.startsWith(ADAPTER_PREFIX)
  const adapterId = hasAdapterPrefix ? trimmed.slice(ADAPTER_PREFIX.length) : trimmed
  const normalizedAdapterId = adapterId === 'claude' ? 'claude-code' : adapterId

  return hasAdapterPrefix ? `${ADAPTER_PREFIX}${normalizedAdapterId}` : normalizedAdapterId
}

export const resolveAdapterPackageName = (type: string) => {
  const normalizedType = normalizeAdapterPackageId(type)
  if (normalizedType.startsWith('@')) return normalizedType
  return normalizedType.startsWith(ADAPTER_PREFIX)
    ? `${ADAPTER_SCOPE}/${normalizedType}`
    : `${ADAPTER_SCOPE}/${ADAPTER_PREFIX}${normalizedType}`
}

export const loadAdapter = async (type: string, options: AdapterPackageLoadOptions = {}) => {
  const { packageName, packageRoot } = resolveAdapterLoadTarget(type, options)

  return loadAdapterPackageExport({
    packageName,
    request: packageRoot ?? packageName,
    packageRoot,
    exportKey: '.',
    workspaceSourcePath: 'src/index.ts'
  }).default as Adapter
}

export const loadAdapterBuiltinModels = (type: string, options: AdapterPackageLoadOptions = {}) => {
  const { packageName, packageRoot } = resolveAdapterLoadTarget(type, options)
  const exportName = `${packageName}${ADAPTER_MODELS_EXPORT}`
  const mod = loadAdapterPackageExport({
    packageName,
    request: packageRoot == null ? exportName : `${packageRoot}${ADAPTER_MODELS_EXPORT}`,
    packageRoot,
    exportKey: './models',
    workspaceSourcePath: 'src/models.ts'
  }) as AdapterModelsExport

  if (typeof mod.loadBuiltinModels === 'function') {
    const loaded = mod.loadBuiltinModels()
    if (Array.isArray(loaded)) return loaded as AdapterBuiltinModel[]
  }
  return Array.isArray(mod.builtinModels) ? mod.builtinModels as AdapterBuiltinModel[] : undefined
}

const isMissingAdapterPackageExportError = (
  error: unknown,
  request: string,
  exportName: string
) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' && message.includes(exportName)) ||
    (code === 'MODULE_NOT_FOUND' && message.includes(`Cannot find module '${request}'`))
}

const isAdapterModelProviderImportSource = (
  value: unknown
): value is AdapterModelProviderImportSource => (
  value === 'global' || value === 'project' || value === 'user'
)

const asAdapterModelProviderImportCapability = (
  value: unknown,
  type: string
): AdapterModelProviderImportCapability => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Adapter ${type} does not expose a model provider import capability.`)
  }
  const capability = value as Record<string, unknown>
  const descriptor = capability.descriptor
  if (descriptor == null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError(`Adapter ${type} does not declare a model provider import descriptor.`)
  }
  const descriptorRecord = descriptor as Record<string, unknown>
  const title = normalizeNonEmptyString(descriptorRecord.title)
  const description = normalizeNonEmptyString(descriptorRecord.description)
  const supportedSources = descriptorRecord.supportedSources
  if (
    title == null ||
    !Array.isArray(supportedSources) ||
    supportedSources.length === 0 ||
    !supportedSources.every(isAdapterModelProviderImportSource)
  ) {
    throw new TypeError(`Adapter ${type} has an invalid model provider import descriptor.`)
  }
  if (typeof capability.discover !== 'function') {
    throw new TypeError(`Adapter ${type} does not expose a model provider import discoverer.`)
  }

  return {
    descriptor: {
      ...(description == null ? {} : { description }),
      supportedSources: [...new Set(supportedSources)],
      title
    },
    discover: capability.discover as AdapterModelProviderImportDiscoverer
  }
}

export const tryLoadAdapterModelProviderImportCapability = async (
  type: string,
  options: AdapterPackageLoadOptions = {}
): Promise<AdapterModelProviderImportCapability | undefined> => {
  const { packageName, packageRoot } = resolveAdapterLoadTarget(type, options)
  const exportName = `${packageName}${ADAPTER_MODEL_PROVIDER_IMPORT_EXPORT}`
  const request = packageRoot == null ? exportName : `${packageRoot}${ADAPTER_MODEL_PROVIDER_IMPORT_EXPORT}`
  let mod: AdapterModelProviderImportExport
  try {
    mod = loadAdapterPackageExport({
      packageName,
      request,
      packageRoot,
      exportKey: './model-provider-import',
      workspaceSourcePath: 'src/model-provider-import.ts'
    }) as AdapterModelProviderImportExport
  } catch (error) {
    if (isMissingAdapterPackageExportError(error, request, 'model-provider-import')) return undefined
    throw error
  }

  return asAdapterModelProviderImportCapability(mod.default, type)
}

export const loadAdapterModelProviderImportCapability = async (
  type: string,
  options: AdapterPackageLoadOptions = {}
) => {
  const capability = await tryLoadAdapterModelProviderImportCapability(type, options)
  if (capability == null) {
    throw new TypeError(`Adapter ${type} does not expose a model provider import capability.`)
  }
  return capability
}

const isAdapterWorktreeEnvironmentImportSource = (
  value: unknown
): value is AdapterWorktreeEnvironmentImportSource => (
  value === 'project' || value === 'user'
)

const asAdapterWorktreeEnvironmentImportCapability = (
  value: unknown,
  type: string
): AdapterWorktreeEnvironmentImportCapability => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Adapter ${type} does not expose a worktree environment import capability.`)
  }
  const capability = value as Record<string, unknown>
  const descriptor = capability.descriptor
  if (descriptor == null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError(`Adapter ${type} does not declare a worktree environment import descriptor.`)
  }
  const descriptorRecord = descriptor as Record<string, unknown>
  const title = normalizeNonEmptyString(descriptorRecord.title)
  const description = normalizeNonEmptyString(descriptorRecord.description)
  const supportedSources = descriptorRecord.supportedSources
  if (
    title == null ||
    !Array.isArray(supportedSources) ||
    supportedSources.length === 0 ||
    !supportedSources.every(isAdapterWorktreeEnvironmentImportSource)
  ) {
    throw new TypeError(`Adapter ${type} has an invalid worktree environment import descriptor.`)
  }
  if (typeof capability.discover !== 'function') {
    throw new TypeError(`Adapter ${type} does not expose a worktree environment import discoverer.`)
  }

  return {
    descriptor: {
      ...(description == null ? {} : { description }),
      supportedSources: [...new Set(supportedSources)],
      title
    },
    discover: capability.discover as AdapterWorktreeEnvironmentImportDiscoverer
  }
}

export const tryLoadAdapterWorktreeEnvironmentImportCapability = async (
  type: string,
  options: AdapterPackageLoadOptions = {}
): Promise<AdapterWorktreeEnvironmentImportCapability | undefined> => {
  const { packageName, packageRoot } = resolveAdapterLoadTarget(type, options)
  const exportName = `${packageName}${ADAPTER_WORKTREE_ENVIRONMENT_IMPORT_EXPORT}`
  const request = packageRoot == null ? exportName : `${packageRoot}${ADAPTER_WORKTREE_ENVIRONMENT_IMPORT_EXPORT}`
  let mod: AdapterWorktreeEnvironmentImportExport
  try {
    mod = loadAdapterPackageExport({
      packageName,
      request,
      packageRoot,
      exportKey: './worktree-environment-import',
      workspaceSourcePath: 'src/worktree-environment-import.ts'
    }) as AdapterWorktreeEnvironmentImportExport
  } catch (error) {
    if (isMissingAdapterPackageExportError(error, request, 'worktree-environment-import')) return undefined
    throw error
  }

  return asAdapterWorktreeEnvironmentImportCapability(mod.default, type)
}

export const loadAdapterWorktreeEnvironmentImportCapability = async (
  type: string,
  options: AdapterPackageLoadOptions = {}
) => {
  const capability = await tryLoadAdapterWorktreeEnvironmentImportCapability(type, options)
  if (capability == null) {
    throw new TypeError(`Adapter ${type} does not expose a worktree environment import capability.`)
  }
  return capability
}

export const loadAdapterPluginInstaller = async (type: string, options: AdapterPackageLoadOptions = {}) => {
  const { packageName, packageRoot } = resolveAdapterLoadTarget(type, options)
  const exportName = `${packageName}${ADAPTER_PLUGIN_EXPORT}`

  try {
    return loadAdapterPackageExport({
      packageName,
      request: packageRoot == null ? exportName : `${packageRoot}${ADAPTER_PLUGIN_EXPORT}`,
      packageRoot,
      exportKey: './plugins',
      workspaceSourcePath: 'src/plugins/index.ts'
    }).default as AdapterPluginInstaller
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    const message = error instanceof Error ? error.message : String(error)
    if (
      code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
      (code === 'MODULE_NOT_FOUND' && message.includes(exportName))
    ) {
      throw new Error(`Adapter ${type} does not support native plugin management.`)
    }
    throw error
  }
}

export const loadAdapterNativePluginManager = async (
  type: string,
  options: AdapterPackageLoadOptions = {}
) => {
  const { packageName, packageRoot } = resolveAdapterLoadTarget(type, options)
  const exportName = `${packageName}${ADAPTER_NATIVE_PLUGINS_EXPORT}`

  try {
    return loadAdapterPackageExport({
      packageName,
      request: packageRoot == null ? exportName : `${packageRoot}${ADAPTER_NATIVE_PLUGINS_EXPORT}`,
      packageRoot,
      exportKey: './native-plugins',
      workspaceSourcePath: 'src/native-plugins/index.ts'
    }).default as AdapterNativePluginManager
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    const message = error instanceof Error ? error.message : String(error)
    if (
      code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
      (code === 'MODULE_NOT_FOUND' && message.includes(exportName))
    ) {
      throw new Error(`Adapter ${type} does not expose native Home plugin discovery.`)
    }
    throw error
  }
}

export const loadAdapterCliPreparer = async (type: string, options: AdapterPackageLoadOptions = {}) => {
  const { packageName, packageRoot } = resolveAdapterLoadTarget(type, options)
  const exportName = `${packageName}${ADAPTER_CLI_PREPARE_EXPORT}`

  try {
    return loadAdapterPackageExport({
      packageName,
      request: packageRoot == null ? exportName : `${packageRoot}${ADAPTER_CLI_PREPARE_EXPORT}`,
      packageRoot,
      exportKey: './cli-prepare',
      workspaceSourcePath: 'src/cli-prepare.ts'
    }).default as AdapterCliPreparer
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    const message = error instanceof Error ? error.message : String(error)
    if (
      code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
      (code === 'MODULE_NOT_FOUND' && message.includes(exportName))
    ) {
      throw new Error(`Adapter ${type} does not support CLI preparation.`)
    }
    throw error
  }
}
