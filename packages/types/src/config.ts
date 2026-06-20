import type { EffortLevel } from './common'
import type { GitBranchKind } from './git'
import type { PluginConfig, ResolvedPluginInstanceMetadata } from './plugin'
import type { SessionPermissionMode } from './session'
import type { VoiceConfig } from './voice'

export interface AdapterMap {}

export interface AdapterAccountConfigCommon {
  title?: string
  description?: string
}

export interface AdapterConfigCommon {
  /**
   * Runtime adapter package name or package root path used by this configured adapter instance.
   *
   * This lets `adapters.fast` load `@oneworks/adapter-codex`, or a local package path,
   * while keeping `fast` as the user-facing adapter key.
   */
  packageId?: string
  defaultModel?: string
  includeModels?: string[]
  excludeModels?: string[]
  defaultAccount?: string
  accounts?: Record<string, AdapterAccountConfigCommon>
}

export type AdapterConfigEntry<T> = T & AdapterConfigCommon

export type AdapterConfigMap = Partial<
  {
    [K in keyof AdapterMap]: AdapterConfigEntry<AdapterMap[K]>
  }
>

export interface AdapterBuiltinModel {
  value: string
  title: string
  description: string
}

export type IconRef =
  | { kind: 'builtin'; id: string }
  | { kind: 'url'; url: string; darkUrl?: string }
  | { kind: 'data'; value: string; darkValue?: string }
  | { kind: 'material'; name: string }

export type ModelProviderCategory =
  | 'official'
  | 'cloud'
  | 'relay'
  | 'gateway'
  | 'inference'
  | 'custom'
  | 'local'

export type ModelProviderCapabilitySupport =
  | 'api'
  | 'static'
  | 'manual'
  | 'todo'
  | 'unsupported'

export interface ModelProviderCapabilities {
  listModels?: ModelProviderCapabilitySupport
  balance?: ModelProviderCapabilitySupport
  secrets?: ModelProviderCapabilitySupport
  status?: ModelProviderCapabilitySupport
}

export interface ModelProviderPortalLinks {
  homepage?: string
  console?: string
  usage?: string
  billing?: string
  purchase?: string
  topUp?: string
  pricing?: string
  apiKeys?: string
  docs?: string
  status?: string
}

export type ModelServiceBillingKind =
  | 'payg'
  | 'product_subscription'
  | 'coding_plan'
  | 'token_plan'
  | 'relay_coding_plan'

export type ModelServiceKeyKind =
  | 'payg_api_key'
  | 'coding_plan_key'
  | 'subscription_key'

export type ModelServiceQuotaUnit = 'request' | 'token' | 'credit' | 'percent'

export type ModelServiceQuotaWindow = '5h' | 'weekly' | 'monthly'

export type ModelServiceAllowedUse = 'coding_tools_only' | 'general_api'

export interface ModelServiceBillingConfig {
  kind?: ModelServiceBillingKind
  keyKind?: ModelServiceKeyKind
  quotaUnit?: ModelServiceQuotaUnit
  quotaWindows?: ModelServiceQuotaWindow[]
  allowedUse?: ModelServiceAllowedUse
  notes?: string[]
}

export interface ModelProviderProtocolEndpoint {
  baseUrl: string
  docsUrl?: string
}

export interface ModelProviderCodingPlanRegion {
  id: string
  label: string
  billing?: ModelServiceBillingConfig
  protocols?: {
    openai?: ModelProviderProtocolEndpoint
    anthropic?: ModelProviderProtocolEndpoint
  }
  defaultModels?: string[]
  planHomeUrl?: string
  keyHomeUrl?: string
  docsUrl?: string
  restrictions?: string[]
}

export interface ModelProviderCodingPlanDefinition {
  supported: boolean
  official?: boolean
  kind?: ModelServiceBillingKind
  title?: string
  planHomeUrl?: string
  keyHomeUrl?: string
  docsUrl?: string
  billing?: ModelServiceBillingConfig
  protocols?: {
    openai?: ModelProviderProtocolEndpoint
    anthropic?: ModelProviderProtocolEndpoint
  }
  regions?: ModelProviderCodingPlanRegion[]
  defaultModels?: string[]
  restrictions?: string[]
  notes?: string[]
}

export type ModelProviderStatusKind = 'statuspage' | 'cloud_status_openapi' | 'page_only' | 'unsupported'

export interface ModelProviderStatusDefinition {
  kind: ModelProviderStatusKind
  pageUrl?: string
  summaryUrl?: string
  statusUrl?: string
  componentMatchers?: string[]
  requiresCredentials?: boolean
  notes?: string
}

export interface ModelProviderDefinition {
  id: string
  title: string
  description?: string
  category: ModelProviderCategory
  icon?: IconRef
  defaultApiBaseUrl?: string
  defaultModels?: string[]
  billing?: ModelServiceBillingConfig
  codingPlan?: ModelProviderCodingPlanDefinition
  portal?: ModelProviderPortalLinks
  capabilities?: ModelProviderCapabilities
  status?: ModelProviderStatusDefinition
}

export interface ModelServiceManagementConfig {
  enabled?: boolean
  apiKey?: string
  baseUrl?: string
  headers?: Record<string, string>
  organizationId?: string
  userId?: string
  projectId?: string
  endpointKind?: string
}

export interface ModelServiceConfig {
  kind?: 'service' | 'collection'
  title?: string
  description?: string
  provider?: string
  icon?: string
  homepageUrl?: string
  apiBaseUrl?: string
  apiKey?: string
  models?: string[]
  timeoutMs?: number
  maxOutputTokens?: number
  billing?: ModelServiceBillingConfig
  codingPlan?: Partial<ModelProviderCodingPlanDefinition> & {
    enabled?: boolean
    region?: string
  }
  providerOptions?: Record<string, unknown>
  management?: ModelServiceManagementConfig
  profiles?: Record<string, ModelServiceConfig>
  services?: Record<string, ModelServiceConfig>
  extra?: Record<string, unknown>
}

export interface ResolvedModelServiceConfig extends ModelServiceConfig {
  apiBaseUrl: string
  apiKey: string
  modelSource?: 'configured' | 'provider_catalog' | 'remote_cache'
  providerDefinition?: ModelProviderDefinition
}

export interface ModelProviderIdentity {
  provider?: string
  confidence: 'configured' | 'host_match' | 'none'
  warnings?: string[]
}

export interface ProviderModelInfo {
  id: string
  title?: string
  ownedBy?: string
  createdAt?: number
  contextLength?: number
  maxOutputTokens?: number
  supportsReasoning?: boolean
  inputModalities?: Array<'text' | 'image' | 'audio' | 'video' | 'file'>
  outputModalities?: Array<'text' | 'image' | 'audio' | 'video'>
  raw?: unknown
}

export type ProviderAccountStatus =
  | { kind: 'balance'; currency?: string; available?: number; raw?: unknown }
  | { kind: 'cost'; currency?: string; amount?: number; period?: string; raw?: unknown }
  | {
    kind: 'quota'
    currency?: string
    unit?: ModelServiceQuotaUnit
    limit?: number
    remaining?: number
    resetTime?: string
    unlimited?: boolean
    used?: number
    windows?: Array<{
      duration?: number
      limit?: number
      remaining?: number
      resetTime?: string
      timeUnit?: string
    }>
    parallelLimit?: number
    plan?: string
    raw?: unknown
  }
  | { kind: 'unsupported'; reason: string }

export type ProviderStatusIndicator =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance'
  | 'unknown'
  | 'unsupported'

export interface ProviderServiceStatus {
  indicator: ProviderStatusIndicator
  description?: string
  pageUrl?: string
  checkedAt: string
  components?: Array<{ name: string; status: string }>
  incidents?: Array<{ name: string; status?: string; impact?: string }>
  source: ModelProviderStatusKind
}

export type ProviderSecretResult =
  | { kind: 'created'; value: string; id?: string; expiresAt?: number; raw?: unknown }
  | { kind: 'console'; url: string; reason: string }
  | { kind: 'unsupported'; reason: string }

export interface ProviderManagementGroup {
  id: string
  title?: string
  description?: string
  ratio?: number
  raw?: unknown
}

export interface ProviderManagementToken {
  id: string
  name?: string
  key?: string
  status?: number
  group?: string
  quota?: number
  remaining?: number
  unlimited?: boolean
  expiredAt?: number
  createdAt?: number
  accessedAt?: number
  modelLimits?: string[]
  modelLimitsEnabled?: boolean
}

export interface ProviderManagementSnapshot {
  kind: 'newapi'
  account?: ProviderAccountStatus
  groups: ProviderManagementGroup[]
  models: ProviderModelInfo[]
  tokens: ProviderManagementToken[]
}

export interface ProviderManagementTokenCreateInput {
  name: string
  group?: string
  quota?: number
  unlimited?: boolean
  modelLimits?: string[]
  modelLimitsEnabled?: boolean
  allowIps?: string
  expiredAt?: number
}

export interface ProviderManagementTokenUpdateInput {
  id: string
  name?: string
  group?: string
  quota?: number
  unlimited?: boolean
  status?: number
  modelLimits?: string[]
  modelLimitsEnabled?: boolean
  allowIps?: string
  expiredAt?: number
}

export interface ProviderManagementMutationResult {
  success: boolean
  message?: string
  token?: ProviderManagementToken
  profile?: ModelServiceConfig
}

export interface ProviderManagementTokenProfileResult {
  profile: ModelServiceConfig
}

export interface RecommendedModelConfig {
  service?: string
  model: string
  title?: string
  description?: string
  placement?: 'modelSelector'
}

export interface ModelMetadataConfig {
  alias?: string | string[]
  title?: string
  description?: string
  icon?: string
  defaultAdapter?: string
  effort?: EffortLevel
}

export type LanguageCode = 'zh' | 'en'

export type NotificationTrigger = 'completed' | 'failed' | 'terminated' | 'waiting_input'

export interface NotificationEventConfig {
  title?: string
  description?: string
  disabled?: boolean
  sound?: string
}

export interface NotificationConfig {
  disabled?: boolean
  volume?: number
  events?: Partial<Record<NotificationTrigger, NotificationEventConfig>>
}

export type MessageExternalLinkTarget = 'newTab' | 'currentTab'
export type MessageWorkspaceFileTarget = 'fileTab' | 'externalIde' | 'defaultLink'
export type MessageWorkspaceFileOpener =
  | 'auto'
  | 'vscode'
  | 'cursor'
  | 'windsurf'
  | 'zed'
  | 'intellij'
  | 'webstorm'
  | 'pycharm'
  | 'goland'
  | 'textedit'
export type MessageImageLinkMode = 'inlinePreview' | 'link'
export type MessagePlainWorkspacePathMode = 'link' | 'text'

export interface MessageLinksConfig {
  externalLinkTarget?: MessageExternalLinkTarget
  workspaceFileTarget?: MessageWorkspaceFileTarget
  workspaceFileOpener?: MessageWorkspaceFileOpener
  imageLinkMode?: MessageImageLinkMode
  plainWorkspacePathMode?: MessagePlainWorkspacePathMode
}

export type AppearancePrimaryColor = '#E23F12' | '#3F7E8F' | '#00B454' | '#8B9493'
export type AppearanceThemeMode = 'system' | 'light' | 'dark'
export type IconBackground = 'transparent' | 'solid' | 'textured'
/**
 * @deprecated Icon background is a desktop preference. Use `DesktopIconBackground`.
 */
export type AppearanceIconBackground = IconBackground

export interface AppearanceConfig {
  primaryColor?: AppearancePrimaryColor
  themeMode?: AppearanceThemeMode
}

export type DesktopIconAppearance = 'system' | 'light' | 'dark'
export type DesktopIconBackground = IconBackground
export type DesktopIconTheme = 'industrial' | 'metal' | 'matrix'
export type DesktopUpdateChannel = 'stable' | 'rc' | 'beta' | 'alpha'
export type DesktopModuleUpdateChannels = Record<string, DesktopUpdateChannel>

export interface DesktopConfig {
  launcherShortcut?: string
  openLastWorkspaceOnStartup?: boolean
  syncAppIcon?: boolean
  iconAppearance?: DesktopIconAppearance
  iconBackground?: DesktopIconBackground
  iconTheme?: DesktopIconTheme
  autoUpdate?: boolean
  updateChannel?: DesktopUpdateChannel
  moduleUpdateChannels?: DesktopModuleUpdateChannels
}

export interface SkillsCliConfig {
  source?: 'managed' | 'system' | 'path'
  path?: string
  package?: string
  version?: string
  autoInstall?: boolean
  prepareOnInstall?: boolean
  npmPath?: string
  registry?: string
  /**
   * @deprecated Use `registry` instead.
   */
  npmRegistry?: string
  env?: Record<string, string>
}

export interface SkillRegistryPublishConfig {
  access?: string
  group?: string
  region?: string
}

export interface ConfiguredSkillRegistry {
  title?: string
  description?: string
  source: string
  registry?: string
  publish?: SkillRegistryPublishConfig
}

export interface SkillHomeBridgeConfig {
  enabled?: boolean
  roots?: string | string[]
}

export interface ConfiguredSkillInstallEntryConfig {
  name: string
  registry?: string
  source?: string
  version?: string
  rename?: string
}

export type ConfiguredSkillIncludeConfig = string | {
  name: string
  rename?: string
  version?: string
}

export interface ConfiguredSkillCollectionConfig {
  include?: ConfiguredSkillIncludeConfig[]
  registry?: string
  source: string
  version?: string
}

export type ConfiguredSkillInstallConfig =
  | ConfiguredSkillInstallEntryConfig
  | ConfiguredSkillCollectionConfig

export interface ObjectSkillsConfig {
  items?: Array<string | ConfiguredSkillInstallConfig>
  /**
   * Default npm registry used to install the managed `skills` CLI.
   */
  registry?: string
  homeBridge?: SkillHomeBridgeConfig
  /**
   * @deprecated Use `items` instead.
   */
  install?: Array<string | ConfiguredSkillInstallConfig>
}

export type SkillsConfig =
  | Array<string | ConfiguredSkillInstallConfig>
  | ObjectSkillsConfig

export interface SkillsMetaConfig {
  bundled?: boolean
  registries?: string[]
  sources?: string[]
  homeBridge?: SkillHomeBridgeConfig
}

export interface WorkspaceConfigEntry {
  enabled?: boolean
  name?: string
  description?: string
  path?: string
  glob?: string | string[]
  globs?: string | string[]
  include?: string | string[]
  exclude?: string | string[]
}

export interface WorkspacesConfig {
  include?: string | string[]
  exclude?: string | string[]
  glob?: string | string[]
  globs?: string | string[]
  entries?: Record<string, string | WorkspaceConfigEntry>
}

export type WorkspaceConfig = string | string[] | WorkspacesConfig

export interface ClaudeCodeMarketplaceSourceGithub {
  source: 'github'
  repo: string
  ref?: string
  path?: string
}

export interface ClaudeCodeMarketplaceSourceGit {
  source: 'git'
  url: string
  ref?: string
  path?: string
}

export interface ClaudeCodeMarketplaceSourceDirectory {
  source: 'directory'
  path: string
}

export interface ClaudeCodeMarketplaceSourceUrl {
  source: 'url'
  url: string
}

export interface ClaudeCodeMarketplacePluginSourceGithub {
  source: 'github'
  repo: string
  ref?: string
  sha?: string
}

export interface ClaudeCodeMarketplacePluginSourceGit {
  source: 'url'
  url: string
  ref?: string
  sha?: string
}

export interface ClaudeCodeMarketplacePluginSourceGitSubdir {
  source: 'git-subdir'
  url: string
  path: string
  ref?: string
  sha?: string
}

export interface ClaudeCodeMarketplacePluginSourceNpm {
  source: 'npm'
  package: string
  version?: string
  registry?: string
}

export type ClaudeCodeMarketplacePluginSource =
  | string
  | ClaudeCodeMarketplacePluginSourceGithub
  | ClaudeCodeMarketplacePluginSourceGit
  | ClaudeCodeMarketplacePluginSourceGitSubdir
  | ClaudeCodeMarketplacePluginSourceNpm

export interface ClaudeCodeMarketplacePluginDefinition {
  name: string
  description?: string
  version?: string
  strict?: boolean
  skills?: string | string[]
  commands?: string | string[]
  agents?: string | string[]
  hooks?: string | string[] | Record<string, unknown>
  mcpServers?: string | string[] | Record<string, unknown>
  userConfig?: unknown
  source: ClaudeCodeMarketplacePluginSource
}

export interface ClaudeCodeMarketplaceSourceSettings {
  source: 'settings'
  name?: string
  metadata?: {
    pluginRoot?: string
  }
  plugins: ClaudeCodeMarketplacePluginDefinition[]
}

export interface ClaudeCodeMarketplaceSourceHostPattern {
  source: 'hostPattern'
  hostPattern: string
}

export type ClaudeCodeMarketplaceSource =
  | ClaudeCodeMarketplaceSourceGithub
  | ClaudeCodeMarketplaceSourceGit
  | ClaudeCodeMarketplaceSourceDirectory
  | ClaudeCodeMarketplaceSourceUrl
  | ClaudeCodeMarketplaceSourceSettings
  | ClaudeCodeMarketplaceSourceHostPattern

export interface ClaudeCodeMarketplaceOptions {
  source: ClaudeCodeMarketplaceSource
}

export interface MarketplaceDeclaredPluginConfig {
  enabled?: boolean
  scope?: string
}

export interface ClaudeCodeMarketplaceConfigEntry {
  type: 'claude-code'
  enabled?: boolean
  syncOnRun?: boolean
  plugins?: Record<string, MarketplaceDeclaredPluginConfig>
  options?: ClaudeCodeMarketplaceOptions
}

export type MarketplaceConfigEntry = ClaudeCodeMarketplaceConfigEntry

export type MarketplaceConfig = Record<string, MarketplaceConfigEntry>

export interface WebAuthAccountConfig {
  username: string
  password: string
}

export interface WebAuthConfig {
  enabled?: boolean
  username?: string
  password?: string
  accounts?: WebAuthAccountConfig[]
  sessionTtlHours?: number
  rememberDeviceTtlDays?: number
}

export interface ServerPublicConfig {
  schema?: 'http' | 'https'
  domain?: string
  port?: number
}

export interface ServerConfig {
  public?: ServerPublicConfig
  publicPaths?: string[]
}

export type ConversationStarterMode = 'default' | 'workspace' | 'entity' | 'agent' | 'spec'

export interface ConversationStarterWorktreeConfig {
  create?: boolean
  environment?: string
  branch?: {
    name: string
    kind?: GitBranchKind
    mode?: 'checkout' | 'create'
  }
}

export interface ConversationStarterConfig {
  id?: string
  title: string
  description?: string
  icon?: string
  mode?: ConversationStarterMode
  target?: string
  targetLabel?: string
  targetDescription?: string
  model?: string
  adapter?: string
  account?: string
  effort?: EffortLevel | 'default'
  permissionMode?: SessionPermissionMode
  worktree?: ConversationStarterWorktreeConfig
  prompt?: string
  files?: string[]
  rules?: string[]
  skills?: string[]
}

export interface ConversationRunCommandEnvVarConfig {
  key: string
  value: string
}

export interface ConversationRunCommandConfig {
  cwd?: string
  env?: ConversationRunCommandEnvVarConfig[]
  icon?: string
  id?: string
  isFavorite?: boolean
  name?: string
  script: string
}

export interface ExperimentsConfig {
  agentRoom?: boolean
  automation?: boolean
  benchmark?: boolean
  sessionTimeline?: boolean
}

export interface StartupProfileDiagnosticsConfig {
  enabled?: boolean
  console?: boolean
  log?: boolean
  thresholdMs?: number
}

export interface DiagnosticsConfig {
  startupProfile?: boolean | StartupProfileDiagnosticsConfig
}

export interface PluginConfigHookContext {
  cwd: string
  env: Record<string, string | null | undefined>
  jsonVariables: Record<string, string | null | undefined>
  projectConfig?: Config
  userConfig?: Config
  mergedConfig: Config
  plugin: ResolvedPluginInstanceMetadata
}

export type PluginConfigHook = (
  context: PluginConfigHookContext
) => Config | undefined | void | Promise<Config | undefined | void>

export interface Config {
  extend?: string | string[]
  baseDir?: string
  disableGlobalConfig?: boolean
  effort?: EffortLevel
  adapters?: AdapterConfigMap
  models?: Record<string, ModelMetadataConfig>
  defaultAdapter?: keyof AdapterMap
  modelServices?: Record<string, ModelServiceConfig>
  workspaces?: WorkspaceConfig
  channels?: Record<string, unknown>
  server?: ServerConfig
  defaultModelService?: string
  defaultModel?: string
  recommendedModels?: RecommendedModelConfig[]
  interfaceLanguage?: string
  modelLanguage?: LanguageCode
  mcpServers?: Record<
    string,
    & {
      enabled?: boolean
      env?: Record<string, string>
    }
    & (
      | {
        type?: undefined
        command: string
        args: string[]
      }
      | {
        type: 'sse'
        url: string
        headers: Record<string, string>
      }
      | {
        type: 'http'
        url: string
        headers?: Record<string, string>
      }
    )
  >
  defaultIncludeMcpServers?: string[]
  defaultExcludeMcpServers?: string[]
  noDefaultOneworksMcpServer?: boolean
  permissions?: {
    allow?: string[]
    deny?: string[]
    ask?: string[]
    defaultMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  }
  env?: Record<string, string>
  announcements?: string[]
  shortcuts?: {
    newSession?: string
    openConfig?: string
    sendMessage?: string
    clearInput?: string
    switchModel?: string
    switchEffort?: string
    switchPermissionMode?: string
  }
  notifications?: NotificationConfig
  messageLinks?: MessageLinksConfig
  appearance?: AppearanceConfig
  desktop?: DesktopConfig
  skills?: SkillsConfig
  skillsMeta?: SkillsMetaConfig
  skillRegistries?: ConfiguredSkillRegistry[]
  webAuth?: WebAuthConfig
  conversation?: {
    style?: 'friendly' | 'programmatic'
    customInstructions?: string
    injectDefaultSystemPrompt?: boolean
    showSessionCardMessage?: boolean
    createSessionWorktree?: boolean
    worktreeEnvironment?: string
    startupPresets?: ConversationStarterConfig[]
    builtinActions?: ConversationStarterConfig[]
    runCommands?: ConversationRunCommandConfig[]
  }
  /**
   * 当前 workspace 默认启用的插件实例列表。
   *
   * 内置 One Works 插件会优先按运行时声明的版本从全局 package cache 解析，缺失时再安装。
   * 其他插件包需要先安装到当前项目中，或使用目录路径引用。
   *
   * @example
   * ```json
   * [
   *   { "id": "standard-dev", "scope": "std" },
   *   { "id": "logger", "enabled": false }
   * ]
   * ```
   */
  plugins?: PluginConfig
  marketplaces?: MarketplaceConfig
  voice?: VoiceConfig
  experiments?: ExperimentsConfig
  diagnostics?: DiagnosticsConfig
}

export interface AboutInfo {
  version?: string
  lastReleaseAt?: string
  urls?: {
    repo?: string
    docs?: string
    contact?: string
    issues?: string
    releases?: string
  }
}

export interface ConfigSection {
  general?: {
    baseDir?: Config['baseDir']
    disableGlobalConfig?: Config['disableGlobalConfig']
    effort?: Config['effort']
    defaultAdapter?: Config['defaultAdapter']
    defaultModelService?: Config['defaultModelService']
    defaultModel?: Config['defaultModel']
    recommendedModels?: Config['recommendedModels']
    interfaceLanguage?: Config['interfaceLanguage']
    modelLanguage?: Config['modelLanguage']
    announcements?: Config['announcements']
    permissions?: Config['permissions']
    env?: Config['env']
    notifications?: Config['notifications']
    messageLinks?: Config['messageLinks']
    skills?: Config['skills']
    skillsMeta?: Config['skillsMeta']
    skillRegistries?: Config['skillRegistries']
    webAuth?: Config['webAuth']
  }
  conversation?: Config['conversation']
  models?: Config['models']
  modelServices?: Config['modelServices']
  workspaces?: Config['workspaces']
  channels?: Config['channels']
  server?: Config['server']
  adapters?: Config['adapters']
  adapterBuiltinModels?: Record<string, AdapterBuiltinModel[]>
  appearance?: Config['appearance']
  desktop?: Config['desktop']
  plugins?: {
    plugins?: Config['plugins']
    marketplaces?: Config['marketplaces']
  }
  mcp?: {
    mcpServers?: Config['mcpServers']
    defaultIncludeMcpServers?: Config['defaultIncludeMcpServers']
    defaultExcludeMcpServers?: Config['defaultExcludeMcpServers']
    noDefaultOneworksMcpServer?: Config['noDefaultOneworksMcpServer']
  }
  shortcuts?: Config['shortcuts']
  auth?: Config['webAuth']
  voice?: Config['voice']
  experiments?: Config['experiments']
  diagnostics?: Config['diagnostics']
}

export interface ConfigResponse {
  sources?: {
    global?: ConfigSection
    project?: ConfigSection
    user?: ConfigSection
    merged?: ConfigSection
  }
  resolvedSources?: {
    global?: ConfigSection
    project?: ConfigSection
    user?: ConfigSection
  }
  meta?: {
    workspaceFolder?: string
    configPresent?: {
      global?: boolean
      project?: boolean
      user?: boolean
    }
    sourceFiles?: {
      global?: {
        configPath?: string
        writableConfigPath?: string
        extendPaths?: string[]
      }
      project?: {
        configPath?: string
        writableConfigPath?: string
        extendPaths?: string[]
      }
      user?: {
        configPath?: string
        writableConfigPath?: string
        extendPaths?: string[]
      }
    }
    experiments?: ExperimentsConfig
    about?: AboutInfo
  }
}

export type ConfigUiFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'select'
  | 'json'
  | 'multiline'

export interface ConfigUiFieldOption {
  value: string
  label?: string
  description?: string
}

export interface ConfigUiField {
  path: string[]
  type: ConfigUiFieldType
  defaultValue?: unknown
  label?: string
  description?: string
  icon?: string
  placeholder?: string
  sensitive?: boolean
  options?: ConfigUiFieldOption[]
}

export interface ConfigUiRecordFieldSchema {
  keyPlaceholder?: string
  itemSchema?: ConfigUiObjectSchema
}

export interface ConfigUiObjectSchema {
  fields: ConfigUiField[]
  recordFields?: Record<string, ConfigUiRecordFieldSchema>
}

export interface ConfigUiRecordKind {
  key: string
  label?: string
  description?: string
}

export interface ConfigUiRecordMapSchema {
  mode: 'keyed' | 'discriminated'
  keyPlaceholder?: string
  discriminatorField?: string
  entryKinds?: ConfigUiRecordKind[]
  schemas: Record<string, ConfigUiObjectSchema>
  unknownSchema?: ConfigUiObjectSchema
  unknownEditor?: 'json'
}

export interface ConfigUiSection {
  key: string
  title?: string
  description?: string
  kind: 'recordMap'
  recordMap: ConfigUiRecordMapSchema
}

export interface ConfigUiSchema {
  version: 1
  sections: Record<string, ConfigUiSection>
}

export type ConfigJsonSchema = Record<string, unknown>

export interface ConfigSchemaVariant {
  jsonSchema: ConfigJsonSchema
  uiSchema?: ConfigUiSchema
  outputPath?: string
  extensions?: {
    adapters: string[]
    channels: string[]
  }
}

export interface ConfigSchemaResponse {
  base: ConfigSchemaVariant
  workspace: ConfigSchemaVariant
}
