/* eslint-disable max-lines -- relay client types mirror account status, config sharing, and source controls. */
import type { RelayClientI18nHost } from './i18n.js'

export interface Disposable {
  dispose: () => void
}

export type PluginReactNode = unknown

export type PluginServerRuntimeRole = 'manager' | 'workspace'

export interface PluginRuntimeEndpoint {
  current?: boolean
  id: string
  projectHome?: string
  role: PluginServerRuntimeRole
  serverBaseUrl?: string
  startedAt?: string
  status?: 'offline' | 'online' | 'unknown'
  workspaceFolder?: string
  workspaceId?: string
}

export interface PluginRuntimeChannelInvocation {
  payload?: unknown
  target?: {
    endpointId?: string
    role?: PluginServerRuntimeRole
    serverBaseUrl?: string
    workspaceId?: string
  }
}

export interface PluginReactHost {
  Fragment: unknown
  createElement: (
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ) => PluginReactNode
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void
  useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T
  useRef: <T>(initialValue: T) => { current: T }
  useState: <T>(
    initialValue: T | (() => T)
  ) => [T, (nextValue: T | ((current: T) => T)) => void]
}

export type PluginViewRenderer = (
  container: HTMLElement,
  view?: PluginViewContext
) => Disposable | void

export interface PluginViewRegistration {
  render?: PluginViewRenderer
  renderNode?: (view?: PluginViewContext) => PluginReactNode
}

export interface PluginClientContext {
  react: PluginReactHost
  scope: string
  api: {
    fetch: (path: string, init?: RequestInit) => Promise<Response>
  }
  commands: {
    register: (commandId: string, handler: (payload?: unknown) => unknown | Promise<unknown>) => Disposable
  }
  i18n?: RelayClientI18nHost & {
    subscribe?: (listener: () => void) => Disposable
  }
  notifications?: {
    show?: (input: {
      description?: string
      level?: 'error' | 'info' | 'success' | 'warning'
      title: string
    }) => { close?: () => void; id?: string } | void
  }
  options?: Record<string, unknown>
  runtime?: {
    endpoint?: PluginRuntimeEndpoint
    invokeChannel?: (channelId: string, invocation?: PluginRuntimeChannelInvocation) => Promise<unknown>
    listEndpoints?: () => Promise<PluginRuntimeEndpoint[]>
  }
  slots?: {
    register: (slot: string, contribution: Record<string, unknown> & { id: string }) => Disposable
  }
  views: {
    register: (
      viewId: string,
      render: PluginViewRenderer | PluginViewRegistration
    ) => Disposable
  }
}

export interface PluginViewContext {
  components?: {
    render: <T extends PluginHostComponentId>(
      component: T,
      container: HTMLElement,
      props: PluginHostComponentPropsById[T]
    ) => Disposable
  }
  options?: {
    update?: (
      options: Record<string, unknown>,
      target?: 'workspace' | 'global'
    ) => Promise<Record<string, unknown>>
    value?: Record<string, unknown>
  }
  host?: {
    isDarkMode?: boolean
    language?: string
    launcherSearch?: {
      value?: string
    }
    resolvedThemeMode?: 'dark' | 'light'
    surface?: 'drawer' | 'launcher' | 'route' | 'workbench'
    themeMode?: 'dark' | 'light' | 'system'
  }
  runtime?: {
    endpoint?: PluginRuntimeEndpoint
    invokeChannel?: (channelId: string, invocation?: PluginRuntimeChannelInvocation) => Promise<unknown>
    listEndpoints?: () => Promise<PluginRuntimeEndpoint[]>
  }
  route?: {
    setActions?: (actions?: PluginViewRouteHeaderAction[]) => void
    setBreadcrumb?: (breadcrumb?: PluginViewRouteHeaderBreadcrumb) => void
    setLauncherChrome?: (chrome?: PluginViewRouteLauncherChrome) => void
    setTitle?: (title?: string) => void
  }
  scope?: string
  ui?: {
    Button?: unknown
    CodeEditor?: unknown
    Icon?: unknown
    Input?: unknown
    InteractionList?: unknown
    NativeTabs?: unknown
    SearchInput?: unknown
    Select?: unknown
  }
}

export interface PluginHostControlOption {
  disabled?: boolean
  icon?: string
  label?: string
  value: string
}

export interface PluginHostInputComponentProps {
  allowClear?: boolean
  ariaLabel?: string
  autoFocus?: boolean
  disabled?: boolean
  onChange?: (value: string) => void
  onCommit?: (value: string) => void
  placeholder?: string
  rows?: number
  size?: 'large' | 'middle' | 'small'
  type?: 'password' | 'textarea' | 'text'
  value?: string
}

export interface PluginHostSearchInputComponentProps {
  allowClear?: boolean
  ariaLabel?: string
  autoFocus?: boolean
  className?: string
  defaultValue?: string
  disabled?: boolean
  onChange?: (value: string) => void
  onCommit?: (value: string) => void
  placeholder?: string
  suffix?: PluginReactNode
  value?: string
}

export interface PluginHostCodeEditorComponentProps {
  ariaLabel?: string
  className?: string
  language?: string
  onChange?: (value: string) => void
  path?: string
  readOnly?: boolean
  value: string
}

export interface PluginHostSelectComponentProps {
  allowClear?: boolean
  ariaLabel?: string
  disabled?: boolean
  mode?: 'multiple'
  onChange?: (value: string | string[]) => void
  options: PluginHostControlOption[]
  placeholder?: string
  size?: 'large' | 'middle' | 'small'
  value?: string | string[]
}

export interface PluginHostComponentPropsById {
  codeEditor: PluginHostCodeEditorComponentProps
  input: PluginHostInputComponentProps
  interactionList: PluginHostInteractionListComponentProps
  nativeTabs: PluginHostNativeTabsComponentProps
  searchInput: PluginHostSearchInputComponentProps
  select: PluginHostSelectComponentProps
}

export type PluginHostComponentId = keyof PluginHostComponentPropsById

export interface PluginHostInteractionListAvatar {
  alt?: string
  fallback?: string
  src?: string
}

export interface PluginHostInteractionListItem {
  avatar?: PluginHostInteractionListAvatar
  children?: PluginHostInteractionListItem[]
  description?: string
  disabled?: boolean
  icon?: string | {
    alt?: string
    src: string
    type: 'image'
  }
  iconFilled?: boolean
  iconState?: 'offline' | 'online' | 'stale' | 'unknown'
  itemType?: 'groupTitle' | 'listItem'
  key: string
  meta?: string
  searchText?: string
  tags?: string[]
  title: string
  tooltip?: string
}

export interface PluginHostInteractionListAction<
  TItem extends PluginHostInteractionListItem = PluginHostInteractionListItem,
> {
  confirmLabel?: string
  danger?: boolean
  disabled?: boolean
  icon: string
  key: string
  label: string
  onSelect?: (item: TItem) => void | Promise<void>
  type?: 'divider'
}

export interface PluginHostInteractionListComponentProps<
  TItem extends PluginHostInteractionListItem = PluginHostInteractionListItem,
> {
  actionDisplay?: 'inline' | 'menu'
  actions?: (item: TItem) => Array<PluginHostInteractionListAction<TItem>>
  activeKey?: string
  border?: 'bordered' | 'borderless'
  className?: string
  descriptionPlacement?: 'content' | 'titleHover'
  emptyText: string
  iconSize?: number | string
  inlineActionLimit?: number
  items: TItem[]
  mode?: 'grouped' | 'launcher' | 'resource'
  padding?: 'default' | 'none'
  search?: {
    defaultValue?: string
    filterItems?: boolean
    placeholder: string
    renderInput?: boolean
    suffix?: PluginReactNode
    value?: string
    onChange?: (value: string) => void
  }
  showItemDescription?: boolean
  splitActionHover?: boolean
  onSelect?: (item: TItem) => void
}

export interface PluginHostNativeTabItem {
  disabled?: boolean
  icon?: string
  key: string
  label: PluginReactNode
}

export interface PluginHostNativeTabsComponentProps {
  activeKey?: string
  actions?: PluginReactNode
  ariaLabel?: string
  className?: string
  iconSize?: number | string
  items: PluginHostNativeTabItem[]
  onChange?: (key: string, item: PluginHostNativeTabItem) => void
}

export interface PluginViewRouteHeaderAction {
  icon: string
  key: string
  label: string
  active?: boolean
  activeIcon?: string
  activeLabel?: string
  activeTitle?: string
  danger?: boolean
  disabled?: boolean
  loading?: boolean
  shortcut?: string
  title?: string
  onSelect?: () => void
}

export interface PluginViewRouteHeaderBreadcrumb {
  onBack: () => void
  ancestors?: Array<{
    title: string
    onSelect?: () => void
  }>
  parentTitle: string
  ariaLabel?: string
  backLabel?: string
  currentTitle?: string
}

export interface PluginViewRouteLauncherChrome {
  avatarInitials?: string
  avatarUrl?: string
  icon?: string
  searchTitle?: string
  title?: string
}

export interface RelayStatus {
  accounts?: RelayAuthAccount[]
  configDistribution?: RelayConfigDistributionStatus
  configSync?: RelayConfigDistributionStatus
  connection?: {
    activeServerId?: string
    remoteBaseUrl?: string
    state?: string
  }
  device?: {
    hasToken?: boolean
    id?: string
    name?: string
  }
  options?: {
    deviceName?: string
    officialServices?: {
      cloudflare?: boolean
      vercel?: boolean
    }
    servers?: RelayServerStatus[]
  }
  personalDocumentSync?: RelayPersonalDocumentSyncStatus
  projectRuleDocumentSync?: Record<string, RelayPersonalDocumentSyncStatus>
  servers?: RelayServerStatus[]
  teamDocumentSync?: Record<string, RelayPersonalDocumentSyncStatus>
  [key: string]: unknown
}

export interface RelayAuthAccount {
  accountKey?: string
  avatarUrl?: string
  email?: string
  enabled?: boolean
  loginId?: string
  name?: string
  registeredAt?: string
  role?: string
  serverAlias?: string
  serverId?: string
  serverUrl?: string
  sessionAuthenticated?: boolean
  sessionExpiresAt?: string
  updatedAt?: string
  userId?: string
}

export interface RelayConfigDistributionStatus {
  allowedFields?: string[]
  hash?: string | null
  lastAppliedAt?: string | null
  lastError?: string | null
  lastSyncedAt?: string | null
  marketplaceKeys?: string[]
  matchedProject?: boolean | string | null
  modelServiceKeys?: string[]
  pluginKeys?: string[]
  skillKeys?: string[]
  skillRegistryKeys?: string[]
  sourceServerId?: string | null
  sources?: RelayConfigDistributionSourceStatus[]
  version?: string | null
}

export interface RelayConfigDistributionSourceStatus {
  assignmentId?: string
  disabledBy?: Array<'assignment' | 'profile' | 'team'>
  enabled?: boolean
  fields?: string[]
  mode?: 'default' | 'override'
  profileId?: string
  profileName?: string
  teamId?: string
  teamName?: string
  version?: number
  versionId?: string
}

export type RelayPersonalDocumentSyncKind = 'agents' | 'ooAgents' | 'ooRules'

export interface RelayPersonalDocumentSyncPreferences {
  agents?: boolean
  ooAgents?: boolean
  ooRules?: boolean
}

export interface RelayPersonalDocumentSyncCounts {
  agents?: number
  ooAgents?: number
  ooRules?: number
}

export interface RelayPersonalDocumentSyncStatus {
  appliedRemote?: boolean
  conflictBackups?: number
  countsByKind?: RelayPersonalDocumentSyncCounts
  documentCount?: number
  enabled?: boolean
  entries?: RelayPersonalDocumentEntry[]
  hash?: string | null
  lastError?: string | null
  lastSyncedAt?: string | null
  preferences?: RelayPersonalDocumentSyncPreferences
  pushedLocal?: boolean
  totalSizeBytes?: number
}

export interface RelayPersonalDocumentEntry {
  displayName: string
  exists: boolean
  kind: RelayPersonalDocumentSyncKind
  localOnly: boolean
  path: string
  relativePath: string
}

export interface RelayDocumentContent {
  content: string
  displayPath: string
  path: string
  sizeBytes?: number
  updatedAt?: string
}

export interface RelayServerStatus {
  account?: {
    avatarUrl?: string
    email?: string
    name?: string
  }
  accountAvatarUrl?: string
  accountEmail?: string
  accountName?: string
  active?: boolean
  connected?: boolean
  connection?: {
    activeServerId?: string
    lastConnectedAt?: string | null
    lastError?: string | null
    message?: string
    remoteBaseUrl?: string
    state?: string
  }
  devices?: RelayDeviceSummary[]
  devicesError?: string
  hasToken?: boolean
  id?: string
  name?: string
  official?: boolean
  platform?: string
  port?: number
  protocol?: string
  registeredAt?: string | null
  remoteBaseUrl?: string
  server?: string
  sessionAuthenticated?: boolean
  sessionExpiresAt?: string | null
}

export interface RelayDeviceSummary {
  alias?: string
  capabilities?: Record<string, unknown>
  createdAt?: string
  deviceInfo?: RelayDeviceEnvironmentSummary
  id?: string
  isCurrentClientDevice?: boolean
  ip?: string
  lastSeenAt?: string
  lastSeenIp?: string
  managementServers?: RelayDeviceManagementServerSummary[]
  name?: string
  pluginScope?: string
  registeredIp?: string
  status?: string
  workspaceFolder?: string
}

export interface RelayDeviceEnvironmentSummary {
  arch?: string
  deviceType?: string
  osName?: string
  osPlatform?: string
  osRelease?: string
  osType?: string
  osVersion?: string
  runtime?: string
  runtimeVersion?: string
}

export interface RelayDeviceProjectSummary {
  createdAt?: string
  id?: string
  lastSeenAt?: string
  name?: string
  status?: string
  title?: string
  workspaceFolder?: string
}

export interface RelayDeviceManagementServerSummary {
  createdAt?: string
  environment?: RelayDeviceEnvironmentSummary
  id?: string
  ip?: string
  kind?: string
  lastSeenAt?: string
  lastSeenIp?: string
  name?: string
  pluginScope?: string
  projects?: RelayDeviceProjectSummary[]
  registeredIp?: string
  status?: string
  workspaceFolder?: string
}

export interface RelayProfileCurrentUser {
  avatarUrl?: string | null
  disabledAt?: string | null
  email?: string
  groupIds?: string[]
  id?: string
  loginId?: string | null
  name?: string
  provider?: string | null
  role?: string
}

export interface RelayProfileAccessToken {
  createdAt?: string
  id?: string
  lastUsedAt?: string | null
  name?: string
  permissionGroupIds?: string[]
  permissionGroupMode?: 'all' | 'custom'
  revokedAt?: string | null
  scope?: 'platform' | 'team' | 'user'
  teamId?: string | null
  tokenPreview?: string
}

export interface RelayProfileSecuritySummary {
  accessTokens?: RelayProfileAccessToken[]
  accountDeletion?: {
    available?: boolean
  }
  password?: {
    enabled?: boolean
  }
  passkeys?: {
    count?: number
    enabled?: boolean
    lastUsedAt?: string | null
  }
  twoFactor?: {
    available?: boolean
    enabled?: boolean
  }
}

export interface RelayProfileOpenApiAuditEvent {
  createdAt?: string
  error?: string | null
  id?: string
  ip?: string | null
  method?: string
  path?: string
  permission?: string | null
  status?: number
  tokenId?: string
  tokenPreview?: string
  userAgent?: string | null
  userId?: string
}

export type RelayProfileMessageKind = 'announcement' | 'personal' | 'system'
export type RelayProfileMessageAudienceScope = 'all' | 'team' | 'users'

export interface RelayProfileMessageUser {
  avatarUrl?: string | null
  email?: string
  id?: string
  name?: string
  provider?: string | null
  role?: string
}

export interface RelayProfileMessageTeam {
  avatarUrl?: string | null
  id?: string
  name?: string
  slug?: string
}

export interface RelayProfileMessageAudience {
  scope?: RelayProfileMessageAudienceScope
  team?: RelayProfileMessageTeam | null
  teamId?: string | null
  userIds?: string[]
  users?: Array<RelayProfileMessageUser | null>
}

export interface RelayProfileMessage {
  audience?: RelayProfileMessageAudience
  body?: string
  createdAt?: string
  createdBy?: RelayProfileMessageUser | null
  createdByUserId?: string
  id?: string
  kind?: RelayProfileMessageKind
  title?: string
  updatedAt?: string | null
}

export interface RelayProfileTeamInvitation {
  configEnabled?: boolean
  createdAt?: string
  createdByUserId?: string
  defaultForPublishing?: boolean
  email?: string | null
  groupIds?: string[]
  id?: string
  inviter?: RelayProfileMessageUser | null
  respondedAt?: string | null
  role?: string
  status?: string
  teamAvatarUrl?: string | null
  teamId?: string
  teamName?: string | null
  teamSlug?: string | null
  updatedAt?: string | null
  user?: RelayProfileMessageUser | null
  userId?: string | null
}

export interface RelayProfileTeam {
  archivedAt?: string | null
  avatarUrl?: string | null
  configEnabled?: boolean
  defaultForPublishing?: boolean
  description?: string | null
  id?: string
  memberCount?: number
  membership?: {
    configEnabled?: boolean
    defaultForPublishing?: boolean
    groupIds?: string[]
    role?: string
  } | null
  name?: string
  role?: string
  slug?: string
  updatedAt?: string | null
}

export interface RelayProfileStatus {
  account?: RelayAuthAccount
  accounts?: RelayAuthAccount[]
  auditEvents?: RelayProfileOpenApiAuditEvent[]
  candidates?: RelayAuthAccount[]
  devices?: RelayDeviceSummary[]
  errors?: Partial<Record<'audit' | 'devices' | 'messages' | 'profile' | 'security' | 'teams', string>>
  invitations?: RelayProfileTeamInvitation[]
  message?: string
  messages?: RelayProfileMessage[]
  ok?: boolean
  result?: {
    accessToken?: string
    token?: RelayProfileAccessToken
    [key: string]: unknown
  }
  security?: RelayProfileSecuritySummary
  session?: {
    expiresAt?: string
    lastSeenAt?: string
  }
  teams?: RelayProfileTeam[]
  user?: RelayProfileCurrentUser
}

export type RelayProfileTab = 'account' | 'devices' | 'documents' | 'security' | 'teams' | 'tokens'
export type RelayProfileTeamDetailTab = 'configs' | 'documents' | 'overview' | 'projects'
export type RelayProfilePage = 'accounts' | 'login' | 'messages' | 'profile' | 'servers'

export interface RelayProfileViewState {
  accountKey: string
  accountFilter: string
  actionError: string | null
  createdAccessToken: string | null
  currentPassword: string
  data: RelayProfileStatus | null
  deviceAliasDraft: string
  deviceAliasEditingId: string
  deleteConfirmOpen: boolean
  deleteConfirmValue: string
  error: string | null
  localDeleteConfirmAccountKey: string
  loginServerKey: string
  loginUrl: string
  loginUrlError: string | null
  loginUrlLoading: boolean
  loading: boolean
  passwordEditorOpen: boolean
  newPassword: string
  page: RelayProfilePage
  tab: RelayProfileTab
  teamDetailTab: RelayProfileTeamDetailTab
  teamItemId: string | null
  tokenFilter: string
  tokenItemId: string | null
  tokenName: string
  tokenPermissionGroupIds: string[]
  tokenPermissionGroupMode: 'all' | 'custom'
  tokenScope: 'platform' | 'team' | 'user'
  tokenTeamId: string
}

export interface RelayViewState {
  error: string | null
  loading: boolean
  status: RelayStatus | null
}

export interface RelayConfigShareDraft {
  allowedFields?: string[]
  configPatch?: Record<string, unknown>
  fieldSummaries?: Array<{
    field?: string
    itemCount?: number
    secretCount?: number
  }>
  issues?: Array<{
    code?: string
    message?: string
    path?: string
    severity?: string
  }>
  rejectedFields?: string[]
  secretItems?: Array<{
    displayName?: string
    path?: string
    ref?: string
  }>
}

export interface RelayConfigShareProfileVersion {
  allowedFields?: string[]
  changeNote?: string | null
  configPatch?: Record<string, unknown>
  createdAt?: string
  createdByUserId?: string
  id?: string
  profileId?: string
  secretRefs?: Record<string, string>
  sourceHash?: string
  version?: number
}

export interface RelayConfigProjectRule {
  allow?: string[]
  deny?: string[]
}

export interface RelayConfigTarget {
  teamIds?: string[]
  userIds?: string[]
}

export interface RelayConfigShareProfileAssignment {
  createdAt?: string
  enabled?: boolean
  id?: string
  mode?: 'default' | 'override'
  priority?: number
  profileId?: string
  project?: RelayConfigProjectRule | null
  target?: RelayConfigTarget | null
  updatedAt?: string | null
  versionId?: string | null
}

export interface RelayConfigShareProfile {
  activeVersionId?: string | null
  assignmentCount?: number
  createdAt?: string
  createdByUserId?: string
  description?: string | null
  id?: string
  name?: string
  status?: string
  teamId?: string
  teamName?: string
  updatedAt?: string
  updatedByUserId?: string
  versionCount?: number
}

export interface RelayConfigShareProfileDetail {
  assignments?: RelayConfigShareProfileAssignment[]
  profile?: RelayConfigShareProfile
  versions?: RelayConfigShareProfileVersion[]
}

export interface RelayConfigShareTargets {
  profilesByTeamId?: Record<string, RelayConfigShareProfile[]>
  teams?: Array<{
    id?: string
    membership?: {
      role?: string
    } | null
    name?: string
    slug?: string
  }>
}

export interface RelayConfigShareViewState {
  draft: RelayConfigShareDraft | null
  error: string | null
  loading: boolean
  profileName: string
  publishing: boolean
  targets: RelayConfigShareTargets | null
  teamId: string
  text: string
}

export interface RelayLoginCallback {
  serverId?: string
  token: string
}

export type RelayLoginMethod = 'passkey' | 'password' | 'verification_code'

export interface RelayLoginOptionsMessages {
  confirmPasswordPlaceholder: string
  confirmPasswordRequired: string
  continueWithRegistration: string
  emailPlaceholder: string
  invalidCredentials: string
  inviteCodePlaceholder: string
  inviteRequired: string
  passkeyCodePlaceholder: string
  passkeySendCode: string
  passkeyTitle: string
  passwordMinLength: string
  passwordMismatch: string
  passwordPlaceholder: string
  recentAccounts: string
  rememberAccount: string
  signInMode: string
  signInWithPassword: string
  signInWithSso: string
  signingIn: string
  useLoginMethodPasskey: string
  useLoginMethodPassword: string
  useLoginMethodVerificationCode: string
  verificationCodeSignIn: string
}

export interface RelayLoginProviderOption {
  displayName?: string
  icon?: string
  id: string
  label: string
  startUrl: string
}

export interface RelayLoginOptions {
  emailCodeLoginUrl: string
  emailVerificationSendUrl: string
  inviteLoginUrl: string
  locale: 'en' | 'zh-CN'
  loginMethods: {
    default: RelayLoginMethod
    enabled: RelayLoginMethod[]
  }
  messages: RelayLoginOptionsMessages
  passwordLoginUrl: string
  providers: RelayLoginProviderOption[]
  redirectUri: string
}

export interface RelayLoginUrlResponse {
  loginUrl?: string
  redirectUri?: string
  remoteBaseUrl?: string
  serverId?: string
}
