import { access, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'

import {
  DEFAULT_ONEWORKS_MCP_SERVER_NAME,
  buildConfigJsonVariables,
  loadConfig,
  resolveDefaultOneworksMcpServerConfig
} from '@oneworks/config'
import type { Config, Definition, Entity, PluginConfig, WorkspaceAsset, WorkspaceAssetKind } from '@oneworks/types'
import {
  mergeMarketplaceConfigs,
  mergeProcessEnvWithProjectEnv,
  readProjectSkillsLockfile,
  resolveProjectHomePath,
  resolveProjectOoBaseDir,
  resolveProjectOoEntitiesDir,
  resolveRelativePath,
  resolveSkillsHomeBridge
} from '@oneworks/utils'
import { readManagedPluginInstall } from '@oneworks/utils/managed-plugin'
import {
  flattenPluginInstances,
  mergePluginConfigs,
  resolveConfiguredPluginInstances,
  resolvePluginHooksEntryPathForInstance,
  resolveRuntimePluginConfig
} from '@oneworks/utils/plugin-resolver'
import type { ResolvedPluginInstance } from '@oneworks/utils/plugin-resolver'
import fg from 'fast-glob'
import fm from 'front-matter'
import yaml from 'js-yaml'

import {
  resolveDocumentName,
  resolveEntityIdentifier,
  resolveSkillIdentifier,
  resolveSpecIdentifier
} from '@oneworks/definition-core'
import { warnMissingConfiguredProjectSkills } from './configured-skills'
import { HOME_BRIDGE_RESOLVED_BY } from './home-bridge'
import { PLUGIN_SKILL_DEPENDENCY_RESOLVED_BY } from './plugin-skill-dependencies'
import { resolveConfiguredWorkspaceAssets } from './workspaces'

type DocumentAssetKind = Extract<WorkspaceAssetKind, 'rule' | 'spec' | 'entity' | 'skill'>
type OpenCodeOverlayKind = Extract<WorkspaceAssetKind, 'agent' | 'command' | 'mode' | 'nativePlugin'>
type OpenCodeOverlayAsset<TKind extends OpenCodeOverlayKind> = Extract<WorkspaceAsset, { kind: TKind }>
type ProjectEnv = Record<string, string | null | undefined>
type SkillAsset = Extract<WorkspaceAsset, { kind: 'skill' }>

const resolveBundleEnv = (env: ProjectEnv | undefined): NodeJS.ProcessEnv => {
  return mergeProcessEnvWithProjectEnv(env)
}

type DocumentAsset<TDefinition> = Extract<WorkspaceAsset, { kind: DocumentAssetKind }> & {
  payload: {
    definition: TDefinition & { path: string }
  }
}

interface OpenCodeOverlayAssetEntry {
  kind: OpenCodeOverlayKind
  sourcePath: string
  entryName: string
  targetSubpath: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

interface ManagedClaudePluginTemplateContext {
  nativePluginRoot: string
  pluginDataDir: string
}

const CLAUDE_PLUGIN_TEMPLATE_PATTERN = /\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|CLAUDE_PLUGIN_DIR)\}/g
const ONEWORKS_PLUGIN_TEMPLATE_PATTERN = /\$\{(ONEWORKS_PLUGIN_ROOT|ONEWORKS_REAL_HOME|ONEWORKS_NODE_EXECUTABLE)\}/g
const ONEWORKS_PLUGIN_OPTION_TEMPLATE_PATTERN = /\$\{ONEWORKS_PLUGIN_OPTION:([\w.-]+)\}/g

interface OneWorksPluginTemplateContext {
  pluginRoot: string
  realHome?: string
  nodeExecutable?: string
  options?: Record<string, unknown>
}

const resolveOneWorksPluginOption = (
  options: Record<string, unknown> | undefined,
  optionPath: string
) => {
  const segments = optionPath.split('.')
  if (segments.some(segment => ['__proto__', 'constructor', 'prototype'].includes(segment))) return ''

  let current: unknown = options
  for (const segment of segments) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return ''
    current = current[segment]
  }
  if (current == null) return ''
  if (typeof current === 'string') return current
  if (typeof current === 'boolean' || typeof current === 'number') return String(current)
  return JSON.stringify(current)
}

const transformOneWorksPluginTemplateValue = <T>(
  value: T,
  context: OneWorksPluginTemplateContext
): T => {
  if (typeof value === 'string') {
    return value
      .replace(ONEWORKS_PLUGIN_TEMPLATE_PATTERN, (match, key: string) => {
        if (key === 'ONEWORKS_PLUGIN_ROOT') return context.pluginRoot
        if (key === 'ONEWORKS_REAL_HOME') return context.realHome ?? match
        return context.nodeExecutable ?? match
      })
      .replace(ONEWORKS_PLUGIN_OPTION_TEMPLATE_PATTERN, (_match, optionPath: string) => (
        resolveOneWorksPluginOption(context.options, optionPath)
      )) as T
  }
  if (Array.isArray(value)) {
    return value.map(entry => transformOneWorksPluginTemplateValue(entry, context)) as T
  }
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      transformOneWorksPluginTemplateValue(entryValue, context)
    ])
  ) as T
}

const transformManagedClaudePluginTemplateString = (
  value: string,
  context: ManagedClaudePluginTemplateContext
) => (
  value.replace(CLAUDE_PLUGIN_TEMPLATE_PATTERN, (_match, key: string) => (
    key === 'CLAUDE_PLUGIN_DATA' ? context.pluginDataDir : context.nativePluginRoot
  ))
)

const transformManagedClaudePluginTemplateValue = <T>(
  value: T,
  context: ManagedClaudePluginTemplateContext | undefined
): T => {
  if (context == null) return value
  if (typeof value === 'string') return transformManagedClaudePluginTemplateString(value, context) as T
  if (Array.isArray(value)) {
    return value.map(entry => transformManagedClaudePluginTemplateValue(entry, context)) as T
  }
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      transformManagedClaudePluginTemplateValue(entryValue, context)
    ])
  ) as T
}

const transformManagedClaudePluginDefinition = <TDefinition extends Definition<object>>(
  definition: TDefinition,
  context: ManagedClaudePluginTemplateContext | undefined
): TDefinition => {
  if (context == null) return definition
  return {
    ...definition,
    body: transformManagedClaudePluginTemplateString(definition.body, context),
    attributes: transformManagedClaudePluginTemplateValue(definition.attributes, context)
  }
}

const resolveManagedPluginSlugFromInstallDir = (installDir: string) => {
  const installDirName = basename(installDir)
  return installDirName === 'install' ? basename(dirname(installDir)) : installDirName
}

const resolveManagedClaudePluginTemplateContext = async (
  cwd: string,
  instance: ResolvedPluginInstance,
  env: NodeJS.ProcessEnv
): Promise<ManagedClaudePluginTemplateContext | undefined> => {
  if (instance.sourceType !== 'directory') return undefined

  const install = await readManagedPluginInstall(dirname(instance.rootDir))
  if (install?.config.adapter !== 'claude') return undefined
  if (resolve(install.oneworksPluginDir) !== resolve(instance.rootDir)) return undefined

  const pluginDataDir = resolveProjectHomePath(
    cwd,
    env,
    '.local',
    'plugins',
    install.config.adapter,
    resolveManagedPluginSlugFromInstallDir(install.installDir),
    'data'
  )
  await mkdir(pluginDataDir, { recursive: true })

  return {
    nativePluginRoot: install.nativePluginDir,
    pluginDataDir
  }
}

const ENTITY_DIRECTORY_ENTRY_FILES = new Set(['readme.md', 'index.json'])
const DEFAULT_HOME_SKILL_ROOTS = [
  '~/.agents/skills',
  '~/.claude/skills',
  '~/.config/opencode/skills',
  '~/.gemini/skills'
] as const

const DEFAULT_ENTITY_PROMPT_FILE_SECTIONS = [
  {
    heading: 'Introduction',
    fileNames: ['INTRODUCTION.md', 'introduction.md', '介绍.md']
  },
  {
    heading: 'Personality',
    fileNames: ['PERSONALITY.md', 'personality.md', '人格.md']
  },
  {
    heading: 'Memory',
    fileNames: ['MEMORY.md', 'memory.md', '记忆.md']
  }
] as const

const isMissingFileError = (error: unknown) => (
  error != null &&
  typeof error === 'object' &&
  'code' in error &&
  (error as { code?: unknown }).code === 'ENOENT'
)

const readOptionalMarkdownBody = async (path: string) => {
  try {
    const content = await readFile(path, 'utf-8')
    return fm<Record<string, never>>(content).body.trim()
  } catch (err) {
    if (isMissingFileError(err)) return undefined
    throw err
  }
}

const loadDefaultEntityPromptSection = async (
  entityDir: string,
  section: (typeof DEFAULT_ENTITY_PROMPT_FILE_SECTIONS)[number]
) => {
  for (const fileName of section.fileNames) {
    const body = await readOptionalMarkdownBody(resolve(entityDir, fileName))
    if (body == null || body === '') continue

    return `## ${section.heading}\n\n${body}`
  }

  return undefined
}

const appendDefaultEntityPromptFiles = async (path: string, body: string) => {
  if (!ENTITY_DIRECTORY_ENTRY_FILES.has(basename(path).toLowerCase())) return body

  const sections = await Promise.all(
    DEFAULT_ENTITY_PROMPT_FILE_SECTIONS.map(section => loadDefaultEntityPromptSection(dirname(path), section))
  )

  return [
    body.trim(),
    ...sections
  ]
    .filter((section): section is string => section != null && section !== '')
    .join('\n\n')
}

const resolveDisplayName = (name: string, scope?: string) => (
  scope != null && scope.trim() !== '' ? `${scope}/${name}` : name
)

const toStringList = (value: string | string[] | undefined) => {
  if (typeof value === 'string' && value.trim() !== '') {
    return [value.trim()]
  }

  if (!Array.isArray(value)) return [] as string[]

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map(item => item.trim())
}

const resolveRealHomeDir = (env: NodeJS.ProcessEnv) => {
  const value = env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() || env.HOME?.trim()
  if (value == null || value === '') return undefined
  return resolve(value)
}

const warnInvalidHomeSkillRoot = (root: string) => {
  console.warn(
    `[oneworks] Ignoring invalid skillsMeta.homeBridge root "${root}". ` +
      'Use an absolute path or a path starting with "~".'
  )
}

const formatErrorMessage = (error: unknown) => (
  (error instanceof Error ? error.message : String(error))
    .split(/\r?\n/u)[0]
    ?.trim() ?? 'Unknown error'
)

const warnInvalidWorkspaceAsset = (kind: WorkspaceAssetKind, path: string, error: unknown) => {
  console.warn(
    `[oneworks] Ignoring invalid ${kind} asset "${path}". ` +
      `${formatErrorMessage(error)}. ` +
      'Check the asset frontmatter or structured config syntax; quote plain strings containing ": ".'
  )
}

const resolveHomeBridgeConfig = (configs: [Config?, Config?]) => {
  const [config, userConfig] = configs
  const projectHomeBridge = resolveSkillsHomeBridge(config)
  const userHomeBridge = resolveSkillsHomeBridge(userConfig)

  return {
    enabled: userHomeBridge?.enabled ?? projectHomeBridge?.enabled ?? true,
    roots: toStringList(userHomeBridge?.roots ?? projectHomeBridge?.roots)
  }
}

const resolveHomeSkillRoots = (configs: [Config?, Config?], env: NodeJS.ProcessEnv = process.env) => {
  const homeBridge = resolveHomeBridgeConfig(configs)
  if (homeBridge.enabled === false) return [] as string[]

  const realHome = resolveRealHomeDir(env)
  if (realHome == null) return [] as string[]

  const rawRoots = homeBridge.roots.length > 0 ? homeBridge.roots : Array.from(DEFAULT_HOME_SKILL_ROOTS)
  const roots: string[] = []
  const seen = new Set<string>()

  for (const rawRoot of rawRoots) {
    let resolvedRoot: string | undefined

    if (rawRoot === '~') {
      resolvedRoot = realHome
    } else if (rawRoot.startsWith('~/')) {
      resolvedRoot = resolve(realHome, rawRoot.slice(2))
    } else if (isAbsolute(rawRoot)) {
      resolvedRoot = resolve(rawRoot)
    } else if (homeBridge.roots.length > 0) {
      warnInvalidHomeSkillRoot(rawRoot)
    }

    if (resolvedRoot == null || seen.has(resolvedRoot)) continue
    seen.add(resolvedRoot)
    roots.push(resolvedRoot)
  }

  return roots
}

const loadWorkspaceConfig = async (cwd: string, env: NodeJS.ProcessEnv) => (
  loadConfig({
    cwd,
    env,
    jsonVariables: buildConfigJsonVariables(cwd, env)
  })
)

const parseFrontmatterDocument = async <TDefinition extends object>(
  path: string
): Promise<Definition<TDefinition>> => {
  const content = await readFile(path, 'utf-8')
  const { body, attributes } = fm<TDefinition>(content)
  return {
    path,
    body,
    attributes
  }
}

const parseOptionalDocument = async <TDefinition extends object>(
  kind: DocumentAssetKind,
  path: string,
  parser: (path: string) => Promise<Definition<TDefinition>>
) => {
  try {
    return await parser(path)
  } catch (error) {
    warnInvalidWorkspaceAsset(kind, path, error)
    return undefined
  }
}

const parseEntityMarkdownDocument = async (path: string): Promise<Definition<Entity>> => {
  const definition = await parseFrontmatterDocument<Entity>(path)

  return {
    ...definition,
    body: await appendDefaultEntityPromptFiles(path, definition.body)
  }
}

const parseEntityIndexJson = async (path: string): Promise<Definition<Entity>> => {
  const raw = JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>
  const promptPath = typeof raw.promptPath === 'string'
    ? (raw.promptPath.startsWith('/') ? raw.promptPath : resolve(dirname(path), raw.promptPath))
    : undefined
  const prompt = typeof raw.prompt === 'string'
    ? raw.prompt
    : promptPath != null
    ? await readFile(promptPath, 'utf-8')
    : ''

  return {
    path,
    body: await appendDefaultEntityPromptFiles(path, prompt),
    attributes: raw as Entity
  }
}

const parseStructuredMcpFile = async (path: string) => {
  const raw = await readFile(path, 'utf8')
  const extension = extname(path).toLowerCase()
  return extension === '.yaml' || extension === '.yml'
    ? yaml.load(raw)
    : JSON.parse(raw)
}

const parseOptionalStructuredMcpFile = async (path: string) => {
  try {
    return await parseStructuredMcpFile(path)
  } catch (error) {
    warnInvalidWorkspaceAsset('mcpServer', path, error)
    return undefined
  }
}

const createDocumentAsset = <
  TKind extends DocumentAssetKind,
  TDefinition extends { path: string; attributes: { name?: string } },
>(params: {
  cwd: string
  kind: TKind
  definition: TDefinition
  origin: 'workspace' | 'plugin'
  scope?: string
  instance?: ResolvedPluginInstance
  resolvedBy?: string
}) => {
  const name = ({
    rule: resolveDocumentName,
    spec: resolveSpecIdentifier,
    entity: resolveEntityIdentifier,
    skill: resolveSkillIdentifier
  }[params.kind])(params.definition.path, params.definition.attributes.name)
  const displayName = resolveDisplayName(name, params.scope)

  return {
    id: `${params.kind}:${params.origin}:${params.instance?.instancePath ?? 'workspace'}:${displayName}:${
      resolveRelativePath(params.cwd, params.definition.path)
    }`,
    kind: params.kind,
    name,
    displayName,
    scope: params.scope,
    origin: params.origin,
    sourcePath: params.definition.path,
    instancePath: params.instance?.instancePath,
    packageId: params.instance?.packageId,
    resolvedBy: params.resolvedBy ?? params.instance?.resolvedBy,
    taskOverlaySource: params.instance?.overlaySource,
    payload: {
      definition: params.definition
    }
  } as Extract<WorkspaceAsset, { kind: TKind }>
}

const createMcpAsset = (params: {
  cwd: string
  name: string
  config: NonNullable<Config['mcpServers']>[string]
  origin: 'workspace' | 'plugin'
  scope?: string
  sourcePath: string
  instance?: ResolvedPluginInstance
}) => {
  const displayName = resolveDisplayName(params.name, params.scope)
  return {
    id: `mcpServer:${params.origin}:${params.instance?.instancePath ?? 'workspace'}:${displayName}:${
      resolveRelativePath(params.cwd, params.sourcePath)
    }`,
    kind: 'mcpServer',
    name: params.name,
    displayName,
    scope: params.scope,
    origin: params.origin,
    sourcePath: params.sourcePath,
    instancePath: params.instance?.instancePath,
    packageId: params.instance?.packageId,
    resolvedBy: params.instance?.resolvedBy,
    taskOverlaySource: params.instance?.overlaySource,
    payload: {
      name: displayName,
      config: params.config
    }
  } satisfies Extract<WorkspaceAsset, { kind: 'mcpServer' }>
}

const createHookPluginAsset = (
  instance: ResolvedPluginInstance
) => ({
  id: `hookPlugin:${instance.instancePath}:${instance.packageId ?? instance.requestId}`,
  kind: 'hookPlugin',
  name: instance.requestId,
  displayName: resolveDisplayName(instance.requestId, instance.scope),
  scope: instance.scope,
  origin: 'plugin' as const,
  sourcePath: instance.rootDir,
  instancePath: instance.instancePath,
  packageId: instance.packageId,
  resolvedBy: instance.resolvedBy,
  taskOverlaySource: instance.overlaySource,
  payload: {
    packageName: instance.packageId,
    config: instance.options
  }
} satisfies Extract<WorkspaceAsset, { kind: 'hookPlugin' }>)

const createOpenCodeOverlayAsset = <TKind extends OpenCodeOverlayKind>(params: {
  cwd: string
  kind: TKind
  sourcePath: string
  entryName: string
  targetSubpath: string
  instance: ResolvedPluginInstance
}): OpenCodeOverlayAsset<TKind> => ({
  id: `${params.kind}:plugin:${params.instance.instancePath}:${
    resolveDisplayName(params.entryName, params.instance.scope)
  }:${resolveRelativePath(params.cwd, params.sourcePath)}`,
  kind: params.kind,
  name: params.entryName,
  displayName: resolveDisplayName(params.entryName, params.instance.scope),
  scope: params.instance.scope,
  origin: 'plugin' as const,
  sourcePath: params.sourcePath,
  instancePath: params.instance.instancePath,
  packageId: params.instance.packageId,
  resolvedBy: params.instance.resolvedBy,
  taskOverlaySource: params.instance.overlaySource,
  payload: {
    entryName: params.entryName,
    targetSubpath: params.targetSubpath
  }
} as OpenCodeOverlayAsset<TKind>)

const scanWorkspaceDocuments = async (cwd: string, env: NodeJS.ProcessEnv) => {
  const aiBaseDir = resolveProjectOoBaseDir(cwd, env)
  const entitiesDir = resolveProjectOoEntitiesDir(cwd, env)
  const [
    rulePaths,
    directSkillPaths,
    lockedSkillPaths,
    specPaths,
    entityDocPaths,
    entityJsonPaths,
    mcpPaths
  ] = await Promise.all([
    fg(['rules/*.md'], { cwd: aiBaseDir, absolute: true }),
    fg(['skills/*/SKILL.md'], { cwd: aiBaseDir, absolute: true }),
    scanProjectSkillLockfileDocuments(cwd),
    fg(['specs/*.md', 'specs/*/index.md'], { cwd: aiBaseDir, absolute: true }),
    fg(['*.md', '*/README.md'], { cwd: entitiesDir, absolute: true }),
    fg(['*/index.json'], { cwd: entitiesDir, absolute: true }),
    fg(['mcp/*.json', 'mcp/*.yaml', 'mcp/*.yml'], { cwd: aiBaseDir, absolute: true })
  ])

  return {
    rulePaths,
    skillPaths: Array.from(new Set([...directSkillPaths, ...lockedSkillPaths])),
    specPaths,
    entityDocPaths,
    entityJsonPaths,
    mcpPaths
  }
}

const scanHomeSkillDocuments = async (configs: [Config?, Config?], env: NodeJS.ProcessEnv) => {
  const roots = resolveHomeSkillRoots(configs, env)
  if (roots.length === 0) return [] as string[]

  const scans = await Promise.all(
    roots.map(async root => (
      await fg(['*/SKILL.md'], { cwd: root, absolute: true }).catch(() => [] as string[])
    ))
  )

  return scans.flatMap(paths => [...paths].sort((left, right) => left.localeCompare(right)))
}

const scanInstanceDocuments = async (instance: ResolvedPluginInstance) => {
  const assets = instance.manifest?.assets
  const resolveAssetRoot = (dir: string | undefined, fallback: string) => resolve(instance.rootDir, dir ?? fallback)

  const [rulePaths, skillPaths, specPaths, entityDocPaths, entityJsonPaths, mcpPaths] = await Promise.all([
    fg(['*.md'], { cwd: resolveAssetRoot(assets?.rules, 'rules'), absolute: true }).catch(() => [] as string[]),
    fg(['*/SKILL.md'], { cwd: resolveAssetRoot(assets?.skills, 'skills'), absolute: true }).catch(() => [] as string[]),
    fg(['*.md', '*/index.md'], { cwd: resolveAssetRoot(assets?.specs, 'specs'), absolute: true }).catch(() =>
      [] as string[]
    ),
    fg(['*.md', '*/README.md'], { cwd: resolveAssetRoot(assets?.entities, 'entities'), absolute: true }).catch(() =>
      [] as string[]
    ),
    fg(['*/index.json'], { cwd: resolveAssetRoot(assets?.entities, 'entities'), absolute: true }).catch(() =>
      [] as string[]
    ),
    fg(['*.json', '*.yaml', '*.yml'], { cwd: resolveAssetRoot(assets?.mcp, 'mcp'), absolute: true }).catch(() =>
      [] as string[]
    )
  ])

  return {
    rulePaths,
    skillPaths,
    specPaths,
    entityDocPaths,
    entityJsonPaths,
    mcpPaths
  }
}

const pathExists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const scanProjectSkillLockfileDocuments = async (cwd: string) => {
  const lockfile = await readProjectSkillsLockfile(cwd)
  const skillPaths: string[] = []
  for (const entry of Object.values(lockfile.skills ?? {})) {
    const skillPath = resolve(cwd, entry.installPath, 'SKILL.md')
    if (await pathExists(skillPath)) {
      skillPaths.push(skillPath)
    }
  }

  return skillPaths
}

const scanPluginDependencySkillDocuments = async (
  cwd: string,
  instances: ResolvedPluginInstance[]
) => {
  const lockfile = await readProjectSkillsLockfile(cwd)
  const documents: Array<{ instance: ResolvedPluginInstance; path: string }> = []
  for (const entry of Object.values(lockfile.pluginSkills ?? {})) {
    const instance = instances.find(candidate => (
      candidate.instancePath === entry.pluginInstancePath ||
      candidate.scope === entry.pluginInstance
    ))
    if (instance == null) continue

    const skillPath = resolve(cwd, entry.installPath, 'SKILL.md')
    if (await pathExists(skillPath)) {
      documents.push({
        instance,
        path: skillPath
      })
    }
  }

  return documents
}

const toOpenCodeOverlayEntries = (
  kind: OpenCodeOverlayKind,
  targetDir: 'agents' | 'commands' | 'modes' | 'plugins',
  paths: string[]
): OpenCodeOverlayAssetEntry[] =>
  paths.map((sourcePath) => ({
    kind,
    sourcePath,
    entryName: basename(sourcePath, extname(sourcePath)),
    targetSubpath: `${targetDir}/${basename(sourcePath)}`
  }))

const scanInstanceOpenCodeOverlays = async (
  instance: ResolvedPluginInstance
) => {
  const opencodeRoot = resolve(instance.rootDir, 'opencode')
  const [agentPaths, commandPaths, modePaths, nativePluginPaths] = await Promise.all([
    fg(['*.md'], { cwd: resolve(opencodeRoot, 'agents'), absolute: true, onlyFiles: true }).catch(() => [] as string[]),
    fg(['*.md'], { cwd: resolve(opencodeRoot, 'commands'), absolute: true, onlyFiles: true }).catch(() =>
      [] as string[]
    ),
    fg(['*.md'], { cwd: resolve(opencodeRoot, 'modes'), absolute: true, onlyFiles: true }).catch(() => [] as string[]),
    fg(['**/*'], { cwd: resolve(opencodeRoot, 'plugins'), absolute: true, onlyFiles: true }).catch(() => [] as string[])
  ])

  return [
    ...toOpenCodeOverlayEntries('agent', 'agents', agentPaths),
    ...toOpenCodeOverlayEntries('command', 'commands', commandPaths),
    ...toOpenCodeOverlayEntries('mode', 'modes', modePaths),
    ...toOpenCodeOverlayEntries('nativePlugin', 'plugins', nativePluginPaths)
  ]
}

const assertNoDocumentConflicts = (
  assets: Array<Extract<WorkspaceAsset, { kind: 'rule' | 'spec' | 'entity' | 'skill' }>>
) => {
  const seen = new Map<string, WorkspaceAsset>()
  for (const asset of assets) {
    const key = `${asset.kind}:${asset.displayName}`
    const existing = seen.get(key)
    if (existing != null) {
      throw new Error(
        `Duplicate ${asset.kind} asset ${asset.displayName} from ${existing.sourcePath} and ${asset.sourcePath}`
      )
    }
    seen.set(key, asset)
  }
}

const mergeSkillAssets = (assets: SkillAsset[]) => {
  const directAssets = assets.filter(asset => asset.resolvedBy !== HOME_BRIDGE_RESOLVED_BY)
  const bridgedAssets = assets.filter(asset => asset.resolvedBy === HOME_BRIDGE_RESOLVED_BY)

  assertNoDocumentConflicts(directAssets)

  const seen = new Set(directAssets.map(asset => asset.displayName))
  const merged = [...directAssets]

  for (const asset of bridgedAssets) {
    if (seen.has(asset.displayName)) continue
    seen.add(asset.displayName)
    merged.push(asset)
  }

  return merged
}

const assertNoMcpConflicts = (
  assets: Array<Extract<WorkspaceAsset, { kind: 'mcpServer' }>>
) => {
  const seen = new Map<string, WorkspaceAsset>()
  for (const asset of assets) {
    const existing = seen.get(asset.displayName)
    if (existing != null) {
      throw new Error(`Duplicate MCP server ${asset.displayName} from ${existing.sourcePath} and ${asset.sourcePath}`)
    }
    seen.set(asset.displayName, asset)
  }
}

export async function collectWorkspaceAssets(params: {
  cwd: string
  configs?: [Config?, Config?]
  env?: ProjectEnv
  plugins?: PluginConfig
  overlaySource?: string
  syncConfiguredSkills?: boolean
  updateConfiguredSkills?: boolean
  useDefaultOneworksMcpServer?: boolean
  warnMissingConfiguredSkills?: boolean
}): Promise<{
  assets: WorkspaceAsset[]
  configs: [Config?, Config?]
  defaultExcludeMcpServers: string[]
  defaultIncludeMcpServers: string[]
  entities: Array<Extract<WorkspaceAsset, { kind: 'entity' }>>
  hookPlugins: Extract<WorkspaceAsset, { kind: 'hookPlugin' }>[]
  mcpServers: Record<string, Extract<WorkspaceAsset, { kind: 'mcpServer' }>>
  opencodeOverlayAssets: Array<Extract<WorkspaceAsset, { kind: OpenCodeOverlayKind }>>
  pluginConfigs: PluginConfig | undefined
  pluginInstances: Awaited<ReturnType<typeof resolveConfiguredPluginInstances>>
  rules: Array<Extract<WorkspaceAsset, { kind: 'rule' }>>
  skills: Array<Extract<WorkspaceAsset, { kind: 'skill' }>>
  specs: Array<Extract<WorkspaceAsset, { kind: 'spec' }>>
  workspaces: Array<Extract<WorkspaceAsset, { kind: 'workspace' }>>
}> {
  const env = resolveBundleEnv(params.env)
  const [config, userConfig] = params.configs ?? await loadWorkspaceConfig(params.cwd, env)
  if (params.syncConfiguredSkills === true || params.updateConfiguredSkills === true) {
    console.warn(
      '[oneworks] Runtime skill install/update is disabled. ' +
        'Run `oneworks skills install` or `oneworks skills update` before starting the session.'
    )
  }
  if (params.warnMissingConfiguredSkills === true) {
    await warnMissingConfiguredProjectSkills({
      configs: [config, userConfig],
      workspaceFolder: params.cwd
    })
  }
  const pluginConfigs = await resolveRuntimePluginConfig({
    cwd: params.cwd,
    marketplaces: mergeMarketplaceConfigs(config?.marketplaces, userConfig?.marketplaces),
    plugins: params.plugins ?? mergePluginConfigs(config?.plugins, userConfig?.plugins),
    env
  })
  const pluginInstances = await resolveConfiguredPluginInstances({
    cwd: params.cwd,
    plugins: pluginConfigs,
    overlaySource: params.overlaySource
  })

  const [localScan, homeSkillPaths] = await Promise.all([
    scanWorkspaceDocuments(params.cwd, env),
    scanHomeSkillDocuments([config, userConfig], env)
  ])
  const flattenedPluginInstances = flattenPluginInstances(pluginInstances)
  const pluginScans = await Promise.all(flattenedPluginInstances.map(instance => scanInstanceDocuments(instance)))
  const pluginDependencySkillDocs = await scanPluginDependencySkillDocuments(params.cwd, flattenedPluginInstances)
  const pluginOverlayScans = await Promise.all(
    flattenedPluginInstances.map(instance => scanInstanceOpenCodeOverlays(instance))
  )

  const assets: WorkspaceAsset[] = []
  const skillAssets: SkillAsset[] = []
  const managedClaudePluginTemplateContexts = new Map<
    string,
    Promise<ManagedClaudePluginTemplateContext | undefined>
  >()
  const getManagedClaudePluginTemplateContext = (instance: ResolvedPluginInstance) => {
    const existing = managedClaudePluginTemplateContexts.get(instance.rootDir)
    if (existing != null) return existing

    const pending = resolveManagedClaudePluginTemplateContext(params.cwd, instance, env)
    managedClaudePluginTemplateContexts.set(instance.rootDir, pending)
    return pending
  }

  const pushDocumentAssets = async <TKind extends DocumentAssetKind>(
    kind: TKind,
    paths: string[],
    origin: 'workspace' | 'plugin',
    instance?: ResolvedPluginInstance,
    parser?: (path: string) => Promise<any>,
    resolvedBy?: string
  ) => {
    const [definitions, templateContext] = await Promise.all([
      Promise.all(paths.map(path => (
        parseOptionalDocument(kind, path, parser != null ? parser : parseFrontmatterDocument)
      ))),
      origin === 'plugin' && instance != null
        ? getManagedClaudePluginTemplateContext(instance)
        : undefined
    ])
    const createdAssets = definitions.flatMap((definition) => {
      if (definition == null) return []

      const pluginDefinition = origin === 'plugin' && instance != null
        ? transformOneWorksPluginTemplateValue(definition, {
          pluginRoot: instance.rootDir,
          options: instance.options
        })
        : definition
      const resolvedDefinition = transformManagedClaudePluginDefinition(pluginDefinition, templateContext)
      return [createDocumentAsset({
        cwd: params.cwd,
        kind,
        definition: resolvedDefinition,
        origin,
        scope: instance?.scope,
        instance,
        resolvedBy
      })]
    })

    if (kind === 'skill') {
      skillAssets.push(...createdAssets as SkillAsset[])
      return
    }

    assets.push(...createdAssets)
  }

  await pushDocumentAssets('rule', localScan.rulePaths, 'workspace')
  await pushDocumentAssets('skill', localScan.skillPaths, 'workspace')
  await pushDocumentAssets('spec', localScan.specPaths, 'workspace')
  await pushDocumentAssets('entity', localScan.entityDocPaths, 'workspace', undefined, parseEntityMarkdownDocument)
  await pushDocumentAssets('entity', localScan.entityJsonPaths, 'workspace', undefined, parseEntityIndexJson)

  for (let index = 0; index < flattenedPluginInstances.length; index++) {
    const instance = flattenedPluginInstances[index]
    const scan = pluginScans[index]
    await pushDocumentAssets('rule', scan.rulePaths, 'plugin', instance)
    await pushDocumentAssets('skill', scan.skillPaths, 'plugin', instance)
    await pushDocumentAssets('spec', scan.specPaths, 'plugin', instance)
    await pushDocumentAssets('entity', scan.entityDocPaths, 'plugin', instance, parseEntityMarkdownDocument)
    await pushDocumentAssets('entity', scan.entityJsonPaths, 'plugin', instance, parseEntityIndexJson)
  }
  for (const entry of pluginDependencySkillDocs) {
    await pushDocumentAssets(
      'skill',
      [entry.path],
      'plugin',
      entry.instance,
      undefined,
      PLUGIN_SKILL_DEPENDENCY_RESOLVED_BY
    )
  }
  await pushDocumentAssets('skill', homeSkillPaths, 'workspace', undefined, undefined, HOME_BRIDGE_RESOLVED_BY)

  const skills = mergeSkillAssets(skillAssets)
  assets.push(...skills)

  const mcpAssets = new Map<string, Extract<WorkspaceAsset, { kind: 'mcpServer' }>>()
  const addMcpAsset = (
    asset: Extract<WorkspaceAsset, { kind: 'mcpServer' }>,
    options?: { overwrite?: boolean }
  ) => {
    const existing = mcpAssets.get(asset.displayName)
    if (existing != null && options?.overwrite !== true) {
      throw new Error(`Duplicate MCP server ${asset.displayName} from ${existing.sourcePath} and ${asset.sourcePath}`)
    }
    mcpAssets.set(asset.displayName, asset)
  }

  if (params.useDefaultOneworksMcpServer !== false) {
    const defaultOneworksMcpServer = resolveDefaultOneworksMcpServerConfig({
      cwd: params.cwd,
      env
    })
    if (defaultOneworksMcpServer != null) {
      addMcpAsset(createMcpAsset({
        cwd: params.cwd,
        name: DEFAULT_ONEWORKS_MCP_SERVER_NAME,
        config: defaultOneworksMcpServer,
        origin: 'workspace',
        sourcePath: resolveProjectOoBaseDir(params.cwd, env)
      }))
    }
  }

  for (const [name, configValue] of Object.entries(config?.mcpServers ?? {})) {
    if (configValue.enabled === false) continue
    const { enabled: _enabled, ...nextConfig } = configValue
    addMcpAsset(
      createMcpAsset({
        cwd: params.cwd,
        name,
        config: nextConfig as NonNullable<Config['mcpServers']>[string],
        origin: 'workspace',
        sourcePath: resolve(params.cwd, '.oo.config.json')
      }),
      { overwrite: true }
    )
  }

  for (const [name, configValue] of Object.entries(userConfig?.mcpServers ?? {})) {
    if (configValue.enabled === false) continue
    const { enabled: _enabled, ...nextConfig } = configValue
    addMcpAsset(
      createMcpAsset({
        cwd: params.cwd,
        name,
        config: nextConfig as NonNullable<Config['mcpServers']>[string],
        origin: 'workspace',
        sourcePath: resolve(params.cwd, '.oo.dev.config.json')
      }),
      { overwrite: true }
    )
  }

  for (let index = 0; index < flattenedPluginInstances.length; index++) {
    const instance = flattenedPluginInstances[index]
    const scan = pluginScans[index]
    const templateContext = await getManagedClaudePluginTemplateContext(instance)
    for (const path of scan.mcpPaths) {
      const parsed = await parseOptionalStructuredMcpFile(path)
      if (!isRecord(parsed)) continue
      const pluginParsed = transformOneWorksPluginTemplateValue(parsed, {
        pluginRoot: instance.rootDir,
        realHome: resolveRealHomeDir(env),
        nodeExecutable: process.execPath,
        options: instance.options
      })
      const resolvedParsed = transformManagedClaudePluginTemplateValue(pluginParsed, templateContext)
      if (!isRecord(resolvedParsed)) continue
      const fileName = basename(path, extname(path))
      const name = typeof resolvedParsed.name === 'string' && resolvedParsed.name.trim() !== ''
        ? resolvedParsed.name.trim()
        : fileName
      const { name: _name, enabled, ...configValue } = resolvedParsed
      if (enabled === false) continue
      addMcpAsset(createMcpAsset({
        cwd: params.cwd,
        name,
        config: configValue as NonNullable<Config['mcpServers']>[string],
        origin: 'plugin',
        scope: instance.scope,
        sourcePath: path,
        instance
      }))
    }
  }

  const hookPlugins = flattenedPluginInstances
    .filter(instance => resolvePluginHooksEntryPathForInstance(params.cwd, instance) != null)
    .map(instance => createHookPluginAsset(instance))
  assets.push(...hookPlugins)

  const workspaces = await resolveConfiguredWorkspaceAssets({
    cwd: params.cwd,
    configs: [config, userConfig]
  })
  assets.push(...workspaces)

  const opencodeOverlayAssets = flattenedPluginInstances.flatMap((instance, index) => (
    pluginOverlayScans[index].map((entry) =>
      createOpenCodeOverlayAsset({
        cwd: params.cwd,
        kind: entry.kind,
        sourcePath: entry.sourcePath,
        entryName: entry.entryName,
        targetSubpath: entry.targetSubpath,
        instance
      })
    )
  ))
  assets.push(...opencodeOverlayAssets)

  assets.push(...mcpAssets.values())

  const rules = assets.filter((asset): asset is Extract<WorkspaceAsset, { kind: 'rule' }> => asset.kind === 'rule')
  const specs = assets.filter((asset): asset is Extract<WorkspaceAsset, { kind: 'spec' }> => asset.kind === 'spec')
  const entities = assets.filter((asset): asset is Extract<WorkspaceAsset, { kind: 'entity' }> =>
    asset.kind === 'entity'
  )

  assertNoDocumentConflicts([...rules, ...specs, ...entities])
  assertNoMcpConflicts(Array.from(mcpAssets.values()))

  return {
    assets,
    configs: [config, userConfig],
    defaultExcludeMcpServers: [
      ...(config?.defaultExcludeMcpServers ?? []),
      ...(userConfig?.defaultExcludeMcpServers ?? [])
    ],
    defaultIncludeMcpServers: [
      ...(config?.defaultIncludeMcpServers ?? []),
      ...(userConfig?.defaultIncludeMcpServers ?? [])
    ],
    entities,
    hookPlugins,
    mcpServers: Object.fromEntries(Array.from(mcpAssets.values()).map(asset => [asset.displayName, asset])),
    opencodeOverlayAssets,
    pluginConfigs,
    pluginInstances,
    rules,
    skills,
    specs,
    workspaces
  }
}
