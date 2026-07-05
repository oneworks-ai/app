import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, resolve } from 'node:path'
import process from 'node:process'

import { load as loadYaml } from 'js-yaml'

import type {
  PluginChildConfig,
  PluginConfig,
  PluginConfigHookManifest,
  PluginInstanceConfig,
  PluginManifest,
  PluginManifestChildDefinition
} from '@oneworks/types'

import { resolveGlobalOneWorksAssetsPath, resolveProjectOoPath } from './ai-path'
import {
  ensureManagedPluginPackage,
  isManagedPluginPackageName,
  resolveActiveManagedPluginPackageInstallDir,
  resolveExistingManagedPluginPackage
} from './managed-plugin-package'

const DISABLE_GLOBAL_CONFIG_ENV = '__ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__'
const DISABLE_DEFAULT_OFFICIAL_PLUGINS_ENV = '__ONEWORKS_PROJECT_DISABLE_DEFAULT_OFFICIAL_PLUGINS__'
const DIRECTORY_MANIFEST_FILES = ['plugin.json', 'plugin.yaml', 'plugin.yml', 'package.json'] as const
const KNOWN_PLUGIN_ASSET_DIRS = ['rules', 'skills', 'specs', 'entities', 'mcp', 'hooks', 'client', 'server', 'plugins']
const DEFAULT_OFFICIAL_PLUGIN_CONFIGS: PluginConfig = [
  { id: '@oneworks/plugin-relay' }
]
const DEFAULT_OFFICIAL_PLUGIN_PACKAGE_IDS = new Set(['@oneworks/plugin-relay', 'relay'])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeOptions = (value: unknown): Record<string, unknown> => (
  isRecord(value) ? value : {}
)

const createWorkspaceRequire = (cwd: string) => createRequire(resolve(cwd, '__oneworks_plugin_loader__.cjs'))

const normalizeRuntimePackageDir = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed != null && trimmed !== '' ? trimmed : undefined
}

const unique = <T>(values: T[]) => [...new Set(values)]

const createPluginRequires = (cwd: string) =>
  unique([
    cwd,
    normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__),
    normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__)
  ].filter((value): value is string => value != null)).map(createWorkspaceRequire)

const isMissingPackageEntryError = (error: unknown) => {
  if (!isRecord(error)) return false
  const code = typeof error.code === 'string' ? error.code : undefined
  const message = typeof error.message === 'string' ? error.message : ''
  return (
    code === 'MODULE_NOT_FOUND' ||
    code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
    message.includes('No "exports" main defined')
  )
}

const shouldTryPrefixedPackageId = (id: string) => (
  !id.startsWith('@') &&
  !id.startsWith('.') &&
  !id.startsWith('/') &&
  !id.includes('\\')
)

const isTopLevelDirectoryReference = (id: string) => (
  id.startsWith('./') ||
  id.startsWith('../') ||
  id.startsWith('/') ||
  id.startsWith('\\') ||
  /^[a-z]:[\\/]/i.test(id)
)

const normalizePluginConfigHookManifest = (value: unknown): PluginManifest['configHook'] => {
  if (typeof value === 'string') {
    const entry = value.trim()
    return entry !== '' ? entry : undefined
  }

  if (!isRecord(value)) return undefined

  const entry = typeof value.entry === 'string' ? value.entry.trim() : undefined
  return entry != null && entry !== ''
    ? { entry } satisfies PluginConfigHookManifest
    : undefined
}

const hasPluginConfigSchemaFields = (value: Record<string, unknown>) => (
  'jsonSchema' in value || 'schema' in value || 'uiSchema' in value
)

const normalizePluginConfigManifest = (value: unknown): PluginManifest['config'] => (
  isRecord(value) && hasPluginConfigSchemaFields(value)
    ? value as PluginManifest['config']
    : undefined
)

const toPluginManifest = (value: unknown): PluginManifest | undefined => {
  if (!isRecord(value)) return undefined

  const manifestLike = value.__oneWorksPluginManifest === true || 'assets' in value || 'children' in value ||
    'config' in value || 'configHook' in value || 'plugin' in value || 'scope' in value
  if (!manifestLike) return undefined

  if ('scope' in value) {
    throw new Error('Plugin manifests must not define scope. Scope is controlled by user config.')
  }

  const configHook = normalizePluginConfigHookManifest(value.configHook) ??
    normalizePluginConfigHookManifest(value.config)

  return {
    __oneWorksPluginManifest: true,
    ...(normalizeVersion(value.version) != null ? { version: normalizeVersion(value.version) } : {}),
    assets: isRecord(value.assets)
      ? Object.fromEntries(
        Object.entries(value.assets).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''
        )
      ) as PluginManifest['assets']
      : undefined,
    children: isRecord(value.children)
      ? Object.fromEntries(
        Object.entries(value.children).map(([key, child]) => {
          if (!isRecord(child)) {
            throw new Error(`Invalid child plugin definition for ${key}`)
          }
          const source = child.source
          if (!isRecord(source) || (source.type !== 'package' && source.type !== 'directory')) {
            throw new Error(`Invalid child plugin source for ${key}`)
          }
          if (
            typeof child.activation !== 'string' || (child.activation !== 'default' && child.activation !== 'optional')
          ) {
            throw new Error(`Invalid child plugin activation for ${key}`)
          }
          if ('scope' in child) {
            throw new Error(`Child plugin ${key} must not define scope in manifest.`)
          }
          return [
            key,
            {
              source: source.type === 'package'
                ? { type: 'package', id: String(source.id) }
                : { type: 'directory', path: String(source.path) },
              activation: child.activation,
              options: normalizeOptions(child.options)
            } satisfies PluginManifestChildDefinition
          ]
        })
      )
      : undefined,
    config: normalizePluginConfigManifest(value.config),
    ...(configHook != null ? { configHook } : {}),
    plugin: isRecord(value.plugin)
      ? {
        client: isRecord(value.plugin.client)
          ? {
            ...(typeof value.plugin.client.entry === 'string' && value.plugin.client.entry.trim() !== ''
              ? { entry: value.plugin.client.entry.trim() }
              : {}),
            ...(typeof value.plugin.client.root === 'string' && value.plugin.client.root.trim() !== ''
              ? { root: value.plugin.client.root.trim() }
              : {}),
            ...(typeof value.plugin.client.devEntry === 'string' && value.plugin.client.devEntry.trim() !== ''
              ? { devEntry: value.plugin.client.devEntry.trim() }
              : {}),
            ...(typeof value.plugin.client.devServer === 'string' && value.plugin.client.devServer.trim() !== ''
              ? { devServer: value.plugin.client.devServer.trim() }
              : {})
          }
          : undefined,
        server: isRecord(value.plugin.server)
          ? {
            ...(typeof value.plugin.server.entry === 'string' && value.plugin.server.entry.trim() !== ''
              ? { entry: value.plugin.server.entry.trim() }
              : {})
          }
          : undefined,
        contributions: isRecord(value.plugin.contributions)
          ? value.plugin.contributions as NonNullable<PluginManifest['plugin']>['contributions']
          : undefined
      }
      : undefined
  }
}

export interface ResolvedPluginReference {
  sourceType: 'package' | 'directory'
  requestId: string
  packageId?: string
  resolvedBy:
    | 'direct'
    | 'oneworks-prefix'
    | 'vibe-forge-prefix'
    | 'managed-package-cache'
    | 'manifest-package'
    | 'manifest-directory'
    | 'directory-fallback'
  rootDir: string
}

export interface ResolvedPluginInstance {
  requestId: string
  packageId?: string
  requestedVersion?: string
  sourceType: 'package' | 'directory'
  rootDir: string
  enabled?: boolean
  scope?: string
  watch?: boolean
  options: Record<string, unknown>
  manifest?: PluginManifest
  instancePath: string
  resolvedBy: ResolvedPluginReference['resolvedBy']
  overlaySource?: string
  childDefinitions: Record<string, PluginManifestChildDefinition>
  children: ResolvedPluginInstance[]
}

const normalizeScope = (value: unknown) => (
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
)

const normalizeVersion = (value: unknown) => (
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
)

const normalizeEnabled = (value: unknown) => (
  typeof value === 'boolean' ? value : undefined
)

const normalizeWatch = (value: unknown) => (
  typeof value === 'boolean' ? value : undefined
)

const normalizePluginInstanceConfig = (
  value: unknown,
  path: string
): PluginInstanceConfig => {
  if (!isRecord(value)) {
    throw new Error(`Invalid plugin instance at ${path}. Expected an object.`)
  }

  const id = typeof value.id === 'string' && value.id.trim() !== ''
    ? value.id.trim()
    : undefined
  if (id == null) {
    throw new Error(`Invalid plugin instance at ${path}. "id" must be a non-empty string.`)
  }

  if ('options' in value && value.options != null && !isRecord(value.options)) {
    throw new Error(`Invalid plugin instance at ${path}. "options" must be an object.`)
  }
  if ('enabled' in value && value.enabled != null && typeof value.enabled !== 'boolean') {
    throw new Error(`Invalid plugin instance at ${path}. "enabled" must be a boolean.`)
  }
  if ('watch' in value && value.watch != null && typeof value.watch !== 'boolean') {
    throw new Error(`Invalid plugin instance at ${path}. "watch" must be a boolean.`)
  }
  if ('version' in value && value.version != null && typeof value.version !== 'string') {
    throw new Error(`Invalid plugin instance at ${path}. "version" must be a string.`)
  }
  if ('children' in value && value.children != null && !Array.isArray(value.children)) {
    throw new Error(`Invalid plugin instance at ${path}. "children" must be an array.`)
  }

  const children = Array.isArray(value.children)
    ? value.children.map((child, index) => normalizePluginInstanceConfig(child, `${path}.children[${index}]`))
    : undefined

  return {
    id,
    ...(normalizeEnabled(value.enabled) != null ? { enabled: normalizeEnabled(value.enabled) } : {}),
    ...(normalizeWatch(value.watch) != null ? { watch: normalizeWatch(value.watch) } : {}),
    ...(normalizeVersion(value.version) != null ? { version: normalizeVersion(value.version) } : {}),
    ...(normalizeScope(value.scope) != null ? { scope: normalizeScope(value.scope) } : {}),
    ...(isRecord(value.options) ? { options: value.options } : {}),
    ...(children != null ? { children } : {})
  }
}

export const normalizePluginConfig = (
  plugins: PluginConfig | undefined,
  path: string = 'plugins'
): PluginConfig | undefined => {
  if (plugins == null) return undefined
  if (!Array.isArray(plugins)) {
    throw new TypeError(
      `Invalid ${path} config. "plugins" must be an array of plugin instances; the legacy object map format is no longer supported.`
    )
  }

  return plugins.map((plugin, index) => normalizePluginInstanceConfig(plugin, `${path}[${index}]`))
}

const resolveInstalledPackageRoot = (cwd: string, packageId: string) => {
  const lookupPaths = unique(
    createPluginRequires(cwd).flatMap(pluginRequire => pluginRequire.resolve.paths(packageId) ?? [])
  )
  const packageSegments = packageId.split('/')

  for (const lookupPath of lookupPaths) {
    const packageJsonPath = resolve(lookupPath, ...packageSegments, 'package.json')
    if (existsSync(packageJsonPath)) {
      return dirname(packageJsonPath)
    }
  }

  return undefined
}

const resolveOptionalPackageEntryPath = (
  cwd: string,
  specifier: string,
  rootDir?: string
) => {
  const pluginRequires = [
    ...(rootDir != null ? [createWorkspaceRequire(rootDir)] : []),
    ...createPluginRequires(cwd)
  ]
  for (const pluginRequire of pluginRequires) {
    try {
      return pluginRequire.resolve(specifier)
    } catch (error) {
      if (isMissingPackageEntryError(error)) continue
      throw error
    }
  }
  return undefined
}

const resolveManagedPackageReference = async (
  cwd: string,
  requestId: string,
  packageId: string,
  version?: string,
  options?: { autoInstallManaged?: boolean }
): Promise<ResolvedPluginReference | undefined> => {
  if (!isManagedPluginPackageName(packageId)) return undefined
  if (options?.autoInstallManaged === false) return undefined

  const rootDir = await ensureManagedPluginPackage({
    cwd,
    packageName: packageId,
    version
  })
  if (rootDir == null) return undefined

  return {
    sourceType: 'package',
    requestId,
    packageId,
    resolvedBy: 'managed-package-cache',
    rootDir
  }
}

const resolveActiveManagedPackageReference = async (
  requestId: string,
  packageId: string,
  version?: string
): Promise<ResolvedPluginReference | undefined> => {
  if (version != null || !isManagedPluginPackageName(packageId)) return undefined

  const rootDir = await resolveActiveManagedPluginPackageInstallDir({ packageName: packageId })
  if (rootDir == null) return undefined

  return {
    sourceType: 'package',
    requestId,
    packageId,
    resolvedBy: 'managed-package-cache',
    rootDir
  }
}

const resolveCachedManagedPackageReference = async (
  requestId: string,
  packageId: string,
  version?: string
): Promise<ResolvedPluginReference | undefined> => {
  if (!isManagedPluginPackageName(packageId)) return undefined

  const rootDir = await resolveExistingManagedPluginPackage({
    packageName: packageId,
    version
  })
  if (rootDir == null) return undefined

  return {
    sourceType: 'package',
    requestId,
    packageId,
    resolvedBy: 'managed-package-cache',
    rootDir
  }
}

const resolvePackageReference = async (
  cwd: string,
  id: string,
  version?: string,
  options?: { autoInstallManaged?: boolean; preferInstalled?: boolean }
): Promise<ResolvedPluginReference> => {
  const candidates = shouldTryPrefixedPackageId(id)
    ? [id, `@oneworks/plugin-${id}`, `@vibe-forge/plugin-${id}`]
    : [id]

  if (options?.preferInstalled === true) {
    for (const candidate of candidates) {
      const rootDir = resolveInstalledPackageRoot(cwd, candidate)
      if (rootDir != null) {
        const resolvedBy = candidate === id
          ? 'direct'
          : candidate.startsWith('@oneworks/')
          ? 'oneworks-prefix'
          : 'vibe-forge-prefix'
        return {
          sourceType: 'package',
          requestId: id,
          packageId: candidate,
          resolvedBy,
          rootDir
        }
      }
    }
  }

  for (const candidate of candidates) {
    const activeReference = await resolveActiveManagedPackageReference(id, candidate, version)
    if (activeReference != null) return activeReference
  }

  for (const candidate of candidates) {
    const managedReference = await resolveCachedManagedPackageReference(id, candidate, version)
    if (managedReference != null) return managedReference
  }

  for (const candidate of candidates) {
    const rootDir = resolveInstalledPackageRoot(cwd, candidate)
    if (rootDir != null) {
      const resolvedBy = candidate === id
        ? 'direct'
        : candidate.startsWith('@oneworks/')
        ? 'oneworks-prefix'
        : 'vibe-forge-prefix'
      return {
        sourceType: 'package',
        requestId: id,
        packageId: candidate,
        resolvedBy,
        rootDir
      }
    }
  }

  for (const candidate of candidates) {
    const managedReference = await resolveManagedPackageReference(cwd, id, candidate, version, options)
    if (managedReference != null) return managedReference
  }

  throw new Error(`Failed to resolve plugin package ${id}. Install it in the current workspace first.`)
}

const resolveDirectoryReference = (cwd: string, id: string): ResolvedPluginReference => {
  const rootDir = resolveDirectoryPath(cwd, id)
  if (!existsSync(rootDir)) {
    throw new Error(`Failed to resolve plugin directory ${id}.`)
  }

  return {
    sourceType: 'directory',
    requestId: id,
    resolvedBy: 'direct',
    rootDir
  }
}

const loadManifest = (
  cwd: string,
  packageId: string,
  rootDir?: string
) => {
  const rootEntryPath = resolveOptionalPackageEntryPath(cwd, packageId, rootDir)
  if (rootEntryPath == null) return undefined

  const workspaceRequire = createWorkspaceRequire(cwd)
  try {
    const mod = workspaceRequire(rootEntryPath)
    return toPluginManifest(mod?.default ?? mod)
  } catch (error) {
    throw new Error(`Failed to load plugin manifest for ${packageId}.`, { cause: error })
  }
}

const parseDirectoryManifestFile = async (filePath: string) => {
  const ext = extname(filePath).toLowerCase()
  const raw = await readFile(filePath, 'utf8')
  return ext === '.yaml' || ext === '.yml'
    ? loadYaml(raw)
    : JSON.parse(raw) as unknown
}

const loadDirectoryManifest = async (rootDir: string) => {
  for (const fileName of DIRECTORY_MANIFEST_FILES) {
    const filePath = resolve(rootDir, fileName)
    if (!existsSync(filePath)) continue
    try {
      return toPluginManifest(await parseDirectoryManifestFile(filePath))
    } catch (error) {
      throw new Error(`Failed to load plugin manifest at ${filePath}.`, { cause: error })
    }
  }
  return undefined
}

const hasDirectoryPluginManifest = (rootDir: string) => (
  DIRECTORY_MANIFEST_FILES.some(fileName => existsSync(resolve(rootDir, fileName)))
)

const hasKnownPluginAssetDirectory = async (rootDir: string) => {
  const entries = await readdir(rootDir, { withFileTypes: true })
  return entries.some(entry => entry.isDirectory() && KNOWN_PLUGIN_ASSET_DIRS.includes(entry.name))
}

export const resolvePluginHooksEntryPath = (
  cwd: string,
  packageId: string,
  rootDir?: string
) => resolveOptionalPackageEntryPath(cwd, `${packageId}/hooks`, rootDir)

export const resolvePluginConfigEntryPath = (
  cwd: string,
  packageId: string,
  rootDir?: string
) => resolveOptionalPackageEntryPath(cwd, `${packageId}/config`, rootDir)

export const resolveDirectoryPluginHooksEntryPath = (rootDir: string) => {
  const directPath = resolve(rootDir, 'hooks.js')
  if (existsSync(directPath)) return directPath

  const indexPath = resolve(rootDir, 'hooks', 'index.js')
  return existsSync(indexPath) ? indexPath : undefined
}

export const resolveDirectoryPluginConfigEntryPath = (rootDir: string) => {
  const directPath = resolve(rootDir, 'config.js')
  if (existsSync(directPath)) return directPath

  const indexPath = resolve(rootDir, 'config', 'index.js')
  return existsSync(indexPath) ? indexPath : undefined
}

export const resolvePluginHooksEntryPathForInstance = (
  cwd: string,
  instance: Pick<ResolvedPluginInstance, 'packageId' | 'rootDir'>
) => (
  instance.packageId != null
    ? resolvePluginHooksEntryPath(cwd, instance.packageId, instance.rootDir)
    : resolveDirectoryPluginHooksEntryPath(instance.rootDir)
)

const resolveManifestConfigEntryPath = (
  instance: Pick<ResolvedPluginInstance, 'manifest' | 'rootDir'>
) => {
  const entry = typeof instance.manifest?.configHook === 'string'
    ? instance.manifest.configHook
    : instance.manifest?.configHook?.entry

  if (entry == null || entry.trim() === '') return undefined

  const configPath = resolve(instance.rootDir, entry)
  return existsSync(configPath) ? configPath : undefined
}

export const resolvePluginConfigEntryPathForInstance = (
  cwd: string,
  instance: Pick<ResolvedPluginInstance, 'manifest' | 'packageId' | 'rootDir'>
) => (
  resolveManifestConfigEntryPath(instance) ??
    (
      instance.packageId != null
        ? resolvePluginConfigEntryPath(cwd, instance.packageId, instance.rootDir)
        : resolveDirectoryPluginConfigEntryPath(instance.rootDir)
    )
)

const resolveDirectoryPath = (baseDir: string, path: string) => (
  path.startsWith('/') ? path : resolve(baseDir, path)
)

const collectFallbackDirectoryChildren = async (rootDir: string) => {
  const pluginsDir = resolve(rootDir, 'plugins')
  if (!existsSync(pluginsDir)) return {} as Record<string, PluginManifestChildDefinition>

  const entries = await readdir(pluginsDir, { withFileTypes: true })
  return Object.fromEntries(
    entries
      .filter(entry => entry.isDirectory())
      .map(entry => [
        entry.name,
        {
          source: {
            type: 'directory',
            path: resolve(pluginsDir, entry.name)
          },
          activation: 'optional',
          options: {}
        } satisfies PluginManifestChildDefinition
      ])
  )
}

const collectChildDefinitions = async (
  rootDir: string,
  manifest: PluginManifest | undefined
) => ({
  ...(manifest?.children ?? {}),
  ...await collectFallbackDirectoryChildren(rootDir)
})

const mergeOptions = (
  baseOptions: Record<string, unknown> | undefined,
  overrideOptions: Record<string, unknown> | undefined
) => ({
  ...(baseOptions ?? {}),
  ...(overrideOptions ?? {})
})

const hasExplicitChildOverride = (children: PluginChildConfig[], childId: string) => (
  children.some(child => child.id === childId)
)

const resolveChildReference = async (
  cwd: string,
  parent: ResolvedPluginInstance,
  childConfig: PluginChildConfig,
  options?: { autoInstallManaged?: boolean }
): Promise<{
  reference: ResolvedPluginReference
  manifestChild?: PluginManifestChildDefinition
}> => {
  const manifestChild = parent.childDefinitions[childConfig.id]
  if (manifestChild == null) {
    return {
      reference: await resolvePackageReference(cwd, childConfig.id, childConfig.version, options)
    }
  }

  if (manifestChild.source.type === 'package') {
    const reference = await resolvePackageReference(cwd, manifestChild.source.id, childConfig.version, options)
    return {
      reference: {
        ...reference,
        requestId: childConfig.id,
        resolvedBy: 'manifest-package'
      },
      manifestChild
    }
  }

  return {
    reference: {
      sourceType: 'directory',
      requestId: childConfig.id,
      resolvedBy: 'manifest-directory',
      rootDir: resolveDirectoryPath(parent.rootDir, manifestChild.source.path)
    },
    manifestChild
  }
}

const resolveTopLevelReference = async (
  cwd: string,
  config: PluginInstanceConfig,
  options?: { autoInstallManaged?: boolean; preferBundledOfficialPlugins?: boolean }
) => {
  if (isTopLevelDirectoryReference(config.id)) {
    return resolveDirectoryReference(cwd, config.id)
  }

  return await resolvePackageReference(cwd, config.id, config.version, {
    autoInstallManaged: options?.autoInstallManaged,
    preferInstalled: options?.preferBundledOfficialPlugins === true &&
      config.version == null &&
      DEFAULT_OFFICIAL_PLUGIN_PACKAGE_IDS.has(config.id)
  })
}

interface ResolvePluginInstanceParams {
  cwd: string
  config: PluginInstanceConfig | PluginChildConfig
  instancePath: string
  overlaySource?: string
  inheritedScope?: string
  parent?: ResolvedPluginInstance
  resolvedReference?: ResolvedPluginReference
  ancestorKeys?: string[]
  autoInstallManaged?: boolean
  preferBundledOfficialPlugins?: boolean
}

const resolveInstance = async (
  params: ResolvePluginInstanceParams
): Promise<ResolvedPluginInstance> => {
  const {
    cwd,
    config,
    instancePath,
    overlaySource,
    inheritedScope,
    parent,
    resolvedReference,
    ancestorKeys = []
  } = params

  const {
    reference,
    manifestChild
  } = parent == null
    ? {
      reference: resolvedReference ??
        await resolveTopLevelReference(cwd, config as PluginInstanceConfig, {
          autoInstallManaged: params.autoInstallManaged,
          preferBundledOfficialPlugins: params.preferBundledOfficialPlugins
        }),
      manifestChild: undefined
    }
    : await resolveChildReference(cwd, parent, config, { autoInstallManaged: params.autoInstallManaged })

  const cycleKey = `${reference.sourceType}:${reference.packageId ?? reference.rootDir}`
  if (ancestorKeys.includes(cycleKey)) {
    throw new Error(`Detected cyclic child plugin graph at ${config.id}`)
  }

  const manifest = reference.packageId != null
    ? loadManifest(cwd, reference.packageId, reference.rootDir)
    : await loadDirectoryManifest(reference.rootDir)
  const childDefinitions = await collectChildDefinitions(reference.rootDir, manifest)
  const scope = config.scope ?? inheritedScope
  const options = mergeOptions(
    manifestChild?.options,
    normalizeOptions(config.options)
  )

  const explicitChildren = config.children ?? []
  const autoChildren: PluginChildConfig[] = Object.entries(childDefinitions)
    .filter(([childId, child]) =>
      child.activation === 'default' && !hasExplicitChildOverride(explicitChildren, childId)
    )
    .map(([childId, child]) => ({
      id: childId,
      options: child.options
    }))

  const childConfigs = [
    ...explicitChildren.filter(child => child.enabled !== false),
    ...autoChildren
  ]

  const nextAncestorKeys = [...ancestorKeys, cycleKey]
  const children = await Promise.all(
    childConfigs.map((child, index) =>
      resolveInstance({
        cwd,
        config: child!,
        instancePath: `${instancePath}.children.${index}`,
        overlaySource,
        inheritedScope: scope,
        parent: {
          requestId: config.id,
          packageId: reference.packageId,
          requestedVersion: config.version,
          sourceType: reference.sourceType,
          rootDir: reference.rootDir,
          scope,
          watch: config.watch,
          options,
          manifest,
          instancePath,
          resolvedBy: reference.resolvedBy,
          overlaySource,
          childDefinitions,
          children: []
        },
        ancestorKeys: nextAncestorKeys,
        autoInstallManaged: params.autoInstallManaged,
        preferBundledOfficialPlugins: params.preferBundledOfficialPlugins
      })
    )
  )

  return {
    requestId: config.id,
    packageId: reference.packageId,
    requestedVersion: config.version,
    sourceType: reference.sourceType,
    rootDir: reference.rootDir,
    enabled: config.enabled !== false,
    scope,
    watch: config.watch,
    options,
    manifest,
    instancePath,
    resolvedBy: reference.resolvedBy,
    overlaySource,
    childDefinitions,
    children
  }
}

export const flattenPluginInstances = (plugins: ResolvedPluginInstance[]): ResolvedPluginInstance[] => (
  plugins.flatMap(plugin => [plugin, ...flattenPluginInstances(plugin.children)])
)

export const mergePluginConfigs = (
  projectPlugins: PluginConfig | undefined,
  userPlugins: PluginConfig | undefined
): PluginConfig | undefined => {
  const merged = [...(normalizePluginConfig(projectPlugins, 'project.plugins') ?? [])]
  for (const plugin of normalizePluginConfig(userPlugins, 'user.plugins') ?? []) {
    for (let index = merged.length - 1; index >= 0; index--) {
      if (merged[index].id === plugin.id && merged[index].scope === plugin.scope) {
        merged.splice(index, 1)
      }
    }
    merged.push(plugin)
  }
  return merged.length > 0 ? merged : undefined
}

const resolveGlobalPluginsRoot = (env: Record<string, string | null | undefined> = process.env) =>
  resolveGlobalOneWorksAssetsPath(env, 'plugins')

const isGlobalPluginDiscoveryDisabled = (
  options?: {
    disableGlobalConfig?: boolean
    env?: Record<string, string | null | undefined>
  }
) => options?.disableGlobalConfig === true || options?.env?.[DISABLE_GLOBAL_CONFIG_ENV] === '1'

const shouldIncludeDefaultOfficialPlugins = (params: {
  env?: Record<string, string | null | undefined>
  includeDefaultOfficialPlugins?: boolean
}) => params.includeDefaultOfficialPlugins === true && params.env?.[DISABLE_DEFAULT_OFFICIAL_PLUGINS_ENV] !== '1'

const isDiscoverablePluginRoot = async (rootDir: string) => {
  if (hasDirectoryPluginManifest(rootDir)) return true

  try {
    return await hasKnownPluginAssetDirectory(rootDir)
  } catch {
    return false
  }
}

const discoverPluginConfigsInRoot = async (
  rootDir: string,
  skippedRoots: Set<string>,
  options?: { watch?: boolean }
): Promise<PluginConfig> => {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true })
    const configs: PluginConfig = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childRoot = resolve(rootDir, entry.name)
      if (skippedRoots.has(childRoot)) continue
      if (existsSync(resolve(childRoot, '.oneworks-plugin.json'))) continue
      if (!await isDiscoverablePluginRoot(childRoot)) continue
      configs.push({ id: childRoot, ...(options?.watch === true ? { watch: true } : {}) })
    }
    return configs
  } catch {
    return []
  }
}

export const discoverRuntimePluginConfigs = async (params: {
  cwd: string
  env?: Record<string, string | null | undefined>
  disableGlobalConfig?: boolean
}): Promise<{
  autoDiscovered: PluginConfig
}> => {
  const env = params.env ?? process.env
  const skippedRoots = new Set<string>()

  const roots = [
    ...(
      isGlobalPluginDiscoveryDisabled(params)
        ? []
        : [{ root: resolveGlobalPluginsRoot(env), watch: false }]
    ),
    { root: resolveProjectOoPath(params.cwd, env, 'plugins.dev'), watch: true }
  ]
  const discoveredLists = await Promise.all(
    roots.map(({ root, watch }) => discoverPluginConfigsInRoot(root, skippedRoots, { watch }))
  )
  return {
    autoDiscovered: discoveredLists.flat()
  }
}

export const resolveRuntimePluginConfig = async (params: {
  cwd: string
  plugins?: PluginConfig
  env?: Record<string, string | null | undefined>
  disableGlobalConfig?: boolean
  includeDefaultOfficialPlugins?: boolean
}): Promise<PluginConfig | undefined> => {
  const discovered = await discoverRuntimePluginConfigs(params)
  return mergePluginConfigs(
    [
      ...(shouldIncludeDefaultOfficialPlugins(params) ? DEFAULT_OFFICIAL_PLUGIN_CONFIGS : []),
      ...discovered.autoDiscovered
    ],
    params.plugins
  )
}

const toResolvedPluginKey = (reference: ResolvedPluginReference) => (
  reference.packageId != null
    ? `package:${reference.packageId}`
    : `directory:${reference.rootDir}`
)

const removeResolvedPluginByKey = (
  instances: ResolvedPluginInstance[],
  resolvedKeys: string[],
  key: string
) => {
  for (let index = resolvedKeys.length - 1; index >= 0; index--) {
    if (resolvedKeys[index] !== key) continue
    resolvedKeys.splice(index, 1)
    instances.splice(index, 1)
  }
}

const assertUniquePluginScopes = (instances: ResolvedPluginInstance[]) => {
  const seen = new Map<string, ResolvedPluginInstance>()
  for (const instance of flattenPluginInstances(instances)) {
    if (instance.scope == null) continue
    const existing = seen.get(instance.scope)
    if (existing != null) {
      throw new Error(
        `Conflicting plugin scope "${instance.scope}" for ${existing.requestId} and ${instance.requestId}.`
      )
    }
    seen.set(instance.scope, instance)
  }
}

export const resolveConfiguredPluginInstances = async (params: {
  cwd: string
  plugins?: PluginConfig
  overlaySource?: string
  includeDisabled?: boolean
  autoInstallManaged?: boolean
  preferBundledOfficialPlugins?: boolean
}) => {
  const pluginConfigs = normalizePluginConfig(
    params.plugins,
    params.overlaySource != null ? `${params.overlaySource}.plugins` : 'plugins'
  )
  const instances: ResolvedPluginInstance[] = []
  const resolvedKeys: string[] = []
  for (const [index, config] of (pluginConfigs ?? []).entries()) {
    const reference = await resolveTopLevelReference(params.cwd, config, {
      autoInstallManaged: params.autoInstallManaged,
      preferBundledOfficialPlugins: params.preferBundledOfficialPlugins
    })
    const key = toResolvedPluginKey(reference)
    removeResolvedPluginByKey(instances, resolvedKeys, key)
    if (config.enabled === false && params.includeDisabled !== true) continue
    instances.push(
      await resolveInstance({
        cwd: params.cwd,
        config,
        instancePath: String(index),
        overlaySource: params.overlaySource,
        resolvedReference: reference,
        autoInstallManaged: params.autoInstallManaged,
        preferBundledOfficialPlugins: params.preferBundledOfficialPlugins
      })
    )
    resolvedKeys.push(key)
  }
  assertUniquePluginScopes(instances)
  return instances
}
