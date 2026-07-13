/* eslint-disable max-lines -- shared plugin contract keeps config, manifest, runtime, and managed plugin types together. */
import type { ConfigJsonSchema, ConfigUiObjectSchema, IconRef, MarketplaceConfigEntry } from './config'

/**
 * 用户配置中的单个插件实例。
 *
 * 该结构同时用于顶层 `Config.plugins` 和 `children`。
 */
export interface PluginChildConfig {
  /**
   * npm 包名或插件简写名。
   *
   * 裸名会按 `id -> @oneworks/plugin-${id}` 的顺序解析。
   *
   * @example "logger"
   * @example "@acme/plugin-docs"
   */
  id: string
  /**
   * 是否启用当前插件实例。
   *
   * 默认为 `true`。设为 `false` 时，该实例不会进入当前任务的有效插件图。
   * 这个字段同样可以用于 child plugin，用来关闭默认激活的 child。
   */
  enabled?: boolean
  /**
   * 是否监听当前插件目录的本地文件变更。
   *
   * 开启后 server 会在检测到变更时重新加载 plugin runtime，并通知前端通过 plugin HMR 通道重载对应界面插件。
   * `.oo/plugins.dev` 下自动发现的插件默认开启。
   */
  watch?: boolean
  /**
   * 托管插件包版本。
   *
   * 内置 OneWorks 插件会优先用该版本从全局 package cache 解析；全局缺失时再看 workspace 或运行时包目录，最后按需安装。
   * 未配置时，内置插件使用 npm `latest`；非内置插件仍需要显式安装或通过目录路径引用。
   */
  version?: string
  /**
   * 用户定义的资源命名空间。
   *
   * 如果配置了 `scope`，插件导出的资源会以 `scope/name` 的形式暴露，
   * 例如 `std/standard-dev-flow`。
   *
   * scope 完全由用户控制，插件 manifest 侧不允许声明默认 scope。
   */
  scope?: string
  /**
   * 传给插件 hooks 或 child 解析逻辑的实例级参数。
   */
  options?: Record<string, unknown>
  /**
   * 显式启用或覆写 child plugin。
   *
   * child plugin 可以来自父插件 manifest，也可以是任意已安装依赖。
   * child 未显式设置 `scope` 时，会继承父实例的 `scope`。
   */
  children?: PluginChildConfig[]
}

export interface PluginInstanceConfig extends PluginChildConfig {}

/**
 * 项目级或用户级的插件实例列表。
 *
 * project config 与 user config 会按数组顺序拼接。
 */
export type PluginConfig = PluginInstanceConfig[]

/**
 * `spec` / `entity` 级别的插件覆盖配置。
 *
 * 这层覆盖只作用于当前任务，不会回写项目配置。
 */
export interface PluginOverlayConfig {
  /**
   * `extend` 会在项目有效插件列表后追加 `list`；
   * `override` 会直接用 `list` 替换项目有效插件列表。
   */
  mode: 'extend' | 'override'
  /**
   * 参与当前任务覆盖的插件实例列表。
   */
  list: PluginInstanceConfig[]
}

export interface PluginManifestAssets {
  rules?: string
  skills?: string
  specs?: string
  entities?: string
  mcp?: string
  hooks?: string
}

export interface PluginClientManifest {
  entry?: string
  root?: string
  devEntry?: string
  devServer?: string
}

export type PluginServerRuntimeRole = 'manager' | 'workspace'

export interface PluginServerManifest {
  entry?: string
  roles: PluginServerRuntimeRole[]
}

export type PluginLocalizedText = string | Record<string, string>
export type PluginRuntimeSourceGroup = 'builtIn' | 'global' | 'project' | 'localDev'
export type PluginContributionSurface = 'launcher' | 'workspace'

export interface PluginConfigManifest {
  jsonSchema?: ConfigJsonSchema
  schema?: ConfigJsonSchema
  uiSchema?: ConfigUiObjectSchema
}

export interface PluginConfigHookManifest {
  /** 插件包内的 config hook 入口。相对路径从插件根目录解析。 */
  entry?: string
}

export interface PluginContributionAvailability {
  roles?: PluginServerRuntimeRole[]
  surfaces?: PluginContributionSurface[]
}

export interface PluginContributionBase extends PluginContributionAvailability {
  description?: PluginLocalizedText
  descriptionI18n?: Record<string, string>
  i18n?: Record<string, {
    description?: string
    title?: string
  }>
  titleI18n?: Record<string, string>
}

export interface PluginContributionNavItem extends PluginContributionBase {
  id: string
  title: string
  icon?: string
  command?: string
  payload?: unknown
  route?: string
}

export interface PluginContributionMenuItem extends PluginContributionBase {
  id: string
  title: string
  children?: PluginContributionMenuItem[]
  icon?: string
  command?: string
  payload?: unknown
  danger?: boolean
  disabled?: boolean
  href?: string
  route?: string
  selected?: boolean
  shortcut?: string
}

export interface PluginContributionChatHeaderAction extends PluginContributionBase {
  id: string
  title: string
  icon?: string
  command: string
}

export interface PluginContributionRouteHeaderAction extends PluginContributionBase {
  id: string
  title: string
  active?: boolean
  icon?: string
  activeIcon?: string
  activeLabel?: string
  activeTitle?: string
  command: string
  danger?: boolean
  disabled?: boolean
  shortcut?: string
  /**
   * Host route container where this contribution is shown. This is a display
   * condition only; menu/navigation actions should use `route` for click
   * navigation instead.
   */
  targetRoute?: string
  /**
   * Additional host route containers where this contribution is shown. Values
   * may be route keys, app-relative paths, basename-prefixed paths, or `/*`
   * wildcard paths.
   */
  targetRoutes?: string[]
}

export interface PluginContributionRouteMenuItem extends PluginContributionMenuItem {
  active?: boolean
  activeIcon?: string
  danger?: boolean
  disabled?: boolean
  selected?: boolean
  shortcut?: string
  /**
   * Host route container where this menu item is shown. The inherited `route`
   * field remains the click navigation target and is not used for matching.
   */
  targetRoute?: string
  /**
   * Additional host route containers where this menu item is shown. Values may
   * be route keys, app-relative paths, basename-prefixed paths, or `/*`
   * wildcard paths.
   */
  targetRoutes?: string[]
}

export interface PluginContributionWorkbenchTab extends PluginContributionBase {
  id: string
  title: string
  icon?: string
  command?: string
  placement?: 'bottom' | 'right'
  clientView?: string
}

export interface PluginContributionWorkspaceDrawerTab extends PluginContributionBase {
  id: string
  title: string
  icon?: string
  command?: string
  placement?: 'bottom' | 'right'
  clientView?: string
}

export interface PluginContributionWorkbenchAddMenuItem extends PluginContributionMenuItem {
  /**
   * Creates a workbench tab from the plugin's `workbenchTabs` contribution.
   * Defaults to this menu item's `id` when command / route / href are not set.
   */
  tab?: string
}

export interface PluginContributionChatInteractionPanelEmptyAction extends PluginContributionMenuItem {
  /**
   * Shortcut hint rendered in the chat interaction panel empty action card.
   * This is display-only; the host still owns keyboard handling.
   */
  shortcut?: string
}

export interface PluginContributionSessionGroupMatch {
  /**
   * All listed tags must be present on a session for it to enter this group.
   */
  tags?: string[]
  /**
   * A session enters this group when it has at least one listed tag.
   */
  anyTags?: string[]
  /**
   * A session is excluded from this group when any listed tag is present.
   */
  excludedTags?: string[]
  /**
   * A session enters this group when it has at least one tag starting with any
   * listed prefix.
   */
  tagPrefixes?: string[]
  /**
   * A session is excluded from this group when any tag starts with a listed
   * prefix.
   */
  excludedTagPrefixes?: string[]
  /**
   * Optional branches for compound group matching. The session must satisfy at
   * least one branch in addition to the direct fields on this matcher.
   */
  anyOf?: PluginContributionSessionGroupMatch[]
  adapters?: string[]
  accounts?: string[]
}

export interface PluginContributionSessionGroupCreateSession {
  tags?: string[]
  title?: string
}

export interface PluginContributionSessionGroupAction extends PluginContributionBase {
  id: string
  title: string
  command?: string
  createSession?: PluginContributionSessionGroupCreateSession
  danger?: boolean
  disabled?: boolean
  href?: string
  icon?: string
  route?: string
  shortcut?: string
}

export interface PluginContributionSessionGroup extends PluginContributionBase {
  id: string
  title: string
  actions?: PluginContributionSessionGroupAction[]
  icon?: string
  match?: PluginContributionSessionGroupMatch
  showWhenEmpty?: boolean
}

export interface PluginContributionLauncherSearchProvider extends PluginContributionBase {
  id: string
  title: string
  command: string
}

export type PluginContributionToolUseFieldFormat =
  | 'inline'
  | 'text'
  | 'code'
  | 'list'
  | 'chips'
  | 'records'
  | 'json'

export interface PluginContributionToolUseRecordItem {
  /** Dot-separated path within each record. */
  titlePath?: string
  subtitlePath?: string
  statusPath?: string
  metaPath?: string
  detailPath?: string
}

export interface PluginContributionToolUseField {
  /** Dot-separated path within the tool input. Array indexes are supported. */
  path: string
  title: string
  titleI18n?: Record<string, string>
  format?: PluginContributionToolUseFieldFormat
  item?: PluginContributionToolUseRecordItem
  language?: string
}

export interface PluginContributionToolUseInputPresentation {
  /**
   * `auto` keeps the host's generic input renderer, `declared` renders only
   * `fields`, and `hidden` omits tool-call input details.
   */
  mode?: 'auto' | 'declared' | 'hidden'
  fields?: PluginContributionToolUseField[]
}

export interface PluginContributionToolUseResultPresentation {
  format?: 'auto' | 'text' | 'code' | 'json' | 'markdown'
  fields?: PluginContributionToolUseField[]
  language?: string
  mode?: 'auto' | 'declared' | 'hidden'
}

export interface PluginContributionToolUsePresentation extends PluginContributionBase {
  id: string
  title: string
  icon?: string
  /** Tool base names or fully-qualified runtime tool names. */
  tools: string[]
  /**
   * Defaults to `plugin`, which limits base-name matches to MCP tools exposed
   * by the contribution's own plugin scope. `any` must be chosen explicitly.
   */
  origin?: 'plugin' | 'any'
  /** Dot-separated input path rendered beside the title as the compact target. */
  target?: string
  input?: PluginContributionToolUseInputPresentation
  result?: PluginContributionToolUseResultPresentation
}

export interface PluginLauncherSearchResult {
  badge?: string
  description?: string
  groupIcon?: string
  groupId?: string
  groupOrder?: number
  groupTitle?: string
  icon?: string
  id: string
  keywords?: string[]
  route?: string
  sectionIcon?: string
  sectionId?: string
  sectionOrder?: number
  sectionTitle?: string
  subtitle?: string
  title: string
}

export interface PluginContributionCliCommand extends PluginContributionBase {
  aliases?: string[]
  command: string
  id: string
  path?: string[]
  root?: boolean
  title?: string
}

export interface PluginContributionRoute extends PluginContributionBase {
  id: string
  title?: string
  icon?: string
  clientView?: string
  routeId?: string
}

interface PluginContributionSettingsPageBase extends PluginContributionBase {
  id: string
  title: string
  icon?: string
}

export type PluginContributionSettingsPage =
  & PluginContributionSettingsPageBase
  & (
    | {
      /** Plugin-owned view mounted through the shared PluginViewHost runtime. */
      clientView: string
      schema?: never
      uiSchema?: never
    }
    | {
      /** Host-rendered options form persisted to this plugin instance. */
      clientView?: never
      schema: ConfigJsonSchema
      uiSchema?: ConfigUiObjectSchema
    }
  )

export interface PluginExtensionPointManifest extends PluginContributionBase {
  contributionSchema?: ConfigJsonSchema
  id: string
  title?: PluginLocalizedText
}

export interface PluginExtensionContributionManifest extends PluginContributionBase {
  id: string
  target: string
  title?: PluginLocalizedText
  [key: string]: unknown
}

export interface PluginContributionManifest extends PluginContributionAvailability {
  extensionContributions?: PluginExtensionContributionManifest[]
  extensionPoints?: PluginExtensionPointManifest[]
  navItems?: PluginContributionNavItem[]
  /** Settings subpages rendered inside the host Settings route. */
  settingsPages?: PluginContributionSettingsPage[]
  navMoreMenu?: PluginContributionMenuItem[]
  /**
   * Structured actions rendered in the left navigation footer slot directly
   * above the built-in More menu. The host owns layout, active state, and menu
   * chrome; plugins only provide command / route / href targets.
   */
  navFooterBefore?: PluginContributionMenuItem[]
  chatHeaderActions?: PluginContributionChatHeaderAction[]
  chatHeaderMoreMenu?: PluginContributionMenuItem[]
  /**
   * Chat-specific action cards rendered in the interaction panel empty state.
   * The chat route owns card layout and execution; plugins provide only
   * structured actions with command / route / href targets.
   */
  chatInteractionPanelEmptyActions?: PluginContributionChatInteractionPanelEmptyAction[]
  /**
   * Session-list groups rendered by the host sidebar. The host owns list
   * ordering, selection, row chrome, and session creation; plugins only provide
   * declarative match rules and structured title actions.
   */
  sessionGroups?: PluginContributionSessionGroup[]
  /**
   * Icon actions rendered by the active route container header. The route
   * container owns button chrome, icon sizing, tooltip, active icon swaps, and
   * disabled / danger interactions.
   */
  routeHeaderActions?: PluginContributionRouteHeaderAction[]
  /**
   * Items merged into the active route container "more" menu. These extend
   * route-owned actions instead of replacing them.
   */
  routeMoreMenuItems?: PluginContributionRouteMenuItem[]
  /** @deprecated Use `routeMoreMenuItems`; this alias is kept for older local plugin manifests. */
  routeMoreMenu?: PluginContributionRouteMenuItem[]
  /**
   * Items merged into the active route sidebar right-click menu. The route
   * container decides whether those items are offered on the sidebar root, a
   * group title, or a concrete list item.
   */
  routeSidebarContextMenu?: PluginContributionRouteMenuItem[]
  /**
   * Icon actions rendered by the collapsed sidebar / window-bar chrome. The
   * host route controls visibility state; the chrome component owns rendering.
   */
  routeWindowBarActions?: PluginContributionRouteHeaderAction[]
  workbenchTabs?: PluginContributionWorkbenchTab[]
  workbenchAddMenu?: PluginContributionWorkbenchAddMenuItem[]
  workspaceDrawerTabs?: PluginContributionWorkspaceDrawerTab[]
  cliCommands?: PluginContributionCliCommand[]
  launcherSearchProviders?: PluginContributionLauncherSearchProvider[]
  /**
   * Declarative presentation metadata for tool-use rows in chat. The host owns
   * rendering and plugins provide only matching and display semantics.
   */
  toolUsePresentations?: PluginContributionToolUsePresentation[]
  routes?: PluginContributionRoute[]
}

export interface PluginApiDocumentation {
  desc?: PluginLocalizedText
  description?: PluginLocalizedText
  headerSchema?: ConfigJsonSchema
  inputSchema?: ConfigJsonSchema
  outputSchema?: ConfigJsonSchema
  title?: PluginLocalizedText
}

export interface PluginRuntimeApiRegistration {
  description?: PluginLocalizedText
  headerSchema?: ConfigJsonSchema
  id: string
  inputSchema?: ConfigJsonSchema
  mode: 'handler' | 'proxy'
  outputSchema?: ConfigJsonSchema
  proxyTarget?: string
  target: string
  title?: PluginLocalizedText
}

export interface PluginRuntimeCommandInvocation {
  commandId: string
  payload?: unknown
}

export type PluginRuntimeEndpointStatus = 'online' | 'offline' | 'unknown'

export interface PluginRuntimeEndpoint {
  current?: boolean
  id: string
  projectHome?: string
  role: PluginServerRuntimeRole
  serverBaseUrl?: string
  startedAt?: string
  status?: PluginRuntimeEndpointStatus
  workspaceFolder?: string
  workspaceId?: string
}

export interface PluginRuntimeChannelTarget {
  endpointId?: string
  role?: PluginServerRuntimeRole
  serverBaseUrl?: string
  workspaceId?: string
}

export interface PluginRuntimeChannelInvocation {
  payload?: unknown
  target?: PluginRuntimeChannelTarget
}

export interface PluginRuntimeChannelRequest {
  channelId: string
  payload?: unknown
  source: PluginRuntimeEndpoint
  target: PluginRuntimeEndpoint
}

export type PluginRuntimeChannelResponse =
  | { ok: true; payload?: unknown }
  | { ok: false; error: string }

export interface PluginManifestChildSourcePackage {
  type: 'package'
  id: string
}

export interface PluginManifestChildSourceDirectory {
  type: 'directory'
  path: string
}

export interface PluginManifestChildDefinition {
  source: PluginManifestChildSourcePackage | PluginManifestChildSourceDirectory
  activation: 'default' | 'optional'
  options?: Record<string, unknown>
}

/**
 * 插件包 root export 暴露的 manifest。
 *
 * manifest 只描述包内资产和 child plugin 元数据，不允许声明 `scope`。
 */
export interface PluginManifest {
  __oneWorksPluginManifest?: true
  name?: string
  displayName?: string
  displayNameI18n?: Record<string, string>
  description?: string
  descriptionI18n?: Record<string, string>
  /** Plugin-root-relative presentation icon. Absolute paths and parent traversal are rejected. */
  icon?: string
  version?: string
  assets?: PluginManifestAssets
  children?: Record<string, PluginManifestChildDefinition>
  config?: PluginConfigManifest
  configHook?: string | PluginConfigHookManifest
  plugin?: {
    client?: PluginClientManifest
    server?: PluginServerManifest
    contributions?: PluginContributionManifest
  }
}

export interface PluginRuntimeInstance {
  scope: string
  name?: string
  displayName?: string
  displayNameI18n?: Record<string, string>
  description?: string
  descriptionI18n?: Record<string, string>
  icon?: string
  requestedVersion?: string
  version?: string
  requestId: string
  packageId?: string
  sourceGroup?: PluginRuntimeSourceGroup
  watch?: {
    enabled: boolean
  }
  options?: Record<string, unknown>
  /**
   * @deprecated Use `pluginRoot` for runtime responses. `rootDir` remains for resolver metadata compatibility.
   */
  rootDir?: string
  pluginRoot?: string
  client?: PluginClientManifest & {
    clientEntryUrl?: string
    devClientEntryUrl?: string
  }
  clientEntryUrl?: string
  devClientEntryUrl?: string
  contributions?: PluginContributionManifest
  apis?: PluginRuntimeApiRegistration[]
  plugin?: {
    contributions?: PluginContributionManifest
  }
  diagnostics?: Array<{
    code?: string
    level: 'error' | 'warning' | 'info'
    message: string
    pluginRoot?: string
    scope?: string
  }>
  enabled?: boolean
  manifest?: PluginManifest
}

export type PluginMarketplaceConfigSource = 'global' | 'project' | 'user'
export type PluginMarketplaceInstallTarget = 'global' | 'project'

export type PluginMarketplacePluginSourceType =
  | 'github'
  | 'git-subdir'
  | 'npm'
  | 'path'
  | 'remote'
  | 'url'

export interface PluginMarketplaceCatalogPlugin {
  agents?: string[]
  builtIn?: boolean
  commands?: string[]
  configSource?: PluginMarketplaceConfigSource
  declared: boolean
  description?: string
  displayName?: string
  enabled: boolean
  featured?: boolean
  icon?: IconRef
  installable?: boolean
  marketplace: string
  marketplaceEnabled: boolean
  marketplaceTitle?: string
  marketplaceType: MarketplaceConfigEntry['type']
  name: string
  nativeEnabled?: boolean
  nativeInstalled?: boolean
  installedSources?: PluginMarketplaceConfigSource[]
  skills?: string[]
  sourceLabel: string
  sourceType: PluginMarketplacePluginSourceType
  version?: string
}

export interface PluginMarketplaceCatalogSource {
  builtIn?: boolean
  configSource?: PluginMarketplaceConfigSource
  entry: MarketplaceConfigEntry
  enabled: boolean
  error?: string
  key: string
  pluginCount: number
  title?: string
  type: string
}

export interface PluginMarketplaceCatalogResponse {
  plugins: PluginMarketplaceCatalogPlugin[]
  sources: PluginMarketplaceCatalogSource[]
  versionGeneration: string
}

export type PluginDetailAssetKind = 'entities' | 'hooks' | 'mcp' | 'rules' | 'skills' | 'specs'

export interface PluginReadmeVariant {
  content: string
  language?: string
  path: string
}

export interface PluginDetailAssetFile {
  content?: string
  contentKind: 'binary' | 'markdown' | 'text'
  path: string
  size: number
  truncated?: boolean
}

export interface PluginDetailAssetGroup {
  files: PluginDetailAssetFile[]
  kind: PluginDetailAssetKind
}

export type ManagedPluginAdapter = 'claude' | 'codex' | 'opencode' | (string & {})

export interface ManagedPluginNpmSource {
  type: 'npm'
  spec: string
  registry?: string
}

export interface ManagedPluginGithubSource {
  type: 'github'
  repo: string
  ref?: string
  sha?: string
}

export interface ManagedPluginGitSource {
  type: 'git'
  url: string
  ref?: string
  sha?: string
}

export interface ManagedPluginGitSubdirSource {
  type: 'git-subdir'
  url: string
  path: string
  ref?: string
  sha?: string
}

export interface ManagedPluginPathSource {
  type: 'path'
  path: string
}

export interface ManagedPluginMarketplaceSource {
  type: 'marketplace'
  marketplace: string
  plugin: string
}

export type ManagedPluginSource =
  | ManagedPluginNpmSource
  | ManagedPluginGithubSource
  | ManagedPluginGitSource
  | ManagedPluginPathSource
  | ManagedPluginGitSubdirSource
  | ManagedPluginMarketplaceSource

export interface ManagedPluginInstallConfig {
  version: 1
  adapter: ManagedPluginAdapter
  name: string
  scope?: string
  installedAt: string
  source: ManagedPluginSource
  nativePluginPath: string
  oneworksPluginPath: string
}

export type PluginResolutionStrategy =
  | 'direct'
  | 'oneworks-prefix'
  | 'vibe-forge-prefix'
  | 'managed-package-cache'
  | 'manifest-package'
  | 'manifest-directory'
  | 'directory-fallback'

export interface ResolvedPluginInstanceMetadata {
  requestId: string
  packageId?: string
  sourceType: 'package' | 'directory'
  rootDir: string
  scope?: string
  watch?: boolean
  options: Record<string, unknown>
  instancePath: string
  resolvedBy: PluginResolutionStrategy
  overlaySource?: string
  children: ResolvedPluginInstanceMetadata[]
}

export const definePluginManifest = (
  manifest: Omit<PluginManifest, '__oneWorksPluginManifest'>
): PluginManifest => ({
  ...manifest,
  __oneWorksPluginManifest: true
})
