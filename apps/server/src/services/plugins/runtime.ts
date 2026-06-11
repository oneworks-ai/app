/* eslint-disable max-lines -- plugin manager keeps runtime lifecycle, watch, command, API, and launcher coordination together. */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { createReadStream, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { updateConfigFile } from '@oneworks/config'
import type {
  PluginConfig,
  PluginDetailAssetFile,
  PluginDetailAssetGroup,
  PluginDetailAssetKind,
  PluginInstanceConfig,
  PluginReadmeVariant,
  PluginRuntimeApiRegistration
} from '@oneworks/types'
import {
  resolveGlobalOneWorksAssetsPath,
  resolveGlobalOneWorksDir,
  resolveProjectOoPath
} from '@oneworks/utils/ai-path'
import type { ResolvedPluginInstance } from '@oneworks/utils/plugin-resolver'

import { loadConfigState } from '#~/services/config/index.js'
import { logger } from '#~/utils/logger.js'

import { discoverPluginInstances } from './discovery.js'
import { loadPluginRuntimeManifest, resolvePluginClientAssetRoot, resolvePluginServerEntryPath } from './manifest.js'
import { isLoopbackProxyTarget, proxyToLoopbackTarget } from './proxy.js'
import { createPluginSessionAdapter } from './session-adapter.js'
import type {
  PluginApiRegistration,
  PluginCommandHandler,
  PluginCommandInvocation,
  PluginContributionLauncherSearchProvider,
  PluginDiagnostic,
  PluginProxyRequest,
  PluginRuntimeInstance,
  PluginRuntimeManifest,
  PluginServerContext
} from './types.js'
import { PLUGIN_ID_PATTERN } from './types.js'

const nodeRequire = createRequire(__filename)

interface RuntimeRecord {
  instance: PluginRuntimeInstance
  raw: ResolvedPluginInstance
  manifest: PluginRuntimeManifest
  clientAssetRoot: string
  commands: Map<string, PluginCommandHandler>
  apis: Map<string, PluginApiRegistration>
  disposables: Array<() => unknown | Promise<unknown>>
  watchTimer?: NodeJS.Timeout
  watcher?: FSWatcher
}

interface DiscoveryWatcher {
  root: string
  watcher: FSWatcher
}

export interface PluginManagerSnapshot {
  plugins: PluginRuntimeInstance[]
  diagnostics: PluginDiagnostic[]
}

export interface PluginReadme extends PluginReadmeVariant {}

export interface PluginWatchEvent {
  type: 'plugin.changed' | 'plugin.watch.updated'
  scope: string
  watch?: {
    enabled: boolean
  }
  path?: string
}

interface PluginWatchSubscriber {
  send: (data: string) => void
}

const BUILTIN_SCOPE_KEYS = new Set([
  'sessions',
  'config',
  'workspace',
  'agent-rooms',
  'adapters',
  'auth',
  'ai',
  'benchmark',
  'automation',
  'webpage',
  'worktree-environments'
])

const PLUGIN_WATCH_DEBOUNCE_MS = 120
const MAX_PLUGIN_README_BYTES = 1024 * 1024
const MAX_PLUGIN_DETAIL_ASSET_BYTES = 256 * 1024
const MAX_PLUGIN_DETAIL_ASSET_FILES = 200
const README_FILE_NAMES = ['README.md', 'README.MD', 'Readme.md', 'readme.md', 'README.markdown', 'readme.markdown']
const README_BASE_FILE_PRIORITY = new Map(README_FILE_NAMES.map((fileName, index) => [fileName, index]))
const README_VARIANT_PATTERN = /^readme(?:\.([\w-]+))?\.(?:md|markdown)$/i
const IGNORED_WATCH_PATH_PARTS = new Set(['.git', 'node_modules'])
const DISCOVERY_WATCH_FILE_NAMES = new Set(['package.json', 'plugin.json', 'plugin.yaml', 'plugin.yml'])
const HOST_VITE_SELF_HANDLED_CLIENT_EXTENSIONS = new Set([
  '.css',
  '.jsx',
  '.less',
  '.postcss',
  '.sass',
  '.scss',
  '.styl',
  '.stylus',
  '.tsx'
])
const DETAIL_ASSET_GROUPS = [
  { kind: 'skills', defaultPath: 'skills' },
  { kind: 'mcp', defaultPath: 'mcp' },
  { kind: 'hooks', defaultPath: 'hooks', extraFiles: ['hooks.js', 'hooks.mjs', 'hooks.cjs'] }
] as const satisfies Array<{
  defaultPath: string
  extraFiles?: string[]
  kind: PluginDetailAssetKind
}>
const TEXT_ASSET_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.md',
  '.markdown',
  '.mjs',
  '.toml',
  '.ts',
  '.txt',
  '.yaml',
  '.yml'
])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const getApiDescription = (api: PluginApiRegistration) => api.description ?? api.desc

const hasLocalizedText = (value: unknown) => {
  if (typeof value === 'string') return value.trim() !== ''
  if (!isRecord(value)) return false
  return Object.values(value).some(entry => typeof entry === 'string' && entry.trim() !== '')
}

const hasApiSchema = (value: unknown) => isRecord(value)

const getMissingApiDocumentationFields = (api: PluginApiRegistration) => {
  const missing: string[] = []
  if (!hasLocalizedText(api.title)) missing.push('title')
  if (!hasLocalizedText(getApiDescription(api))) missing.push('description')
  if (!hasApiSchema(api.inputSchema)) missing.push('inputSchema')
  if (!hasApiSchema(api.outputSchema)) missing.push('outputSchema')
  if (!hasApiSchema(api.headerSchema)) missing.push('headerSchema')
  return missing
}

const validateApiSchemaField = (apiId: string, field: string, value: unknown, scope: string) => {
  if (value == null) return
  if (!isRecord(value)) {
    throw new Error(`Plugin API "${scope}/${apiId}" ${field} must be a JSON Schema object.`)
  }
}

const serializeApiRegistration = (
  scope: string,
  api: PluginApiRegistration
): PluginRuntimeApiRegistration => ({
  id: api.apiId,
  mode: api.proxy?.target == null ? 'handler' : 'proxy',
  target: `/api/plugins/${encodeURIComponent(scope)}/proxy/${encodeURIComponent(api.apiId)}`,
  ...(api.proxy?.target == null ? {} : { proxyTarget: api.proxy.target }),
  ...(api.title == null ? {} : { title: api.title }),
  ...(getApiDescription(api) == null ? {} : { description: getApiDescription(api) }),
  ...(api.inputSchema == null ? {} : { inputSchema: api.inputSchema }),
  ...(api.outputSchema == null ? {} : { outputSchema: api.outputSchema }),
  ...(api.headerSchema == null ? {} : { headerSchema: api.headerSchema })
})

const extractReadmeLanguage = (fileName: string) => {
  const match = README_VARIANT_PATTERN.exec(fileName)
  return match?.[1]
}

const compareReadmeFileNames = (a: string, b: string) => {
  const aLanguage = extractReadmeLanguage(a)
  const bLanguage = extractReadmeLanguage(b)
  if (aLanguage == null && bLanguage != null) return -1
  if (aLanguage != null && bLanguage == null) return 1
  if (aLanguage == null && bLanguage == null) {
    return (README_BASE_FILE_PRIORITY.get(a) ?? README_FILE_NAMES.length) -
      (README_BASE_FILE_PRIORITY.get(b) ?? README_FILE_NAMES.length)
  }
  return a.localeCompare(b)
}

const toPosixPath = (filePath: string) => filePath.split(path.sep).join('/')

const getDetailAssetContentKind = (filePath: string): PluginDetailAssetFile['contentKind'] => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (TEXT_ASSET_EXTENSIONS.has(extension)) return 'text'
  return 'binary'
}

const sanitizeScopePart = (value: string) => (
  value
    .replace(/^@/, '')
    .replace(/^oneworks[/-]plugin[/-]/, '')
    .replace(/^plugin[/-]/, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
)

const deriveScope = (instance: ResolvedPluginInstance) => {
  if (instance.scope?.trim()) return instance.scope.trim()
  const source = instance.packageId ?? path.basename(instance.rootDir)
  const parts = source.split('/')
  return sanitizeScopePart(parts[parts.length - 1]) || 'plugin'
}

const normalizeEntryPathForUrl = (entry: string | undefined) => {
  if (entry == null || entry.trim() === '') return undefined
  return entry.replace(/^[./\\]+/, '').replace(/\\/g, '/')
}

const isTranspiledServerEntry = (entryPath: string) => (
  ['.ts', '.tsx', '.mts', '.cts'].includes(path.extname(entryPath).toLowerCase())
)

const clearRequireCacheInsideRoot = (root: string) => {
  const normalizedRoot = path.resolve(root)
  for (const cacheKey of Object.keys(nodeRequire.cache)) {
    const normalizedKey = path.resolve(cacheKey)
    if (normalizedKey === normalizedRoot || normalizedKey.startsWith(`${normalizedRoot}${path.sep}`)) {
      delete nodeRequire.cache[cacheKey]
    }
  }
}

const loadPluginServerModule = async (entryPath: string, pluginRoot: string) => {
  if (!isTranspiledServerEntry(entryPath)) {
    return await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`) as unknown
  }

  nodeRequire('@oneworks/register/esbuild')
  clearRequireCacheInsideRoot(pluginRoot)
  return nodeRequire(entryPath) as unknown
}

const resolveClientEntryUrlPath = (manifest: PluginRuntimeManifest, entry = manifest.plugin?.client?.entry) => {
  const client = manifest.plugin?.client
  const normalizedEntry = normalizeEntryPathForUrl(entry)
  if (normalizedEntry == null) return undefined
  if (typeof client?.root === 'string' && client.root.trim() !== '') {
    const rootPath = normalizeEntryPathForUrl(client.root) ?? ''
    const relativeEntry = path.posix.relative(rootPath, normalizedEntry)
    return relativeEntry === '' || relativeEntry.startsWith('..') ? normalizedEntry : relativeEntry
  }
  return path.posix.basename(normalizedEntry)
}

const normalizeHostViteBasePath = () => {
  const rawBase = process.env.__ONEWORKS_PROJECT_CLIENT_BASE__?.trim() || '/'
  const base = /^[a-z][a-z\d+.-]*:\/\//i.test(rawBase) || rawBase.startsWith('/') ? rawBase : `/${rawBase}`
  const pathname = new URL(base, 'http://vibe.local').pathname
  return pathname === '/' ? '' : pathname.replace(/\/$/, '')
}

const resolveHostViteDevClientEntryUrl = async (
  pluginRoot: string,
  manifest: PluginRuntimeManifest,
  devEntryPath: string | undefined,
  allowedRoots: string[]
) => {
  const client = manifest.plugin?.client
  if (client?.devServer != null) return undefined
  const normalizedEntry = normalizeEntryPathForUrl(devEntryPath)
  if (normalizedEntry == null) return undefined
  const absoluteEntry = path.resolve(pluginRoot, normalizedEntry)
  const entryStat = await stat(absoluteEntry).catch(() => undefined)
  if (entryStat?.isFile() !== true) return undefined
  const [realPluginRoot, realEntry, realAllowedRoots] = await Promise.all([
    realpath(pluginRoot).catch(() => path.resolve(pluginRoot)),
    realpath(absoluteEntry),
    Promise.all(allowedRoots.map(root => realpath(root).catch(() => path.resolve(root))))
  ])
  if (!isPathInside(realPluginRoot, realEntry)) return undefined
  if (!realAllowedRoots.some(root => isPathInside(root, realEntry))) return undefined
  return `${normalizeHostViteBasePath()}/@fs/${encodeURI(toPosixPath(realEntry).replace(/^\/+/, ''))}`
}

const parseHostViteExtraAllowedRoots = () => {
  const raw = process.env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__?.trim()
  if (raw == null || raw === '') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    }
  } catch {}
  return raw.split(path.delimiter).filter(value => value.trim() !== '')
}

const getHostViteDevClientAllowedRoots = () => [
  resolveGlobalOneWorksDir(process.env),
  ...parseHostViteExtraAllowedRoots()
]

const getHostViteDevClientSourceRoot = (record: RuntimeRecord) => {
  if (record.instance.client?.devClientEntryUrl?.includes('/@fs/') !== true) return undefined
  const devEntry = normalizeEntryPathForUrl(record.manifest.plugin?.client?.devEntry)
  if (devEntry == null) return undefined
  return path.dirname(path.resolve(record.instance.pluginRoot, devEntry))
}

const getHostViteDevClientEntryPath = (record: RuntimeRecord) => {
  if (record.instance.client?.devClientEntryUrl?.includes('/@fs/') !== true) return undefined
  const devEntry = normalizeEntryPathForUrl(record.manifest.plugin?.client?.devEntry)
  if (devEntry == null) return undefined
  return path.resolve(record.instance.pluginRoot, devEntry)
}

const shouldSkipPluginReloadForHostViteClientChange = (record: RuntimeRecord, relativePath: string) => {
  if (relativePath === '') return false
  const sourceRoot = getHostViteDevClientSourceRoot(record)
  if (sourceRoot == null) return false
  const changedPath = path.resolve(record.instance.pluginRoot, relativePath)
  if (!isPathInside(sourceRoot, changedPath)) return false
  if (changedPath === getHostViteDevClientEntryPath(record)) return false
  return HOST_VITE_SELF_HANDLED_CLIENT_EXTENSIONS.has(path.extname(changedPath).toLowerCase())
}

const validateId = (kind: string, id: string, scope?: string) => {
  if (!PLUGIN_ID_PATTERN.test(id)) {
    throw new Error(`Invalid plugin ${kind} "${id}"${scope == null ? '' : ` in scope "${scope}"`}.`)
  }
}

const isPathOutside = (relativePath: string) => (
  relativePath === '..' ||
  relativePath.startsWith('../') ||
  relativePath.startsWith('..\\') ||
  path.isAbsolute(relativePath)
)

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

const resolveGlobalPluginsRoot = () => resolveGlobalOneWorksAssetsPath(process.env, 'plugins')

const readRequestBody = async (request: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

const serializePlugin = (record: RuntimeRecord): PluginRuntimeInstance => ({
  ...record.instance,
  apis: [...record.apis.values()].map(api => serializeApiRegistration(record.instance.scope, api)),
  diagnostics: [...record.instance.diagnostics]
})

const shouldIgnoreWatchPath = (relativePath: string) => {
  if (relativePath === '') return false
  if (relativePath.endsWith('.DS_Store')) return true
  return relativePath.split(/[\\/]/).some(part => IGNORED_WATCH_PATH_PARTS.has(part))
}

const shouldReloadForDiscoveryPath = (relativePath: string) => {
  if (shouldIgnoreWatchPath(relativePath)) return false
  if (relativePath === '') return true
  const parts = relativePath.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return true
  if (parts.length === 1) return true
  if (parts.length === 2 && DISCOVERY_WATCH_FILE_NAMES.has(parts[1] ?? '')) return true
  return false
}

export class PluginManager {
  private loading?: Promise<void>
  private loaded = false
  private records = new Map<string, RuntimeRecord>()
  private diagnostics: PluginDiagnostic[] = []
  private discoveryWatchers: DiscoveryWatcher[] = []
  private discoveryWatchTimer?: NodeJS.Timeout
  private enabledOverrides = new Map<string, boolean>()
  private watchOverrides = new Map<string, boolean>()
  private watchSubscribers = new Map<PluginWatchSubscriber, string | undefined>()
  private workspaceFolder = ''
  private projectHome = ''

  async load() {
    if (this.loaded) return
    this.loading ??= this.loadInternal()
    await this.loading
  }

  async reload() {
    await this.dispose()
    this.loading = undefined
    this.loaded = false
    await this.load()
  }

  async dispose() {
    this.loaded = false
    this.loading = undefined
    const records = [...this.records.values()]
    this.records.clear()
    this.stopDiscoveryWatch()
    for (const record of records) {
      this.stopRecordWatch(record)
      for (const disposable of record.disposables.reverse()) {
        await Promise.resolve(disposable()).catch(error => {
          logger.warn({ err: error, scope: record.instance.scope }, '[plugins] dispose failed')
        })
      }
    }
  }

  snapshot(): PluginManagerSnapshot {
    return {
      plugins: [...this.records.values()].map(serializePlugin),
      diagnostics: [...this.diagnostics]
    }
  }

  getRecord(scope: string) {
    return this.records.get(scope)
  }

  subscribeWatchEvents(subscriber: PluginWatchSubscriber, scope?: string) {
    this.watchSubscribers.set(subscriber, scope)
    return () => {
      this.watchSubscribers.delete(subscriber)
    }
  }

  async setWatch(scope: string, enabled: boolean) {
    await this.load()
    validateId('scope', scope)
    const record = this.records.get(scope)
    if (record == null) {
      throw new Error(`Plugin scope "${scope}" is not registered.`)
    }

    this.watchOverrides.set(scope, enabled)
    await this.reload()
    const nextRecord = this.records.get(scope)
    this.notifyWatchEvent({
      type: 'plugin.watch.updated',
      scope,
      watch: nextRecord?.instance.watch ?? { enabled }
    })
    this.notifyWatchEvent({
      type: 'plugin.changed',
      scope
    })
    return nextRecord?.instance.watch ?? { enabled }
  }

  async setEnabled(scope: string, enabled: boolean, target: 'workspace' | 'global' = 'workspace') {
    await this.load()
    validateId('scope', scope)
    const record = this.records.get(scope)
    if (record == null) {
      throw new Error(`Plugin scope "${scope}" is not registered.`)
    }

    await this.writePluginEnabledConfig(record.raw, enabled, target)
    this.enabledOverrides.set(scope, enabled)
    await this.reload()
    const nextRecord = this.records.get(scope)
    this.notifyWatchEvent({
      type: 'plugin.changed',
      scope
    })
    return {
      enabled: nextRecord?.instance.enabled ?? enabled
    }
  }

  async setOptions(
    scope: string,
    options: Record<string, unknown>,
    target: 'workspace' | 'global' = 'workspace'
  ) {
    await this.load()
    validateId('scope', scope)
    const record = this.records.get(scope)
    if (record == null) {
      throw new Error(`Plugin scope "${scope}" is not registered.`)
    }

    await this.writePluginOptionsConfig(record.raw, options, target)
    await this.reload()
    const nextRecord = this.records.get(scope)
    this.notifyWatchEvent({
      type: 'plugin.changed',
      scope
    })
    return {
      options: nextRecord?.instance.options ?? options
    }
  }

  async invokeCommand(scope: string, commandId: string, invocation: PluginCommandInvocation) {
    await this.load()
    validateId('command id', commandId, scope)
    const record = this.records.get(scope)
    if (record == null || !record.instance.enabled) {
      throw new Error(`Plugin scope "${scope}" is not registered.`)
    }
    const handler = record.commands.get(commandId)
    if (handler == null) {
      throw new Error(`Plugin command "${scope}/${commandId}" is not registered.`)
    }
    return await handler(invocation.payload)
  }

  async resolveClientAsset(scope: string, assetPath: string) {
    await this.load()
    const record = this.records.get(scope)
    if (record == null || !record.instance.enabled) return undefined

    const defaultAssetPath = resolveClientEntryUrlPath(record.manifest) ?? ''
    const asset = await this.resolveScopedFile(record.clientAssetRoot, assetPath || defaultAssetPath)
    if (asset == null) {
      return undefined
    }
    return {
      filePath: asset.filePath,
      size: asset.size,
      stream: createReadStream(asset.filePath)
    }
  }

  async readReadme(scope: string): Promise<PluginReadme | undefined> {
    return (await this.readReadmes(scope))[0]
  }

  async readReadmes(scope: string): Promise<PluginReadme[]> {
    await this.load()
    const record = this.records.get(scope)
    if (record == null) {
      throw new Error(`Plugin scope "${scope}" is not registered.`)
    }

    const entries = await readdir(record.instance.pluginRoot, { withFileTypes: true }).catch(() => [])
    const fileNames = [
      ...entries
        .filter(entry => entry.isFile() && README_VARIANT_PATTERN.test(entry.name))
        .map(entry => entry.name),
      ...README_FILE_NAMES
    ]
    const candidates = [...new Set(fileNames)].sort(compareReadmeFileNames)
    const readmes: PluginReadme[] = []
    const seenFilePaths = new Set<string>()
    for (const fileName of candidates) {
      const file = await this.resolveScopedFile(record.instance.pluginRoot, fileName)
      if (file == null) continue
      if (seenFilePaths.has(file.filePath)) continue
      seenFilePaths.add(file.filePath)
      if (file.size > MAX_PLUGIN_README_BYTES) {
        throw new Error(`Plugin README.md for scope "${scope}" is too large.`)
      }
      readmes.push({
        path: fileName,
        ...(extractReadmeLanguage(fileName) == null ? {} : { language: extractReadmeLanguage(fileName) }),
        content: await readFile(file.filePath, 'utf8')
      })
    }
    return readmes
  }

  async listDetailAssets(scope: string): Promise<PluginDetailAssetGroup[]> {
    await this.load()
    const record = this.records.get(scope)
    if (record == null) {
      throw new Error(`Plugin scope "${scope}" is not registered.`)
    }

    const groups: PluginDetailAssetGroup[] = []
    for (const group of DETAIL_ASSET_GROUPS) {
      const configuredPath = this.getDetailAssetPath(record, group.kind) ?? group.defaultPath
      const files = await this.collectDetailAssetFiles(record.instance.pluginRoot, configuredPath)
      const extraFiles = 'extraFiles' in group ? group.extraFiles : []
      for (const extraFile of extraFiles) {
        if (configuredPath === extraFile || files.some(file => file.path === extraFile)) continue
        const file = await this.readDetailAssetFile(record.instance.pluginRoot, extraFile)
        if (file != null) files.push(file)
      }
      groups.push({
        kind: group.kind,
        files: files
          .sort((a, b) => a.path.localeCompare(b.path))
          .slice(0, MAX_PLUGIN_DETAIL_ASSET_FILES)
      })
    }
    return groups
  }

  async resolveReadmeAsset(scope: string, assetPath: string) {
    await this.load()
    const record = this.records.get(scope)
    if (record == null) return undefined

    const asset = await this.resolveScopedFile(record.instance.pluginRoot, assetPath)
    if (asset == null) return undefined
    return {
      filePath: asset.filePath,
      size: asset.size,
      stream: createReadStream(asset.filePath)
    }
  }

  async handleProxy(scope: string, apiId: string, request: PluginProxyRequest) {
    await this.load()
    validateId('api id', apiId, scope)
    const record = this.records.get(scope)
    if (record == null || !record.instance.enabled) {
      throw new Error(`Plugin scope "${scope}" is not registered.`)
    }
    const api = record.apis.get(apiId)
    if (api == null) {
      throw new Error(`Plugin API "${scope}/${apiId}" is not registered.`)
    }
    if (api.handler != null) {
      return await api.handler(request)
    }
    if (api.proxy?.target != null) {
      return await proxyToLoopbackTarget(api.proxy.target, request)
    }
    throw new Error(`Plugin API "${scope}/${apiId}" has no handler or proxy target.`)
  }

  async handleDevAsset(scope: string, request: PluginProxyRequest) {
    await this.load()
    const record = this.records.get(scope)
    if (record == null || !record.instance.enabled) {
      throw new Error(`Plugin scope "${scope}" is not registered.`)
    }
    const devServer = record.manifest.plugin?.client?.devServer
    if (typeof devServer !== 'string' || devServer.trim() === '') {
      throw new Error(`Plugin scope "${scope}" has no dev server.`)
    }
    if (!isLoopbackProxyTarget(devServer)) {
      throw new Error(`Plugin scope "${scope}" dev server must be loopback HTTP(S).`)
    }
    return await proxyToLoopbackTarget(devServer, request)
  }

  async searchLauncher(query: string) {
    await this.load()
    const results: unknown[] = []

    for (const record of this.records.values()) {
      if (!record.instance.enabled) continue

      const providers = this.getLauncherProviders(record)
      for (const provider of providers) {
        const commandId = provider.command.startsWith(`${record.instance.scope}.`)
          ? provider.command.slice(record.instance.scope.length + 1)
          : provider.command
        const handler = record.commands.get(commandId)
        if (handler == null) {
          record.instance.diagnostics.push({
            level: 'warning',
            code: 'launcher_command_missing',
            message:
              `Launcher provider "${record.instance.scope}/${provider.id}" command "${provider.command}" is not registered.`,
            scope: record.instance.scope,
            pluginRoot: record.instance.pluginRoot
          })
          continue
        }
        const value = await handler({ query, providerId: provider.id })
        if (Array.isArray(value)) {
          results.push(...value.map(item => this.withLauncherResultId(record.instance.scope, provider.id, item)))
        } else if (value != null) {
          results.push(this.withLauncherResultId(record.instance.scope, provider.id, value))
        }
      }
    }

    return { results }
  }

  async invokeLauncherResult(resultId: string) {
    await this.load()
    const parts = resultId.split('/')
    if (parts.length < 3) {
      throw new Error(`Invalid launcher result id "${resultId}".`)
    }
    const [scope, providerId, itemId] = parts
    validateId('scope', scope)
    validateId('launcher provider id', providerId, scope)

    const record = this.records.get(scope)
    if (record == null || !record.instance.enabled) {
      throw new Error(`Plugin scope "${scope}" is not registered.`)
    }
    const provider = this.getLauncherProviders(record).find(item => item.id === providerId)
    if (provider == null) {
      throw new Error(`Launcher provider "${scope}/${providerId}" is not registered.`)
    }
    const commandId = provider.command.startsWith(`${scope}.`)
      ? provider.command.slice(scope.length + 1)
      : provider.command
    const handler = record.commands.get(commandId)
    if (handler == null) {
      throw new Error(`Plugin command "${scope}/${commandId}" is not registered.`)
    }
    return await handler({ resultId, providerId, itemId, action: 'invoke' })
  }

  async createProxyRequest(ctx: {
    method: string
    path: string
    querystring: string
    headers: NodeJS.Dict<string | string[]>
    req: NodeJS.ReadableStream
  }, pathValue: string): Promise<PluginProxyRequest> {
    return {
      method: ctx.method,
      path: pathValue,
      query: ctx.querystring === '' ? '' : `?${ctx.querystring}`,
      headers: ctx.headers,
      body: await readRequestBody(ctx.req)
    }
  }

  private async loadInternal() {
    this.diagnostics = []
    this.records.clear()

    let discovered: Awaited<ReturnType<typeof discoverPluginInstances>>
    try {
      discovered = await discoverPluginInstances()
    } catch (error) {
      this.diagnostics.push({
        level: 'error',
        code: 'plugin_discovery_failed',
        message: `Failed to discover plugins: ${toErrorMessage(error)}`
      })
      this.loaded = true
      return
    }

    this.workspaceFolder = discovered.workspaceFolder
    this.projectHome = discovered.projectHome

    for (const raw of discovered.instances) {
      await this.addInstance(raw)
    }

    for (const record of this.records.values()) {
      await this.activateRecord(record)
    }

    for (const record of this.records.values()) {
      this.syncRecordWatch(record)
    }
    this.syncDiscoveryWatch()

    this.loaded = true
  }

  private async addInstance(raw: ResolvedPluginInstance) {
    const scope = deriveScope(raw)
    const pluginRoot = raw.rootDir
    const diagnostics: PluginDiagnostic[] = []

    try {
      validateId('scope', scope)
      if (BUILTIN_SCOPE_KEYS.has(scope)) {
        throw new Error(`Plugin scope "${scope}" conflicts with a built-in route key.`)
      }
      if (this.records.has(scope)) {
        throw new Error(
          `Duplicate plugin scope "${scope}" for "${pluginRoot}" and "${this.records.get(scope)?.instance.pluginRoot}".`
        )
      }

      const enabled = this.isPluginEnabled(scope, raw)
      const watchEnabled = enabled && this.isWatchEnabled(scope, raw)
      const manifest = await loadPluginRuntimeManifest(this.workspaceFolder, { ...raw, watch: watchEnabled }) ?? {}
      const name = manifest.name ?? raw.packageId ?? raw.requestId
      const clientEntry = resolveClientEntryUrlPath(manifest)
      const devClientEntry = resolveClientEntryUrlPath(
        manifest,
        manifest.plugin?.client?.devEntry ?? manifest.plugin?.client?.entry
      )
      const hostViteDevClientEntryUrl = await resolveHostViteDevClientEntryUrl(
        pluginRoot,
        manifest,
        manifest.plugin?.client?.devEntry,
        [
          this.workspaceFolder,
          ...getHostViteDevClientAllowedRoots()
        ]
      )
      const clientAssetRoot = await resolvePluginClientAssetRoot(pluginRoot, manifest)
      const client = manifest.plugin?.client == null
        ? undefined
        : {
          ...manifest.plugin.client,
          ...(clientEntry != null ? { clientEntryUrl: `/api/plugins/${scope}/client/${clientEntry}` } : {}),
          ...(manifest.plugin.client.devServer != null && devClientEntry != null
            ? { devClientEntryUrl: `/api/plugins/${scope}/dev/${devClientEntry}` }
            : hostViteDevClientEntryUrl != null
            ? { devClientEntryUrl: hostViteDevClientEntryUrl }
            : {})
        }

      const record: RuntimeRecord = {
        raw,
        manifest,
        clientAssetRoot,
        commands: new Map(),
        apis: new Map(),
        disposables: [],
        instance: {
          scope,
          name,
          displayName: manifest.displayName,
          requestedVersion: raw.requestedVersion,
          version: manifest.version,
          requestId: raw.requestId,
          packageId: raw.packageId,
          sourceGroup: this.resolveSourceGroup(raw, pluginRoot),
          watch: {
            enabled: watchEnabled
          },
          options: raw.options,
          manifest,
          pluginRoot,
          client,
          contributions: manifest.plugin?.contributions,
          diagnostics,
          enabled
        }
      }
      this.validateContributions(record)
      this.records.set(scope, record)
    } catch (error) {
      const diagnostic = {
        level: 'error' as const,
        code: 'plugin_register_failed',
        message: toErrorMessage(error),
        scope,
        pluginRoot
      }
      diagnostics.push(diagnostic)
      this.diagnostics.push(diagnostic)
    }
  }

  private isPluginConfigMatch(plugin: PluginInstanceConfig, raw: ResolvedPluginInstance) {
    return plugin.id === raw.requestId && (plugin.scope ?? '') === (raw.scope ?? '')
  }

  private getConfigPlugins(config: { plugins?: unknown } | undefined): PluginConfig {
    return Array.isArray(config?.plugins) ? config.plugins : []
  }

  private resolveSourceGroup(raw: ResolvedPluginInstance, pluginRoot: string): PluginRuntimeInstance['sourceGroup'] {
    const normalizedRoot = pluginRoot.replaceAll('\\', '/')
    if (
      raw.watch === true ||
      isPathInside(resolveProjectOoPath(this.workspaceFolder, process.env, 'plugins.dev'), pluginRoot)
    ) {
      return 'localDev'
    }
    if (
      raw.packageId?.startsWith('@oneworks/plugin-') === true ||
      normalizedRoot.includes('/packages/plugins/') ||
      normalizedRoot.includes('/plugins/cache/openai-bundled/') ||
      normalizedRoot.includes('/plugins/cache/openai-primary-runtime/')
    ) {
      return 'builtIn'
    }
    if (isPathInside(resolveGlobalPluginsRoot(), pluginRoot)) {
      return 'global'
    }
    if (path.isAbsolute(raw.requestId) && !normalizedRoot.includes('/node_modules/')) {
      return 'localDev'
    }
    if (raw.sourceType === 'directory' && !normalizedRoot.includes('/node_modules/')) {
      return 'local'
    }
    if (normalizedRoot.includes('/node_modules/') || raw.packageId != null) {
      return 'local'
    }
    return 'global'
  }

  private async writePluginEnabledConfig(
    raw: ResolvedPluginInstance,
    enabled: boolean,
    target: 'workspace' | 'global'
  ) {
    const state = await loadConfigState()
    const source = target === 'global' ? 'global' : 'project'
    const targetConfig = target === 'global' ? state.globalSource?.rawConfig : state.projectSource?.rawConfig
    const plugins = [...this.getConfigPlugins(targetConfig)]
    const index = plugins.findIndex(plugin => this.isPluginConfigMatch(plugin, raw))

    const nextPlugin: PluginInstanceConfig = index >= 0
      ? { ...plugins[index] }
      : {
        id: raw.requestId,
        ...(raw.scope != null ? { scope: raw.scope } : {}),
        ...(raw.watch === true ? { watch: true } : {})
      }

    if (enabled) {
      delete nextPlugin.enabled
    } else {
      nextPlugin.enabled = false
    }

    if (index >= 0) {
      plugins[index] = nextPlugin
    } else {
      plugins.push(nextPlugin)
    }

    await updateConfigFile({
      workspaceFolder: state.workspaceFolder,
      source,
      section: 'plugins',
      value: { plugins }
    })
  }

  private async writePluginOptionsConfig(
    raw: ResolvedPluginInstance,
    options: Record<string, unknown>,
    target: 'workspace' | 'global'
  ) {
    const state = await loadConfigState()
    const source = target === 'global' ? 'global' : 'project'
    const targetConfig = target === 'global' ? state.globalSource?.rawConfig : state.projectSource?.rawConfig
    const plugins = [...this.getConfigPlugins(targetConfig)]
    const index = plugins.findIndex(plugin => this.isPluginConfigMatch(plugin, raw))
    if (Object.keys(options).length === 0 && index < 0) return

    const nextPlugin: PluginInstanceConfig = index >= 0
      ? { ...plugins[index] }
      : {
        id: raw.requestId,
        ...(raw.scope != null ? { scope: raw.scope } : {}),
        ...(raw.watch === true ? { watch: true } : {})
      }

    if (Object.keys(options).length === 0) {
      delete nextPlugin.options
    } else {
      nextPlugin.options = options
    }

    if (index >= 0) {
      plugins[index] = nextPlugin
    } else {
      plugins.push(nextPlugin)
    }

    await updateConfigFile({
      workspaceFolder: state.workspaceFolder,
      source,
      section: 'plugins',
      value: { plugins }
    })
  }

  private validateContributions(record: RuntimeRecord) {
    const providers = this.getLauncherProviders(record)
    const seen = new Set<string>()
    for (const provider of providers) {
      validateId('launcher provider id', provider.id, record.instance.scope)
      if (seen.has(provider.id)) {
        throw new Error(`Duplicate launcher provider "${record.instance.scope}/${provider.id}".`)
      }
      seen.add(provider.id)
      if (typeof provider.command !== 'string' || provider.command.trim() === '') {
        throw new Error(`Launcher provider "${record.instance.scope}/${provider.id}" must declare a command.`)
      }
    }
  }

  private isWatchEnabled(scope: string, raw: ResolvedPluginInstance) {
    return this.watchOverrides.get(scope) ?? raw.watch === true
  }

  private isPluginEnabled(scope: string, raw: ResolvedPluginInstance) {
    return this.enabledOverrides.get(scope) ?? raw.enabled !== false
  }

  private syncRecordWatch(record: RuntimeRecord) {
    if (!record.instance.enabled) {
      record.instance.watch = { enabled: false }
      this.stopRecordWatch(record)
      return
    }
    const enabled = this.isWatchEnabled(record.instance.scope, record.raw)
    record.instance.watch = { enabled }
    if (!enabled) {
      this.stopRecordWatch(record)
      return
    }
    if (record.watcher != null) return

    try {
      record.watcher = watch(record.instance.pluginRoot, { recursive: true }, (_eventType, filename) => {
        const relativePath = filename == null ? '' : String(filename)
        if (shouldIgnoreWatchPath(relativePath)) return
        if (shouldSkipPluginReloadForHostViteClientChange(record, relativePath)) return
        this.scheduleRecordReload(record, relativePath)
      })
    } catch (error) {
      record.instance.watch = { enabled: false }
      record.instance.diagnostics.push({
        level: 'warning',
        code: 'plugin_watch_failed',
        message: `Failed to watch plugin "${record.instance.scope}": ${toErrorMessage(error)}`,
        scope: record.instance.scope,
        pluginRoot: record.instance.pluginRoot
      })
      logger.warn({ err: error, scope: record.instance.scope }, '[plugins] failed to start watch mode')
    }
  }

  private syncDiscoveryWatch() {
    this.stopDiscoveryWatch()
    const roots = [
      resolveProjectOoPath(this.workspaceFolder, process.env, 'plugins.dev')
    ]
    for (const root of roots) {
      this.startDiscoveryWatch(root)
    }
  }

  private startDiscoveryWatch(root: string) {
    try {
      const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
        const relativePath = filename == null ? '' : String(filename)
        if (!shouldReloadForDiscoveryPath(relativePath)) return
        this.scheduleDiscoveryReload(root, relativePath)
      })
      this.discoveryWatchers.push({ root, watcher })
    } catch {
      // The local discovery root is optional; it may not exist in a workspace.
    }
  }

  private stopDiscoveryWatch() {
    if (this.discoveryWatchTimer != null) {
      clearTimeout(this.discoveryWatchTimer)
      this.discoveryWatchTimer = undefined
    }
    for (const watcher of this.discoveryWatchers) {
      watcher.watcher.close()
    }
    this.discoveryWatchers = []
  }

  private stopRecordWatch(record: RuntimeRecord) {
    if (record.watchTimer != null) {
      clearTimeout(record.watchTimer)
      record.watchTimer = undefined
    }
    record.watcher?.close()
    record.watcher = undefined
  }

  private scheduleRecordReload(record: RuntimeRecord, relativePath: string) {
    if (record.watchTimer != null) {
      clearTimeout(record.watchTimer)
    }
    const scope = record.instance.scope
    record.watchTimer = setTimeout(() => {
      record.watchTimer = undefined
      void this.reload()
        .then(() => {
          this.notifyWatchEvent({
            type: 'plugin.changed',
            scope,
            path: relativePath
          })
        })
        .catch((error) => {
          logger.warn({ err: error, scope }, '[plugins] failed to reload after watched file change')
        })
    }, PLUGIN_WATCH_DEBOUNCE_MS)
  }

  private scheduleDiscoveryReload(root: string, relativePath: string) {
    if (this.discoveryWatchTimer != null) {
      clearTimeout(this.discoveryWatchTimer)
    }
    this.discoveryWatchTimer = setTimeout(() => {
      this.discoveryWatchTimer = undefined
      void this.reload()
        .then(() => {
          this.notifyWatchEvent({
            type: 'plugin.changed',
            scope: '*',
            path: path.join(path.basename(root), relativePath)
          })
        })
        .catch((error) => {
          logger.warn({ err: error, root }, '[plugins] failed to reload after discovery root change')
        })
    }, PLUGIN_WATCH_DEBOUNCE_MS)
  }

  private notifyWatchEvent(event: PluginWatchEvent) {
    const serialized = JSON.stringify(event)
    for (const [subscriber, scope] of this.watchSubscribers.entries()) {
      if (scope != null && scope !== event.scope) continue
      try {
        subscriber.send(serialized)
      } catch (error) {
        this.watchSubscribers.delete(subscriber)
        logger.warn({ err: error, scope: event.scope }, '[plugins] failed to send watch event')
      }
    }
  }

  private getLauncherProviders(record: RuntimeRecord): PluginContributionLauncherSearchProvider[] {
    const providers = record.manifest.plugin?.contributions?.launcherSearchProviders
    return Array.isArray(providers)
      ? providers.filter((provider): provider is PluginContributionLauncherSearchProvider =>
        isRecord(provider) && typeof provider.id === 'string' && typeof provider.command === 'string'
      )
      : []
  }

  private async activateRecord(record: RuntimeRecord) {
    if (!record.instance.enabled) return

    const entryPath = await resolvePluginServerEntryPath(record.instance.pluginRoot, record.manifest)
    if (entryPath == null) return

    try {
      const mod = await loadPluginServerModule(entryPath, record.instance.pluginRoot)
      const moduleRecord = isRecord(mod) ? mod : {}
      const defaultRecord = isRecord(moduleRecord.default) ? moduleRecord.default : undefined
      const activatePlugin = typeof moduleRecord.activatePlugin === 'function'
        ? moduleRecord.activatePlugin
        : typeof defaultRecord?.activatePlugin === 'function'
        ? defaultRecord.activatePlugin
        : undefined
      if (activatePlugin == null) {
        throw new Error(`Plugin server entry "${entryPath}" must export activatePlugin(ctx).`)
      }

      const ctx = this.createServerContext(record)
      await activatePlugin(ctx)
    } catch (error) {
      record.instance.enabled = false
      const diagnostic = {
        level: 'error' as const,
        code: 'plugin_activation_failed',
        message: toErrorMessage(error),
        scope: record.instance.scope,
        pluginRoot: record.instance.pluginRoot
      }
      record.instance.diagnostics.push(diagnostic)
      this.diagnostics.push(diagnostic)
    }
  }

  private getDetailAssetPath(record: RuntimeRecord, kind: PluginDetailAssetKind) {
    const value = record.manifest.assets?.[kind]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  private async collectDetailAssetFiles(root: string, relativePath: string): Promise<PluginDetailAssetFile[]> {
    const target = await this.resolveScopedPath(root, relativePath)
    if (target == null) return []
    if (target.isFile) {
      const file = await this.readDetailAssetFile(root, relativePath)
      return file == null ? [] : [file]
    }
    if (!target.isDirectory) return []

    const files: PluginDetailAssetFile[] = []
    const realRoot = await realpath(root).catch(() => root)
    await this.collectDetailAssetFilesFromDirectory(root, realRoot, target.filePath, files)
    return files
  }

  private async collectDetailAssetFilesFromDirectory(
    root: string,
    realRoot: string,
    directoryPath: string,
    files: PluginDetailAssetFile[]
  ) {
    if (files.length >= MAX_PLUGIN_DETAIL_ASSET_FILES) return
    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= MAX_PLUGIN_DETAIL_ASSET_FILES) return
      if (IGNORED_WATCH_PATH_PARTS.has(entry.name)) continue
      const entryPath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        await this.collectDetailAssetFilesFromDirectory(root, realRoot, entryPath, files)
        continue
      }
      if (!entry.isFile()) continue
      const relativePath = toPosixPath(path.relative(realRoot, entryPath))
      const file = await this.readDetailAssetFile(root, relativePath)
      if (file != null) files.push(file)
    }
  }

  private async readDetailAssetFile(root: string, relativePath: string): Promise<PluginDetailAssetFile | undefined> {
    const file = await this.resolveScopedFile(root, relativePath)
    if (file == null) return undefined

    const contentKind = getDetailAssetContentKind(relativePath)
    const shouldReadContent = contentKind !== 'binary' && file.size <= MAX_PLUGIN_DETAIL_ASSET_BYTES
    return {
      path: toPosixPath(relativePath),
      size: file.size,
      contentKind,
      ...(shouldReadContent ? { content: await readFile(file.filePath, 'utf8') } : {}),
      ...(!shouldReadContent && contentKind !== 'binary' ? { truncated: true } : {})
    }
  }

  private async resolveScopedPath(root: string, relativePath: string) {
    if (relativePath.includes('\0') || path.isAbsolute(relativePath)) return undefined

    const resolvedPath = path.resolve(root, relativePath)
    const [realRoot, realFile] = await Promise.all([
      realpath(root).catch(() => undefined),
      realpath(resolvedPath).catch(() => undefined)
    ])
    if (realRoot == null || realFile == null || isPathOutside(path.relative(realRoot, realFile))) {
      return undefined
    }

    const fileStat = await stat(realFile).catch(() => undefined)
    if (fileStat == null) return undefined
    return {
      filePath: realFile,
      isDirectory: fileStat.isDirectory(),
      isFile: fileStat.isFile(),
      size: fileStat.size
    }
  }

  private async resolveScopedFile(root: string, relativePath: string) {
    const file = await this.resolveScopedPath(root, relativePath)
    if (file == null || !file.isFile) return undefined
    return {
      filePath: file.filePath,
      size: file.size
    }
  }

  private createServerContext(record: RuntimeRecord): PluginServerContext {
    const scope = record.instance.scope
    return {
      scope,
      pluginRoot: record.instance.pluginRoot,
      workspaceFolder: this.workspaceFolder,
      projectHome: this.projectHome,
      options: record.instance.options ?? {},
      sessions: createPluginSessionAdapter(),
      logger,
      registerCommand: (commandId, handler) => {
        validateId('command id', commandId, scope)
        if (record.commands.has(commandId)) {
          throw new Error(`Duplicate plugin command "${scope}/${commandId}".`)
        }
        record.commands.set(commandId, handler)
      },
      registerApi: (apiId, options) => {
        validateId('api id', apiId, scope)
        if (record.apis.has(apiId)) {
          throw new Error(`Duplicate plugin API "${scope}/${apiId}".`)
        }
        validateApiSchemaField(apiId, 'inputSchema', options.inputSchema, scope)
        validateApiSchemaField(apiId, 'outputSchema', options.outputSchema, scope)
        validateApiSchemaField(apiId, 'headerSchema', options.headerSchema, scope)
        if (options.proxy?.target != null && !isLoopbackProxyTarget(options.proxy.target)) {
          throw new Error(`Plugin API "${scope}/${apiId}" proxy target must be loopback HTTP(S).`)
        }
        if (options.handler == null && options.proxy == null) {
          throw new Error(`Plugin API "${scope}/${apiId}" must register a handler or proxy target.`)
        }
        const api = { apiId, ...options }
        const missingFields = getMissingApiDocumentationFields(api)
        if (missingFields.length > 0) {
          record.instance.diagnostics.push({
            level: 'warning',
            code: 'plugin_api_metadata_missing',
            message: `Plugin API "${scope}/${apiId}" should declare ${
              missingFields.join(', ')
            } in registerApi options.`,
            scope,
            pluginRoot: record.instance.pluginRoot,
            details: {
              apiId,
              missingFields
            }
          })
        }
        record.apis.set(apiId, api)
      },
      registerLocalService: (serviceId, start) => {
        validateId('local service id', serviceId, scope)
        const result = start()
        if (isRecord(result) && typeof result.dispose === 'function') {
          const dispose = result.dispose
          record.disposables.push(() => dispose())
        }
      },
      dispose: (callback) => {
        record.disposables.push(callback)
      }
    }
  }

  private withLauncherResultId(scope: string, providerId: string, value: unknown) {
    if (!isRecord(value)) {
      return {
        id: `${scope}/${providerId}/${encodeURIComponent(String(value))}`,
        title: String(value)
      }
    }
    const rawId = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : randomUUID()
    return {
      ...value,
      id: `${scope}/${providerId}/${encodeURIComponent(rawId)}`
    }
  }
}

let pluginManager: PluginManager | undefined

export const getPluginManager = () => {
  pluginManager ??= new PluginManager()
  return pluginManager
}

export const resetPluginManagerForTests = async () => {
  if (pluginManager != null) {
    await pluginManager.dispose()
  }
  pluginManager = undefined
}

export const readProxyHandlerBody = async (body: unknown) => {
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  if (body == null) return Buffer.alloc(0)
  return Buffer.from(JSON.stringify(body))
}

export const readJsonFileForTests = async (filePath: string) => JSON.parse(await readFile(filePath, 'utf8')) as unknown
