/* eslint-disable max-lines -- workspace API contracts stay colocated for shared exports. */
import type { Config, MessageWorkspaceFileOpener } from './config'
import type { Definition, DefinitionSource, Entity, Filter, Rule, Skill, Spec } from './definition'
import type { PluginConfig, ResolvedPluginInstanceMetadata } from './plugin'
import type { SessionStatus } from './session'

export type WorkspaceAssetKind =
  | 'rule'
  | 'spec'
  | 'entity'
  | 'skill'
  | 'workspace'
  | 'mcpServer'
  | 'hookPlugin'
  | 'agent'
  | 'command'
  | 'mode'
  | 'nativePlugin'
export type WorkspaceAssetAdapter = 'claude-code' | 'codex' | 'copilot' | 'gemini' | 'kimi' | 'opencode'
export type AssetDiagnosticStatus = 'native' | 'translated' | 'prompt' | 'skipped'

export interface AssetDiagnostic {
  assetId: string
  adapter: WorkspaceAssetAdapter
  status: AssetDiagnosticStatus
  reason: string
  source: DefinitionSource
  packageId?: string
  scope?: string
  instancePath?: string
  origin: 'workspace' | 'plugin'
  resolvedBy?: string
  taskOverlaySource?: string
}

export interface AdapterOverlayEntry {
  assetId: string
  kind: 'skill' | 'agent' | 'command' | 'mode' | 'nativePlugin'
  sourcePath: string
  targetPath: string
}

export interface WorkspaceAssetBase<TKind extends WorkspaceAssetKind, TPayload> {
  id: string
  kind: TKind
  name: string
  displayName: string
  scope?: string
  origin: 'workspace' | 'plugin'
  sourcePath: string
  instancePath?: string
  packageId?: string
  resolvedBy?: string
  taskOverlaySource?: string
  payload: TPayload
}

export interface WorkspaceDocumentPayload<TDefinition> {
  definition: TDefinition
}

export interface WorkspaceMcpPayload {
  name: string
  config: NonNullable<Config['mcpServers']>[string]
}

export interface WorkspaceDefinitionPayload {
  id: string
  name?: string
  description?: string
  path: string
  cwd: string
  pattern?: string
}

export interface WorkspaceHookPluginPayload {
  packageName?: string
  config: unknown
}

export interface WorkspaceOpenCodeOverlayPayload {
  entryName: string
  targetSubpath: string
}

export type WorkspaceAsset =
  | WorkspaceAssetBase<'rule', WorkspaceDocumentPayload<Definition<Rule>>>
  | WorkspaceAssetBase<'spec', WorkspaceDocumentPayload<Definition<Spec>>>
  | WorkspaceAssetBase<'entity', WorkspaceDocumentPayload<Definition<Entity>>>
  | WorkspaceAssetBase<'skill', WorkspaceDocumentPayload<Definition<Skill>>>
  | WorkspaceAssetBase<'workspace', WorkspaceDefinitionPayload>
  | WorkspaceAssetBase<'mcpServer', WorkspaceMcpPayload>
  | WorkspaceAssetBase<'hookPlugin', WorkspaceHookPluginPayload>
  | WorkspaceAssetBase<'agent', WorkspaceOpenCodeOverlayPayload>
  | WorkspaceAssetBase<'command', WorkspaceOpenCodeOverlayPayload>
  | WorkspaceAssetBase<'mode', WorkspaceOpenCodeOverlayPayload>
  | WorkspaceAssetBase<'nativePlugin', WorkspaceOpenCodeOverlayPayload>

export interface WorkspaceAssetBundle {
  cwd: string
  configs?: [Config?, Config?]
  pluginConfigs?: PluginConfig
  pluginInstances: ResolvedPluginInstanceMetadata[]
  assets: WorkspaceAsset[]
  rules: Array<Extract<WorkspaceAsset, { kind: 'rule' }>>
  specs: Array<Extract<WorkspaceAsset, { kind: 'spec' }>>
  entities: Array<Extract<WorkspaceAsset, { kind: 'entity' }>>
  skills: Array<Extract<WorkspaceAsset, { kind: 'skill' }>>
  workspaces: Array<Extract<WorkspaceAsset, { kind: 'workspace' }>>
  mcpServers: Record<string, Extract<WorkspaceAsset, { kind: 'mcpServer' }>>
  hookPlugins: Array<Extract<WorkspaceAsset, { kind: 'hookPlugin' }>>
  opencodeOverlayAssets: Array<Extract<WorkspaceAsset, { kind: 'agent' | 'command' | 'mode' | 'nativePlugin' }>>
  defaultIncludeMcpServers: string[]
  defaultExcludeMcpServers: string[]
}

export interface PromptAssetResolution {
  rules: Definition<Rule>[]
  targetSkills: Definition<Skill>[]
  entities: Definition<Entity>[]
  skills: Definition<Skill>[]
  specs: Definition<Spec>[]
  workspaces: WorkspaceDefinitionPayload[]
  targetBody: string
  promptAssetIds: string[]
}

export interface WorkspaceSkillSelection {
  include?: string[]
  exclude?: string[]
}

export interface WorkspaceMcpSelection {
  include?: string[]
  exclude?: string[]
}

export interface ResolvedPromptAssetOptions {
  systemPrompt?: string
  tools?: Filter
  mcpServers?: WorkspaceMcpSelection
  promptAssetIds?: string[]
  assetBundle?: WorkspaceAssetBundle
}

export interface AdapterAssetPlan {
  adapter: WorkspaceAssetAdapter
  diagnostics: AssetDiagnostic[]
  mcpServers: Record<string, NonNullable<Config['mcpServers']>[string]>
  overlays: AdapterOverlayEntry[]
}

export type WorkspaceFileOpenerId = Exclude<MessageWorkspaceFileOpener, 'auto'>
export type WorkspaceFileOpenerSource = 'path' | 'macApp' | 'uri'

export interface WorkspaceFileOpenerInfo {
  available: boolean
  iconUrl?: string
  id: WorkspaceFileOpenerId
  source?: WorkspaceFileOpenerSource
  title: string
}

export interface WorkspaceFileOpenersResponse {
  defaultOpener?: WorkspaceFileOpenerId
  openers: WorkspaceFileOpenerInfo[]
}

export interface WorkspaceFileOpenRequest {
  column?: number
  line?: number
  opener?: MessageWorkspaceFileOpener
  path?: string
}

export interface WorkspaceFileOpenResponse {
  ok: true
  opener: WorkspaceFileOpenerInfo
  path: string
}

export interface WorkspaceActivitySession {
  id: string
  status?: SessionStatus
  title?: string
}

export interface WorkspaceActivityResponse {
  activeSessionCount: number
  activeSessions: WorkspaceActivitySession[]
  idle: boolean
}

export type WorkspaceTerminalOpenerId = 'terminal' | 'warp'

export interface WorkspaceTerminalOpenerInfo {
  available: boolean
  iconUrl?: string
  id: WorkspaceTerminalOpenerId
  source?: WorkspaceFileOpenerSource
  title: string
}

export type WorkspaceExternalOpenerId = WorkspaceFileOpenerId | 'fileManager' | WorkspaceTerminalOpenerId

export type WorkspacePathFileManagerKind = 'explorer' | 'fileManager' | 'finder'

export interface WorkspacePathFileManagerCapability {
  available: boolean
  canRevealFile: boolean
  iconUrl?: string
  kind: WorkspacePathFileManagerKind
  title: string
}

export interface WorkspacePathActionCapabilities {
  fileManager: WorkspacePathFileManagerCapability
  terminalOpeners?: WorkspaceTerminalOpenerInfo[]
}

export interface WorkspaceExternalOpenResponse {
  ok: true
  opener: WorkspaceFileOpenerInfo | WorkspacePathFileManagerCapability | WorkspaceTerminalOpenerInfo
  path: string
}
