/* eslint-disable max-lines -- relay home owns the account, server, token, and team pages so the plugin no longer falls back to legacy string rendering. */
import { adminListSurfaceClassNames } from '@oneworks/components/admin-list-surface'

import {
  normalizeRelayGitRepositoryIdentity,
  relayGitRepositoryIdentitiesEqual
} from '../shared/config-assignment-project.js'
import { relayProjectRuleDocumentDisplayPath } from '../shared/document-paths.js'
import {
  LOCAL_RELAY_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_DEV_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID,
  OFFICIAL_RELAY_VERCEL_DEV_SERVER_ID,
  OFFICIAL_RELAY_VERCEL_SERVER_ID
} from '../shared/official-services.js'
import { createSerializedSaveQueue } from './debounced-save-queue.js'
import {
  RelayLoginOptionsUnavailableError,
  RelayLoginRequestError,
  createRelayLoginOptions,
  postRelayLoginJson
} from './login-action.js'
import { clearLoginCallbackFromUrl, readLoginCallback, readLoginCallbackFromUrl } from './login-callback.js'
import { buildRelayServerOptionsUpdate } from './options.js'
import type {
  PluginClientContext,
  PluginHostInteractionListAction,
  PluginHostInteractionListItem,
  PluginHostNativeTabItem,
  PluginReactHost,
  PluginReactNode,
  PluginViewContext,
  PluginViewRouteHeaderAction,
  RelayAuthAccount,
  RelayConfigDistributionSourceStatus,
  RelayConfigDistributionStatus,
  RelayConfigProjectRule,
  RelayConfigShareDraft,
  RelayConfigShareProfile,
  RelayConfigShareProfileAssignment,
  RelayConfigShareProfileDetail,
  RelayConfigShareTargets,
  RelayDeviceSummary,
  RelayDocumentContent,
  RelayLoginCallback,
  RelayLoginMethod,
  RelayLoginProviderOption,
  RelayPersonalDocumentEntry,
  RelayPersonalDocumentSyncKind,
  RelayProfileAccessToken,
  RelayProfileStatus,
  RelayProfileTab,
  RelayProfileTeam,
  RelayProfileTeamDetailTab,
  RelayServerStatus,
  RelayStatus
} from './types.js'
import {
  cleanText,
  cleanTextList,
  formatDateTime,
  getAvatarInitials,
  isRecord,
  normalizeComparableUrl,
  toErrorMessage,
  valueOrDash
} from './utils.js'

type RelayHomeRoute =
  | { page: 'accounts' }
  | { page: 'servers' }
  | { page: 'login'; serverId?: string }
  | { accountKey: string; deviceId: string; page: 'device'; tab: RelayDeviceDetailTab }
  | { accountKey: string; page: 'messages' }
  | { accountKey: string; page: 'profile'; tab: RelayProfileTab }
  | {
    accountKey: string
    configPanel?: 'content' | 'versions'
    configProfileId?: string
    page: 'team'
    projectRuleId?: string
    tab: RelayProfileTeamDetailTab
    teamId: string
  }
  | { accountKey: string; page: 'token'; tokenId: string }

interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

interface ShareState {
  draft: RelayConfigShareDraft | null
  error: string | null
  loadingTargets: boolean
  previewing: boolean
  profileName: string
  publishing: boolean
  targets: RelayConfigShareTargets | null
  text: string
}

interface ServerDraft {
  id?: string
  name: string
  remoteBaseUrl: string
}

interface RelayAccountInteractionItem extends PluginHostInteractionListItem {
  account?: RelayAuthAccount
  accountKey?: string
  kind: 'account' | 'server'
  server?: RelayServerStatus
  serverId?: string
}

interface RelayTeamConfigInteractionItem extends PluginHostInteractionListItem {
  kind: 'teamConfigProfile'
  profile: RelayConfigShareProfile
  source?: RelayConfigDistributionSourceStatus
}

interface RelayTeamProjectInteractionItem extends PluginHostInteractionListItem {
  kind: 'projectRule'
  profile?: RelayConfigShareProfile
  ruleId: string
  source?: RelayConfigDistributionSourceStatus
}

interface RelayProjectRuleRepositoryRow {
  assignment: RelayConfigShareProfileAssignment
  assignmentIndex: number
  key: string
  meta: string
  repositoryCount: number
  repositoryIndex: number
  searchText: string
  title: string
  value: string
}

interface RelayProjectRuleRepositoryEditState {
  added: boolean
  key: string
  originalValue: string
}

interface RelayDeviceInteractionItem extends PluginHostInteractionListItem {
  device: RelayDeviceSummary
  deviceId: string
  kind: 'device'
}

interface RelayDeviceLoginInteractionItem extends PluginHostInteractionListItem {
  kind: 'loginRecord'
}

interface RelayDeviceProjectInteractionItem extends PluginHostInteractionListItem {
  group?: RelayDeviceProjectGroup
  kind: 'managementServer' | 'project'
  path?: string
  project?: RelayDeviceProjectRow
}

interface RelayTeamInteractionItem extends PluginHostInteractionListItem {
  kind: 'team'
  team: RelayProfileTeam
  teamId: string
}

interface RelayDocumentInteractionItem extends PluginHostInteractionListItem {
  documentSyncKind: RelayPersonalDocumentSyncKind
  displayPath: string
  enabled: boolean
  exists: boolean
  kind: 'accountAgents' | 'namespaceDocument' | 'teamAgents' | 'userAgents' | 'userOoAgents' | 'userOoRules'
  localOnly: boolean
  path: string
  relativePath: string
}

interface TokenEditorState {
  name: string
  permissionGroupIds: string
  permissionGroupMode: 'all' | 'custom'
  scope: 'platform' | 'team' | 'user'
  teamId: string
}

const DOCUMENT_PREVIEW_CLOSE_ANIMATION_MS = 260
const projectRuleAssignmentSaveQueue = createSerializedSaveQueue()
const projectRuleAssignmentSaveKey = (
  accountKey: string,
  teamId: string | undefined,
  profileId: string | undefined,
  assignmentId: string
) => [accountKey, teamId ?? '', profileId ?? '', assignmentId].join('\0')
const projectRuleProfileSaveKeyPrefix = (
  accountKey: string,
  teamId: string | undefined,
  profileId: string | undefined
) => `${[accountKey, teamId ?? '', profileId ?? ''].join('\0')}\0`

type RelayDeviceDetailTab = 'logins' | 'profile' | 'projects'

type RelayProjectRuleDetailTab = 'documents' | 'overview' | 'rules' | 'settings'

const profileTabs: Array<{ icon: string; key: RelayProfileTab; label: string }> = [
  { icon: 'badge', key: 'account', label: '资料' },
  { icon: 'groups', key: 'teams', label: '团队' },
  { icon: 'sync', key: 'documents', label: '文档' },
  { icon: 'devices', key: 'devices', label: '设备' },
  { icon: 'shield_lock', key: 'security', label: '安全' },
  { icon: 'key', key: 'tokens', label: '令牌' }
]

const teamDetailTabs: Array<{ icon: string; key: RelayProfileTeamDetailTab; label: string }> = [
  { icon: 'groups', key: 'overview', label: '概览' },
  { icon: 'folder_open', key: 'projects', label: '项目' },
  { icon: 'rule_settings', key: 'configs', label: '配置' },
  { icon: 'sync', key: 'documents', label: '文档' }
]

const projectRuleDetailTabs: Array<{ icon: string; key: RelayProjectRuleDetailTab; label: string }> = [
  { icon: 'account_tree', key: 'rules', label: '匹配规则' },
  { icon: 'tune', key: 'settings', label: '应用设置' },
  { icon: 'description', key: 'documents', label: '文档' },
  { icon: 'info', key: 'overview', label: '概览' }
]

const deviceDetailTabs: Array<{ icon: string; key: RelayDeviceDetailTab; label: string }> = [
  { icon: 'badge', key: 'profile', label: '资料' },
  { icon: 'folder_open', key: 'projects', label: '项目列表' },
  { icon: 'history', key: 'logins', label: '登陆记录' }
]

const profileTabLabel = (key: RelayProfileTab) => (
  profileTabs.find(item => item.key === key)?.label ?? '账号详情'
)

const teamDetailTabLabel = (
  key: RelayProfileTeamDetailTab,
  panel?: 'content' | 'versions'
) => {
  if (key === 'configs' && panel === 'content') {
    return '配置内容'
  }
  if (key === 'configs' && panel === 'versions') {
    return '版本列表'
  }
  return teamDetailTabs.find(item => item.key === key)?.label ?? '团队详情'
}

const projectRuleTitleFromId = (value: string | null | undefined) => {
  const text = cleanText(value)
  if (text == null) return '规则详情'
  const segment = text.replace(/:assignment$/u, '').split(':').filter(Boolean).at(-1) ?? text
  const title = segment
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
  return `${title || text} 项目规则`
}

const deviceDetailTabLabel = (key: RelayDeviceDetailTab) => (
  deviceDetailTabs.find(item => item.key === key)?.label ?? '设备详情'
)

const documentScopeSegment = (value: string | null | undefined, fallback: string) => (
  (cleanText(value) ?? fallback).replace(/[\\/]/gu, '_')
)

const accountAgentsPath = (_account: RelayAuthAccount | null) => '~/AGENTS.md'

const accountOoAgentsPath = () => '~/.oo/AGENTS.md'

const accountOoRulesPath = () => '~/.oo/rules/**/*.md'

const teamAgentsPath = (team: RelayProfileTeam) => (
  `${teamDocumentBasePath(team)}/AGENTS.md`
)

const teamDocumentBasePath = (team: RelayProfileTeam) => (
  `~/.oo/teams/${documentScopeSegment(team.id, '<team-id>')}`
)

const projectRuleAgentsPath = (teamId: string, assignmentId: string) => (
  `${relayProjectRuleDocumentDisplayPath(teamId, assignmentId)}/AGENTS.md`
)

const documentPayloadPath = (path: string) => path.replace(/^~\//u, '')

const documentFullDisplayPath = (path: string) => {
  const payloadPath = documentPayloadPath(path)
  return payloadPath.startsWith('~') ? payloadPath : `~/${payloadPath}`
}

const documentFileName = (path: string) => {
  const segments = path.split('/').filter(Boolean)
  return segments.at(-1) ?? path
}

const PERSONAL_DOCUMENT_SYNC_KINDS: RelayPersonalDocumentSyncKind[] = ['agents', 'ooAgents', 'ooRules']

const personalDocumentKindLabel = (kind: RelayPersonalDocumentSyncKind) => {
  if (kind === 'agents') return '根 AGENTS.md'
  if (kind === 'ooAgents') return '.oo/AGENTS.md'
  return '.oo/rules'
}

const personalDocumentKindPathLabel = (kind: RelayPersonalDocumentSyncKind, account: RelayAuthAccount | null) => {
  if (kind === 'agents') return accountAgentsPath(account)
  if (kind === 'ooAgents') return accountOoAgentsPath()
  return accountOoRulesPath()
}

const personalDocumentSyncEnabled = (sync?: RelayStatus['personalDocumentSync']) => (
  PERSONAL_DOCUMENT_SYNC_KINDS.some(kind => sync?.preferences?.[kind] === true)
)

const personalDocumentSyncFullyEnabled = (sync?: RelayStatus['personalDocumentSync']) => (
  PERSONAL_DOCUMENT_SYNC_KINDS.every(kind => sync?.preferences?.[kind] === true)
)

const readDocumentPanelQueryValue = (key: 'doc' | 'q') => {
  if (typeof window === 'undefined') return ''
  try {
    return new URLSearchParams(window.location.search).get(key)?.trim() ?? ''
  } catch {
    return ''
  }
}

const initialProjectRuleDetailTab = (): RelayProjectRuleDetailTab => (
  readDocumentPanelQueryValue('doc') === '' ? 'rules' : 'documents'
)

const writeDocumentPanelQuery = (input: { documentPath?: string | null; search: string }) => {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    const search = input.search.trim()
    if (search === '') {
      url.searchParams.delete('q')
    } else {
      url.searchParams.set('q', search)
    }
    const documentPath = input.documentPath?.trim() ?? ''
    if (documentPath === '') {
      url.searchParams.delete('doc')
    } else {
      url.searchParams.set('doc', documentPath)
    }
    const nextRoute = `${url.pathname}${url.search}${url.hash}`
    const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextRoute !== currentRoute) {
      window.history.replaceState(window.history.state, '', nextRoute)
    }
  } catch {
    // Ignore malformed browser location state; document UI still works without URL persistence.
  }
}

const documentEntryIcon = (entry: RelayPersonalDocumentEntry, team?: RelayProfileTeam) => {
  if (entry.kind === 'agents') return team == null ? 'description' : 'groups'
  if (entry.kind === 'ooAgents') return 'account_tree'
  if (entry.localOnly) return 'description'
  if (entry.relativePath.toLowerCase().includes('review')) return 'checklist'
  return 'rule_settings'
}

const profileTabKeys = new Set(profileTabs.map(tab => tab.key))
const teamDetailTabKeys = new Set(teamDetailTabs.map(tab => tab.key))
const deviceDetailTabKeys = new Set(deviceDetailTabs.map(tab => tab.key))

const readCurrentPathname = () => {
  if (typeof window === 'undefined') return ''
  if (typeof window.location.pathname === 'string') return window.location.pathname
  try {
    return new URL(window.location.href).pathname
  } catch {
    return ''
  }
}

const readLocationSignature = () => {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

const safeDecodePathSegment = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const readRelayHomeSubpathSegments = (scope: string) => {
  const segments = readCurrentPathname().split('/')
  const homeIndex = segments.findIndex((segment, index) =>
    segment === 'plugins' &&
    safeDecodePathSegment(segments[index + 1] ?? '') === scope &&
    segments[index + 2] === 'home'
  )
  if (homeIndex < 0) return []
  return segments.slice(homeIndex + 3).filter(Boolean).map(safeDecodePathSegment)
}

const getPluginRouteBasePath = (scope: string) => {
  const segments = readCurrentPathname().split('/')
  const homeIndex = segments.findIndex((segment, index) =>
    segment === 'plugins' &&
    safeDecodePathSegment(segments[index + 1] ?? '') === scope &&
    segments[index + 2] === 'home'
  )
  if (homeIndex >= 0) return segments.slice(0, homeIndex + 3).join('/') || '/'
  return `/plugins/${encodeURIComponent(scope)}/home`
}

const notifyRouteChange = (scope: string) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('oneworks:plugin-route-change', {
      detail: {
        pluginScope: scope,
        route: `${window.location.pathname}${window.location.search}${window.location.hash}`
      }
    })
  )
}

const navigateTo = (scope: string, path: string) => {
  if (typeof window === 'undefined') return
  window.history.pushState(window.history.state, '', path)
  notifyRouteChange(scope)
}

const parseRoute = (scope: string): RelayHomeRoute => {
  const segments = readRelayHomeSubpathSegments(scope)
  if (segments[0] !== 'accounts') return { page: 'accounts' }
  if (segments[1] === 'servers') {
    if (segments[3] === 'login') return { page: 'login', serverId: cleanText(segments[2]) }
    return { page: 'servers' }
  }
  if (segments[1] === 'login') return { page: 'login' }
  const accountKey = cleanText(segments[1])
  if (accountKey == null) return { page: 'accounts' }
  if (segments[2] === 'messages') return { accountKey, page: 'messages' }
  if (segments[2] === 'tokens' && cleanText(segments[3]) != null) {
    return { accountKey, page: 'token', tokenId: segments[3] ?? 'new' }
  }
  if (segments[2] === 'devices' && cleanText(segments[3]) != null) {
    const tab = deviceDetailTabKeys.has(segments[4] as RelayDeviceDetailTab)
      ? segments[4] as RelayDeviceDetailTab
      : 'profile'
    return {
      accountKey,
      deviceId: segments[3] ?? '',
      page: 'device',
      tab
    }
  }
  if (segments[2] === 'teams' && cleanText(segments[3]) != null) {
    const tab = teamDetailTabKeys.has(segments[4] as RelayProfileTeamDetailTab)
      ? segments[4] as RelayProfileTeamDetailTab
      : 'overview'
    const configPanel = tab === 'configs' && cleanText(segments[5]) != null &&
        (segments[6] === 'content' || segments[6] === 'versions')
      ? segments[6] as 'content' | 'versions'
      : undefined
    return {
      accountKey,
      configPanel,
      configProfileId: tab === 'configs' ? cleanText(segments[5]) : undefined,
      page: 'team',
      projectRuleId: tab === 'projects' ? cleanText(segments[5]) : undefined,
      tab,
      teamId: segments[3] ?? ''
    }
  }
  const tab = profileTabKeys.has(segments[2] as RelayProfileTab) ? segments[2] as RelayProfileTab : 'account'
  return { accountKey, page: 'profile', tab }
}

const routePath = (scope: string, route: RelayHomeRoute) => {
  const base = getPluginRouteBasePath(scope)
  if (route.page === 'accounts') return `${base}/accounts`
  if (route.page === 'servers') return `${base}/accounts/servers`
  if (route.page === 'login') {
    return route.serverId == null
      ? `${base}/accounts/login`
      : `${base}/accounts/servers/${encodeURIComponent(route.serverId)}/login`
  }
  if (route.page === 'messages') return `${base}/accounts/${encodeURIComponent(route.accountKey)}/messages`
  if (route.page === 'profile') {
    return `${base}/accounts/${encodeURIComponent(route.accountKey)}/${encodeURIComponent(route.tab)}`
  }
  if (route.page === 'device') {
    const suffix = route.tab === 'profile' ? '' : `/${encodeURIComponent(route.tab)}`
    return `${base}/accounts/${encodeURIComponent(route.accountKey)}/devices/${
      encodeURIComponent(route.deviceId)
    }${suffix}`
  }
  if (route.page === 'team') {
    const suffix = route.tab === 'overview' ? '' : `/${encodeURIComponent(route.tab)}`
    const configProfileId = cleanText(route.configProfileId)
    const projectRuleId = cleanText(route.projectRuleId)
    const detailSuffix = route.tab === 'configs' && configProfileId != null
      ? `/${encodeURIComponent(configProfileId)}${route.configPanel == null ? '' : `/${route.configPanel}`}`
      : route.tab === 'projects' && projectRuleId != null
      ? `/${encodeURIComponent(projectRuleId)}`
      : ''
    return `${base}/accounts/${encodeURIComponent(route.accountKey)}/teams/${
      encodeURIComponent(route.teamId)
    }${suffix}${detailSuffix}`
  }
  return `${base}/accounts/${encodeURIComponent(route.accountKey)}/tokens/${encodeURIComponent(route.tokenId)}`
}

const readErrorMessageFromJsonText = (text: string) => {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    const body = JSON.parse(trimmed) as unknown
    if (isRecord(body)) {
      return cleanText(body.error) ?? cleanText(body.message) ?? trimmed
    }
  } catch {
    return trimmed
  }
  return trimmed
}

export const readJsonResponse = async <T>(response: Response, action: string): Promise<T> => {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(readErrorMessageFromJsonText(text) ?? `${action} failed with ${response.status}`)
  }
  return (text.trim() === '' ? {} : JSON.parse(text)) as T
}

const requestJson = async <T>(
  ctx: PluginClientContext,
  action: string,
  body?: Record<string, unknown>,
  method = 'POST'
) => {
  const response = await ctx.api.fetch(`relay/${action}`, {
    body: body == null ? undefined : JSON.stringify(body),
    headers: body == null ? undefined : { 'content-type': 'application/json' },
    method
  })
  return await readJsonResponse<T>(response, action)
}

export const completeRelayLoginCallback = async (
  ctx: PluginClientContext,
  callback: RelayLoginCallback,
  onLoginComplete?: () => Promise<void> | void
) => {
  const result = await requestJson(ctx, 'login-callback', {
    serverId: callback.serverId,
    token: callback.token
  })
  await onLoginComplete?.()
  return result
}

const readRelayStatus = async (ctx: PluginClientContext) => {
  const response = await ctx.api.fetch('relay/status')
  return await readJsonResponse<RelayStatus>(response, 'status')
}

const readProfile = async (ctx: PluginClientContext, accountKey: string) => (
  await requestJson<RelayProfileStatus>(ctx, 'profile', { accountKey, status: 'all' })
)

const useLocationSignature = (react: PluginReactHost, scope: string) => {
  const [signature, setSignature] = react.useState(readLocationSignature)
  react.useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const update = (event?: Event) => {
      if (event instanceof CustomEvent) {
        const detail = typeof event.detail === 'object' && event.detail != null
          ? event.detail as { pluginScope?: unknown }
          : {}
        if (typeof detail.pluginScope === 'string' && detail.pluginScope !== scope) return
      }
      setSignature(readLocationSignature())
    }
    window.addEventListener('popstate', update)
    window.addEventListener('oneworks:plugin-route-change', update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener('oneworks:plugin-route-change', update)
    }
  }, [scope])
  return signature
}

const useAsyncStatus = (react: PluginReactHost, ctx: PluginClientContext, revision: number) => {
  const [state, setState] = react.useState<AsyncState<RelayStatus>>({
    data: null,
    error: null,
    loading: true
  })
  react.useEffect(() => {
    let disposed = false
    setState(current => ({ ...current, error: null, loading: true }))
    void readRelayStatus(ctx).then(data => {
      if (!disposed) setState({ data, error: null, loading: false })
    }).catch(error => {
      if (!disposed) setState(current => ({ ...current, error: toErrorMessage(error), loading: false }))
    })
    return () => {
      disposed = true
    }
  }, [ctx, revision])
  return state
}

const useAsyncProfile = (
  react: PluginReactHost,
  ctx: PluginClientContext,
  accountKey: string | undefined,
  revision: number
) => {
  const [state, setState] = react.useState<AsyncState<RelayProfileStatus>>({
    data: null,
    error: null,
    loading: accountKey != null
  })
  react.useEffect(() => {
    if (accountKey == null) {
      setState({ data: null, error: null, loading: false })
      return undefined
    }
    let disposed = false
    setState(current => ({ ...current, error: null, loading: true }))
    void readProfile(ctx, accountKey).then(data => {
      if (!disposed) setState({ data, error: null, loading: false })
    }).catch(error => {
      if (!disposed) setState(current => ({ ...current, error: toErrorMessage(error), loading: false }))
    })
    return () => {
      disposed = true
    }
  }, [ctx, accountKey, revision])
  return state
}

const findServerForAccount = (account: RelayAuthAccount, servers: RelayServerStatus[]) => {
  const serverId = cleanText(account.serverId)
  const serverUrl = normalizeComparableUrl(account.serverUrl)
  return servers.find(server =>
    cleanText(server.id) === serverId ||
    normalizeComparableUrl(server.remoteBaseUrl) === serverUrl
  )
}

const getServers = (status?: RelayStatus | null) => status?.servers ?? status?.options?.servers ?? []

const getAccountKey = (account?: RelayAuthAccount) => cleanText(account?.accountKey) ?? ''

const isLauncherSurface = (view?: PluginViewContext) => view?.host?.surface === 'launcher'

const accountDisplayName = (account?: RelayAuthAccount | null) => (
  cleanText(account?.name) ??
    cleanText(account?.loginId) ??
    cleanText(account?.email) ??
    cleanText(account?.userId) ??
    '账号'
)

const accountSubtitle = (account?: RelayAuthAccount | null, includeEmail = true) =>
  (
    includeEmail
      ? cleanTextList([account?.email, account?.loginId, account?.userId]).find(value =>
        value !== accountDisplayName(account)
      )
      : cleanTextList([account?.loginId, account?.userId]).find(value => value !== accountDisplayName(account))
  ) ?? ''

const isOfficialServerId = (value?: string) => (
  value === OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID ||
  value === OFFICIAL_RELAY_CLOUDFLARE_DEV_SERVER_ID ||
  value === OFFICIAL_RELAY_VERCEL_SERVER_ID ||
  value === OFFICIAL_RELAY_VERCEL_DEV_SERVER_ID
)

const officialServerLabel = (server?: RelayServerStatus) => {
  const id = cleanText(server?.id)
  if (id === OFFICIAL_RELAY_CLOUDFLARE_DEV_SERVER_ID) return 'Official-dev'
  if (id === OFFICIAL_RELAY_VERCEL_SERVER_ID) return 'Official-vc'
  if (id === OFFICIAL_RELAY_VERCEL_DEV_SERVER_ID) return 'Official-vc-dev'
  if (id === OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID) return 'Official'
  return undefined
}

const serverDisplayName = (server?: RelayServerStatus, fallback = '服务') => (
  officialServerLabel(server) ??
    cleanText(server?.name) ??
    cleanText(server?.remoteBaseUrl) ??
    cleanText(server?.server) ??
    cleanText(server?.id) ??
    fallback
)

const selectedServerDisplayName = (status: RelayStatus | null, requestedServerId?: string) => {
  const serverId = cleanText(requestedServerId) ?? cleanText(status?.connection?.activeServerId)
  const server = getServers(status).find(item => cleanText(item.id) === serverId)
  return serverDisplayName(server ?? (serverId == null ? undefined : { id: serverId }), 'Relay')
}

const serverAddress = (server?: RelayServerStatus) => {
  const remoteBaseUrl = cleanText(server?.remoteBaseUrl)
  if (remoteBaseUrl != null) return remoteBaseUrl
  const host = cleanText(server?.server)
  if (host == null) return ''
  if (/^https?:\/\//iu.test(host)) return host
  const protocol = cleanText(server?.protocol) ?? 'https'
  const port = typeof server?.port === 'number' ? `:${server.port}` : ''
  return `${protocol}://${host}${port}`
}

const accountServerGroupLabel = (account: RelayAuthAccount, servers: RelayServerStatus[]) => {
  const server = findServerForAccount(account, servers)
  const serverId = cleanText(server?.id ?? account.serverId)
  if (server?.official === true || isOfficialServerId(serverId)) return 'Official'
  if (serverId === LOCAL_RELAY_SERVER_ID || cleanText(account.serverAlias)?.toLowerCase() === 'local') return '本地'
  return serverDisplayName(server, cleanText(account.serverAlias) ?? '服务')
}

const serverGroupIcon = (
  group: { key: string; label: string; server?: RelayServerStatus }
) => {
  const serverId = cleanText(group.server?.id) ?? group.key
  if (group.server?.official === true || isOfficialServerId(serverId)) return 'cloud'
  return 'dns'
}

const groupAccountsByServer = (accounts: RelayAuthAccount[], servers: RelayServerStatus[]) => {
  const groups = new Map<string, { accounts: RelayAuthAccount[]; label: string; server?: RelayServerStatus }>()
  accounts.forEach((account) => {
    const server = findServerForAccount(account, servers)
    const key = cleanText(account.serverId) ?? normalizeComparableUrl(account.serverUrl) ??
      cleanText(account.serverAlias) ?? 'default'
    const current = groups.get(key)
    if (current == null) {
      groups.set(key, { accounts: [account], label: accountServerGroupLabel(account, servers), server })
    } else {
      current.accounts.push(account)
    }
  })
  return [...groups.entries()].map(([key, value]) => ({ key, ...value }))
}

const teamDisplayName = (team?: RelayProfileTeam | null) => (
  cleanText(team?.name) ?? cleanText(team?.slug) ?? cleanText(team?.id) ?? '团队'
)

const teamRoleText = (team?: RelayProfileTeam | null) => (
  cleanText(team?.membership?.role) ?? cleanText(team?.role) ?? 'member'
)

const formatByteSize = (value?: number | null) => {
  const size = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  if (size < 1024) return `${size} B`
  const kib = size / 1024
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KB`
  const mib = kib / 1024
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`
}

const getProfileAccount = (
  profile: RelayProfileStatus | null,
  status: RelayStatus | null,
  accountKey?: string
) => (
  profile?.account ??
    status?.accounts?.find(account => cleanText(account.accountKey) === accountKey) ??
    profile?.accounts?.find(account => cleanText(account.accountKey) === accountKey) ??
    null
)

const renderIcon = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  name: string,
  props: Record<string, unknown> = {}
) => {
  const Icon = view?.ui?.Icon
  if (Icon != null) return react.createElement(Icon, { name, ...props })
  return react.createElement('span', {
    'aria-hidden': true,
    className: 'material-symbols-rounded oneworks-relay__icon',
    ...props
  }, name)
}

const renderButton = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  input: {
    danger?: boolean
    disabled?: boolean
    icon: string
    key?: string
    label: string
    onClick?: () => void
    primary?: boolean
  }
) => {
  const Button = view?.ui?.Button
  if (Button != null) {
    return react.createElement(Button, {
      ariaLabel: input.label,
      className: 'oneworks-relay__button',
      'data-primary': input.primary === true ? 'true' : undefined,
      danger: input.danger,
      disabled: input.disabled,
      icon: input.icon,
      key: input.key,
      onClick: input.onClick,
      shape: 'circle',
      size: 'small',
      title: input.label,
      type: 'text'
    })
  }
  return react.createElement('button', {
    'aria-label': input.label,
    className: 'oneworks-relay__button',
    'data-primary': input.primary === true ? 'true' : undefined,
    disabled: input.disabled,
    key: input.key,
    onClick: input.onClick,
    title: input.label,
    type: 'button'
  }, renderIcon(react, view, input.icon))
}

const renderActionButton = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  input: {
    disabled?: boolean
    icon: string
    key?: string
    label: string
    onClick?: () => void
    primary?: boolean
  }
) =>
  react.createElement(
    'button',
    {
      'aria-label': input.label,
      className: 'oneworks-relay__team-config-action',
      'data-primary': input.primary === true ? 'true' : undefined,
      disabled: input.disabled,
      key: input.key,
      onClick: input.onClick,
      title: input.label,
      type: 'button'
    },
    react.createElement(
      'span',
      { className: 'oneworks-relay__team-config-action-icon', 'aria-hidden': 'true' },
      renderIcon(react, view, input.icon, { size: 18 })
    ),
    react.createElement('span', { className: 'oneworks-relay__team-config-action-label' }, input.label)
  )

const renderAvatar = (
  react: PluginReactHost,
  input: { avatarUrl?: string | null; className?: string; name?: string; state?: string }
) => {
  const name = cleanText(input.name) ?? '账号'
  const avatarUrl = cleanText(input.avatarUrl)
  return react.createElement(
    'span',
    {
      className: ['oneworks-relay__account-avatar', input.className].filter(Boolean).join(' '),
      'data-state': input.state ?? 'signed-in'
    },
    avatarUrl == null
      ? react.createElement('span', null, getAvatarInitials(name))
      : react.createElement('img', {
        alt: '',
        className: 'oneworks-relay__account-avatar-image',
        draggable: false,
        src: avatarUrl
      })
  )
}

const renderFact = (react: PluginReactHost, label: string, value: PluginReactNode) => (
  react.createElement(
    'span',
    { className: 'oneworks-relay__profile-fact', key: label },
    react.createElement('span', { className: 'oneworks-relay__profile-fact-label' }, label),
    react.createElement('span', { className: 'oneworks-relay__profile-fact-value' }, value ?? '-')
  )
)

const renderInput = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  props: {
    ariaLabel?: string
    autoFocus?: boolean
    key?: string
    onChange: (value: string) => void
    onCommit?: (value: string) => void
    placeholder?: string
    rows?: number
    type?: 'password' | 'textarea' | 'text'
    value: string
  }
) => {
  const Input = view?.ui?.Input
  if (Input != null) {
    return react.createElement(Input, {
      allowClear: true,
      ariaLabel: props.ariaLabel,
      autoFocus: props.autoFocus,
      key: props.key,
      onChange: props.onChange,
      onCommit: props.onCommit,
      placeholder: props.placeholder,
      rows: props.rows,
      size: 'small',
      type: props.type,
      value: props.value
    })
  }
  const onInput = (event: Event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      ? event.target
      : null
    if (target != null) props.onChange(target.value)
  }
  const onBlur = (event: Event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      ? event.target
      : null
    if (target != null) props.onCommit?.(target.value)
  }
  if (props.type === 'textarea') {
    return react.createElement('textarea', {
      className: 'oneworks-relay__textarea',
      key: props.key,
      onBlur,
      onInput,
      placeholder: props.placeholder,
      rows: props.rows,
      value: props.value
    })
  }
  return react.createElement('input', {
    'aria-label': props.ariaLabel,
    autoFocus: props.autoFocus,
    className: 'oneworks-relay__input',
    key: props.key,
    onBlur,
    onInput,
    placeholder: props.placeholder,
    type: props.type ?? 'text',
    value: props.value
  })
}

const renderSearchInput = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  props: {
    ariaLabel?: string
    autoFocus?: boolean
    className?: string
    onChange: (value: string) => void
    placeholder?: string
    suffix?: PluginReactNode
    value: string
  }
) => {
  const SearchInput = view?.ui?.SearchInput
  if (SearchInput != null) {
    return react.createElement(SearchInput, {
      allowClear: true,
      ariaLabel: props.ariaLabel ?? props.placeholder,
      autoFocus: props.autoFocus,
      className: props.className,
      onChange: props.onChange,
      placeholder: props.placeholder,
      suffix: props.suffix,
      value: props.value
    })
  }
  return react.createElement(
    'label',
    { className: props.className },
    renderIcon(react, view, 'search', { size: 18 }),
    renderInput(react, view, {
      autoFocus: props.autoFocus,
      onChange: props.onChange,
      placeholder: props.placeholder,
      value: props.value
    }),
    props.suffix
  )
}

const renderSelect = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  props: {
    disabled?: boolean
    mode?: 'multiple'
    onChange: (value: string | string[]) => void
    options: Array<{ disabled?: boolean; icon?: string; label: string; value: string }>
    placeholder?: string
    value: string | string[]
  }
) => {
  const Select = view?.ui?.Select
  if (Select != null) {
    return react.createElement(Select, {
      disabled: props.disabled,
      mode: props.mode,
      onChange: props.onChange,
      options: props.options,
      placeholder: props.placeholder,
      size: 'small',
      value: props.value
    })
  }
  return react.createElement(
    'select',
    {
      className: 'oneworks-relay__input',
      disabled: props.disabled,
      multiple: props.mode === 'multiple',
      onInput: (event: Event) => {
        const target = event.target instanceof HTMLSelectElement ? event.target : null
        if (target == null) return
        props.onChange(
          props.mode === 'multiple'
            ? [...target.selectedOptions].map(option => option.value)
            : target.value
        )
      },
      value: props.value
    },
    ...props.options.map(option =>
      react.createElement('option', {
        disabled: option.disabled,
        key: option.value,
        value: option.value
      }, option.label)
    )
  )
}

const NativeList = (props: {
  children?: PluginReactNode | PluginReactNode[]
  className?: string
  react: PluginReactHost
  variant?: 'grouped' | 'resource'
}) => {
  const children = Array.isArray(props.children)
    ? props.children
    : props.children == null
    ? []
    : [props.children]
  const variant = props.variant ?? 'resource'
  return props.react.createElement(
    'div',
    {
      className: ['relay-admin-list-table relay-admin-list-table--content', props.className].filter(Boolean).join(' ')
    },
    props.react.createElement(
      'div',
      { className: 'relay-admin-list-table__table-scroll' },
      props.react.createElement(
        'div',
        {
          className: [
            adminListSurfaceClassNames.nativeList,
            variant === 'grouped'
              ? adminListSurfaceClassNames.nativeListGrouped
              : adminListSurfaceClassNames.nativeListResource
          ].join(' ')
        },
        ...children
      )
    )
  )
}

const NativeEmpty = (props: { react: PluginReactHost; text: string }) =>
  props.react.createElement('div', { className: adminListSurfaceClassNames.nativeEmpty }, props.text)

const ProfileHeader = (props: {
  account: RelayAuthAccount | null
  accountKey?: string
  profile: RelayProfileStatus | null
  react: PluginReactHost
}) => {
  const { account, accountKey, profile, react } = props
  const user = profile?.user
  const name = cleanText(user?.name) ?? accountDisplayName(account) ?? accountKey ?? '账号'
  const email = cleanText(user?.email) ?? cleanText(account?.email) ?? ''
  return react.createElement(
    'div',
    { className: 'oneworks-relay__profile-header' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__profile-title' },
      renderAvatar(react, {
        avatarUrl: user?.avatarUrl ?? account?.avatarUrl,
        className: 'oneworks-relay__profile-avatar',
        name
      }),
      react.createElement(
        'span',
        { className: 'oneworks-relay__profile-heading-copy' },
        react.createElement('span', { className: 'oneworks-relay__profile-eyebrow' }, '当前账号'),
        react.createElement('strong', null, name),
        react.createElement('span', null, email)
      )
    )
  )
}

const ProfileTabs = (props: {
  account: RelayAuthAccount | null
  accountKey: string
  activeTab: RelayProfileTab
  ctx: PluginClientContext
  onChanged: () => void
  react: PluginReactHost
  view?: PluginViewContext
}) => {
  const { account, accountKey, activeTab, ctx, onChanged, react, view } = props
  const NativeTabs = view?.ui?.NativeTabs
  if (NativeTabs == null) {
    return react.createElement('div', { className: 'oneworks-relay__empty' }, '标准标签组件不可用')
  }

  return react.createElement(NativeTabs, {
    activeKey: activeTab,
    actions: !isLauncherSurface(view) && activeTab === 'documents'
      ? renderDocumentTabActions({ account, accountKey, ctx, onChanged, react, view })
      : undefined,
    ariaLabel: '账号详情',
    className: 'oneworks-relay__profile-tabs',
    items: profileTabs.map((tab): PluginHostNativeTabItem => ({
      icon: tab.icon,
      key: tab.key,
      label: tab.label
    })),
    onChange: (nextTab: RelayProfileTab) =>
      navigateTo(ctx.scope, routePath(ctx.scope, { accountKey, page: 'profile', tab: nextTab }))
  })
}

const AccountInfoPanel = (
  props: {
    account: RelayAuthAccount | null
    profile: RelayProfileStatus | null
    react: PluginReactHost
  }
) => {
  const { account, profile, react } = props
  const user = profile?.user
  return react.createElement(
    'section',
    { className: 'oneworks-relay__profile-section' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__profile-grid' },
      renderFact(react, '邮箱', cleanText(user?.email) ?? cleanText(account?.email) ?? '-'),
      renderFact(react, '名称', cleanText(user?.name) ?? accountDisplayName(account)),
      renderFact(react, '登录 ID', cleanText(user?.loginId) ?? cleanText(account?.loginId) ?? '-'),
      renderFact(react, '状态', cleanText(user?.disabledAt) == null && account?.enabled !== false ? '正常' : '已停用'),
      renderFact(react, '角色', cleanText(user?.role) ?? cleanText(account?.role) ?? '-'),
      renderFact(react, '登录方式', cleanText(user?.provider) ?? '-'),
      renderFact(react, '账号 ID', cleanText(user?.id) ?? cleanText(account?.userId) ?? '-'),
      renderFact(react, '本地登录时间', formatDateTime(account?.updatedAt)),
      renderFact(react, '会话过期时间', formatDateTime(account?.sessionExpiresAt))
    )
  )
}

const DocumentSyncPanel = (
  props: {
    account: RelayAuthAccount | null
    accountKey: string
    ctx: PluginClientContext
    onChanged: () => void
    projectRule?: {
      assignmentId: string
      teamId: string
    }
    react: PluginReactHost
    status: RelayStatus | null
    team?: RelayProfileTeam
    view?: PluginViewContext
  }
) => {
  const { account, accountKey, ctx, onChanged, projectRule, react, status, team, view } = props
  const projectRuleScope = projectRule != null
  const teamScope = !projectRuleScope && team != null
  const accountScope = !projectRuleScope && !teamScope
  const documentSync = projectRuleScope
    ? status?.projectRuleDocumentSync?.[projectRule.assignmentId]
    : teamScope
    ? status?.teamDocumentSync?.[cleanText(team.id) ?? '']
    : status?.personalDocumentSync
  const [savingAction, setSavingAction] = react.useState<'import' | RelayPersonalDocumentSyncKind | null>(null)
  const [filter, setFilter] = react.useState(() => readDocumentPanelQueryValue('q'))
  const [loadedEntries, setLoadedEntries] = react.useState<RelayPersonalDocumentEntry[] | null>(null)
  const [selectedDocumentKey, setSelectedDocumentKey] = react.useState<string | null>(null)
  const [documentPreviewClosing, setDocumentPreviewClosing] = react.useState(false)
  const documentPreviewCloseTimerRef = react.useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const [resolvedInitialDocumentQuery, setResolvedInitialDocumentQuery] = react.useState(
    () => readDocumentPanelQueryValue('doc') === ''
  )
  const [documentContent, setDocumentContent] = react.useState<RelayDocumentContent | null>(null)
  const [documentContentError, setDocumentContentError] = react.useState<string | null>(null)
  const [documentContentLoading, setDocumentContentLoading] = react.useState(false)
  const preferences = documentSync?.preferences ?? {}
  const countsByKind = documentSync?.countsByKind ?? {}
  const syncedKindCount = PERSONAL_DOCUMENT_SYNC_KINDS
    .reduce((total, kind) => total + (countsByKind[kind] ?? 0), 0)
  const anyPersonalDocumentEnabled = personalDocumentSyncEnabled(documentSync)
  const scopeTitle = projectRuleScope ? '项目规则文档' : teamScope ? '团队文档' : '账号文档'
  const scopeMeta = projectRuleScope
    ? '该项目规则拥有独立的加密文档快照，命中 Git 仓库后会引导会话读取。'
    : accountScope
    ? '按用户根路径同步：~/AGENTS.md、~/.oo/AGENTS.md 和 ~/.oo/rules/**/*.md。'
    : '团队成员共享同一份密文快照；只读写团队命名空间文件。'
  const togglePersonalDocumentSync = (kind: RelayPersonalDocumentSyncKind, enabled: boolean) => {
    if (!accountScope) return
    setSavingAction(kind)
    void requestJson<RelayStatus>(
      ctx,
      'personal-document-sync-enabled',
      {
        accountKey,
        enabled,
        kind,
        serverId: cleanText(account?.serverId)
      }
    )
      .then(() => {
        onChanged()
      })
      .catch(error => {
        ctx.notifications?.show?.({
          description: toErrorMessage(error),
          level: 'error',
          title: '同步设置失败'
        })
      })
      .finally(() => setSavingAction(null))
  }
  const toggleTeamDocumentSync = (enabled: boolean) => {
    if (!teamScope || team == null) return
    setSavingAction('agents')
    void requestJson<RelayStatus>(
      ctx,
      'team-document-sync-enabled',
      {
        accountKey,
        enabled,
        kind: 'agents',
        serverId: cleanText(account?.serverId),
        teamId: team.id
      }
    )
      .then(() => {
        onChanged()
      })
      .catch(error => {
        ctx.notifications?.show?.({
          description: toErrorMessage(error),
          level: 'error',
          title: '同步设置失败'
        })
      })
      .finally(() => setSavingAction(null))
  }
  const importAccountAgents = () => {
    setSavingAction('import')
    void requestJson<RelayStatus>(
      ctx,
      'personal-document-import-root-agents',
      {
        accountKey,
        serverId: cleanText(account?.serverId)
      }
    )
      .then(() => {
        onChanged()
        ctx.notifications?.show?.({
          description: `${accountAgentsPath(account)} 已尝试上传到当前账号。`,
          level: 'success',
          title: '账号 AGENTS 已同步'
        })
      })
      .catch(error => {
        ctx.notifications?.show?.({
          description: toErrorMessage(error),
          level: 'error',
          title: '同步账号 AGENTS 失败'
        })
      })
      .finally(() => setSavingAction(null))
  }
  const syncSummary = documentSync == null
    ? '未同步'
    : documentSync.lastError != null && documentSync.lastError !== ''
    ? documentSync.lastError
    : `${documentSync.documentCount ?? 0} 个 · ${formatByteSize(documentSync.totalSizeBytes)} · ${
      formatDateTime(documentSync.lastSyncedAt)
    }`
  const documentPath = projectRuleScope
    ? projectRuleAgentsPath(projectRule.teamId, projectRule.assignmentId)
    : teamScope && team != null
    ? teamAgentsPath(team)
    : accountAgentsPath(account)
  const documentSource = documentPath
  const documentStateLabel = documentSync?.lastError != null && documentSync.lastError !== ''
    ? '同步异常'
    : accountScope
    ? personalDocumentSyncFullyEnabled(documentSync)
      ? '已同步'
      : anyPersonalDocumentEnabled
      ? '部分同步'
      : '需要同步'
    : documentSync != null && preferences.agents === true
    ? '已同步'
    : '需要同步'
  const documentScopeLabel = projectRuleScope ? '项目规则' : teamScope ? '团队' : '账号'
  const documentScopeKey = [
    projectRuleScope ? 'projectRule' : teamScope ? 'team' : 'account',
    accountKey,
    cleanText(account?.serverId) ?? '',
    cleanText(account?.userId) ?? '',
    cleanText(team?.id) ?? '',
    projectRule?.assignmentId ?? '',
    projectRule?.teamId ?? ''
  ].join('\u0000')
  const documentItemScopeKey = projectRuleScope
    ? `projectRule:${projectRule.teamId}:${projectRule.assignmentId}`
    : teamScope
    ? `team:${cleanText(team?.id) ?? ''}`
    : `account:${accountKey}`
  react.useEffect(() => {
    setFilter(readDocumentPanelQueryValue('q'))
    setSelectedDocumentKey(null)
    setDocumentPreviewClosing(false)
    setResolvedInitialDocumentQuery(readDocumentPanelQueryValue('doc') === '')
  }, [documentScopeKey])
  const clearDocumentPreviewCloseTimer = () => {
    if (documentPreviewCloseTimerRef.current == null) return
    globalThis.clearTimeout(documentPreviewCloseTimerRef.current)
    documentPreviewCloseTimerRef.current = null
  }
  react.useEffect(() => () => clearDocumentPreviewCloseTimer(), [])
  react.useEffect(() => {
    let cancelled = false
    setLoadedEntries(null)
    void requestJson<{ entries?: RelayPersonalDocumentEntry[] }>(
      ctx,
      'document-entries',
      projectRuleScope
        ? {
          accountKey,
          assignmentId: projectRule.assignmentId,
          scope: 'projectRule',
          serverId: cleanText(account?.serverId),
          teamId: projectRule.teamId
        }
        : accountScope
        ? {
          accountKey,
          scope: 'account',
          serverId: cleanText(account?.serverId)
        }
        : {
          accountKey,
          scope: 'team',
          serverId: cleanText(account?.serverId),
          teamId: team?.id ?? ''
        }
    ).then(result => {
      if (!cancelled) setLoadedEntries(result.entries ?? [])
    }).catch(() => {
      if (!cancelled) setLoadedEntries([])
    })
    return () => {
      cancelled = true
    }
  }, [
    accountKey,
    cleanText(account?.serverId),
    cleanText(account?.userId),
    cleanText(team?.id),
    projectRule?.assignmentId,
    projectRule?.teamId
  ])
  const statusEntries = documentSync?.entries ?? []
  const documentEntries = loadedEntries ?? statusEntries
  const documentItems: RelayDocumentInteractionItem[] = documentEntries.map((entry): RelayDocumentInteractionItem => {
    const isTeamAgentsEntry = teamScope && entry.kind === 'agents' && entry.relativePath === 'AGENTS.md'
    const isProjectRuleAgentsEntry = projectRuleScope && entry.kind === 'agents' && entry.relativePath === 'AGENTS.md'
    const isPersonalRootAgentsEntry = accountScope && entry.kind === 'agents'
    const isPersonalOoAgentsEntry = accountScope && entry.kind === 'ooAgents'
    const isPersonalOoRulesEntry = accountScope && entry.kind === 'ooRules'
    const displayPath = documentFullDisplayPath(entry.path)
    const title = cleanText(entry.displayName) ?? documentFileName(entry.relativePath)
    const itemKind = isPersonalRootAgentsEntry
      ? 'userAgents'
      : isPersonalOoAgentsEntry
      ? 'userOoAgents'
      : isPersonalOoRulesEntry
      ? 'userOoRules'
      : isTeamAgentsEntry
      ? 'teamAgents'
      : 'namespaceDocument'
    const entryEnabled = accountScope
      ? entry.localOnly ? false : preferences[entry.kind] === true
      : preferences.agents === true
    const meta = isTeamAgentsEntry || isProjectRuleAgentsEntry || isPersonalRootAgentsEntry || isPersonalOoAgentsEntry
      ? documentStateLabel
      : entry.localOnly
      ? '本地'
      : entryEnabled
      ? '同步'
      : '未同步'
    const tooltip = displayPath
    return {
      documentSyncKind: entry.kind,
      displayPath,
      enabled: entryEnabled,
      exists: entry.exists,
      icon: documentEntryIcon(entry, teamScope ? team : undefined),
      // Local absolute paths can differ between the status snapshot and a refreshed entry list.
      // Scope plus relative path is the stable document identity across that handoff.
      key: `document:${documentItemScopeKey}:${entry.relativePath}`,
      kind: itemKind,
      localOnly: entry.localOnly,
      meta,
      path: entry.path,
      relativePath: entry.relativePath,
      searchText: cleanTextList([
        scopeTitle,
        scopeMeta,
        documentScopeLabel,
        personalDocumentKindLabel(entry.kind),
        isTeamAgentsEntry || isProjectRuleAgentsEntry ? `${documentScopeLabel} AGENTS` : '规则',
        title,
        entry.relativePath,
        entry.path,
        displayPath,
        meta,
        documentSource,
        documentPath,
        documentStateLabel,
        syncSummary,
        `${syncedKindCount} 个`,
        entry.localOnly ? '.local.md 本地 不上传' : '同步'
      ]).join(' '),
      title,
      tooltip
    }
  })
  const documentItemKeySignature = documentItems.map(item => item.key).join('\n')
  const documentEntriesLoaded = loadedEntries != null
  react.useEffect(() => {
    if (resolvedInitialDocumentQuery) return
    const requestedDocumentPath = readDocumentPanelQueryValue('doc')
    if (requestedDocumentPath === '') {
      setResolvedInitialDocumentQuery(true)
      return
    }

    const matchedDocument = documentItems.find(item =>
      item.exists && (
        item.relativePath === requestedDocumentPath ||
        item.path === requestedDocumentPath ||
        item.displayPath === requestedDocumentPath
      )
    )
    if (matchedDocument != null) {
      setSelectedDocumentKey(matchedDocument.key)
      setResolvedInitialDocumentQuery(true)
      return
    }
    if (documentEntriesLoaded) {
      setResolvedInitialDocumentQuery(true)
    }
  }, [documentEntriesLoaded, documentItemKeySignature, resolvedInitialDocumentQuery])
  react.useEffect(() => {
    if (
      selectedDocumentKey != null &&
      !documentItems.some(item => item.key === selectedDocumentKey)
    ) {
      setSelectedDocumentKey(null)
    }
  }, [documentItemKeySignature, selectedDocumentKey])
  const selectedDocument = documentItems.find(item => item.key === selectedDocumentKey) ?? null
  const selectDocument = (item: RelayDocumentInteractionItem) => {
    if (!item.exists) return
    clearDocumentPreviewCloseTimer()
    setDocumentPreviewClosing(false)
    setSelectedDocumentKey(item.key)
  }
  const finishDocumentPreviewClose = () => {
    clearDocumentPreviewCloseTimer()
    setSelectedDocumentKey(null)
    setDocumentPreviewClosing(false)
  }
  const closeDocumentPreview = () => {
    if (selectedDocument == null || documentPreviewClosing) return
    clearDocumentPreviewCloseTimer()
    setDocumentPreviewClosing(true)
    documentPreviewCloseTimerRef.current = globalThis.setTimeout(() => {
      finishDocumentPreviewClose()
    }, DOCUMENT_PREVIEW_CLOSE_ANIMATION_MS + 80)
  }
  react.useEffect(() => {
    if (!resolvedInitialDocumentQuery) return
    writeDocumentPanelQuery({
      documentPath: selectedDocument?.relativePath ?? null,
      search: filter
    })
  }, [filter, resolvedInitialDocumentQuery, selectedDocument?.relativePath])
  react.useEffect(() => {
    if (selectedDocument == null) {
      setDocumentContent(null)
      setDocumentContentError(null)
      setDocumentContentLoading(false)
      return
    }
    if (!selectedDocument.exists) {
      setDocumentContent(null)
      setDocumentContentError('本地文件不存在，创建后可预览内容。')
      setDocumentContentLoading(false)
      return
    }

    let cancelled = false
    setDocumentContent(null)
    setDocumentContentError(null)
    setDocumentContentLoading(true)
    void requestJson<RelayDocumentContent>(ctx, 'document-content', {
      path: selectedDocument.path
    }).then(result => {
      if (!cancelled) setDocumentContent(result)
    }).catch(error => {
      if (!cancelled) setDocumentContentError(toErrorMessage(error))
    }).finally(() => {
      if (!cancelled) setDocumentContentLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [selectedDocument?.exists, selectedDocument?.path])
  const CodeEditor = view?.ui?.CodeEditor
  const InteractionList = view?.ui?.InteractionList
  const launcherSurface = isLauncherSurface(view)
  const copyDocumentText = (value: string, title: string) => {
    void (async () => {
      if (navigator.clipboard?.writeText == null) {
        throw new Error('当前环境不支持剪贴板。')
      }
      await navigator.clipboard.writeText(value)
    })()
      .then(() => {
        ctx.notifications?.show?.({
          description: value,
          level: 'success',
          title
        })
      })
      .catch(error => {
        ctx.notifications?.show?.({
          description: toErrorMessage(error),
          level: 'error',
          title: '复制失败'
        })
      })
  }
  const openDocumentPath = (item: RelayDocumentInteractionItem, mode: 'open' | 'reveal') => {
    void requestJson(ctx, 'document-path/open', {
      mode,
      path: item.path
    })
      .catch(error => {
        ctx.notifications?.show?.({
          description: toErrorMessage(error),
          level: 'error',
          title: mode === 'reveal' ? '显示文件失败' : '打开文件失败'
        })
      })
  }
  const getDocumentActions = (
    item: RelayDocumentInteractionItem
  ): Array<PluginHostInteractionListAction<RelayDocumentInteractionItem>> => {
    const actions: Array<PluginHostInteractionListAction<RelayDocumentInteractionItem>> = [
      {
        icon: 'open_in_new',
        key: 'open-external',
        label: '在外部软件打开',
        onSelect: selected => openDocumentPath(selected, 'open')
      },
      {
        icon: 'content_copy',
        key: 'copy-path',
        label: '复制路径',
        onSelect: selected => copyDocumentText(selected.displayPath, '路径已复制')
      }
    ]
    if (item.kind === 'userAgents' || item.kind === 'userOoAgents' || item.kind === 'userOoRules') {
      actions.push({
        disabled: savingAction != null || item.localOnly,
        icon: item.enabled ? 'toggle_on' : 'toggle_off',
        key: `toggle-${item.documentSyncKind}`,
        label: item.enabled ? '停止同步' : `同步${personalDocumentKindLabel(item.documentSyncKind)}`,
        onSelect: () => togglePersonalDocumentSync(item.documentSyncKind, !item.enabled)
      })
    }
    if (item.kind === 'userAgents') {
      actions.push({
        disabled: savingAction != null,
        icon: 'upload_file',
        key: 'import',
        label: savingAction === 'import' ? '同步中' : '立即同步 ~/AGENTS.md',
        onSelect: importAccountAgents
      })
    } else if (item.kind === 'teamAgents') {
      actions.push({
        disabled: savingAction != null,
        icon: item.enabled ? 'toggle_on' : 'toggle_off',
        key: 'toggle-agents',
        label: item.enabled ? '停止同步' : '同步',
        onSelect: () => toggleTeamDocumentSync(!item.enabled)
      })
    }
    actions.push(
      {
        icon: '',
        key: 'divider-document-more',
        label: '',
        type: 'divider'
      },
      {
        icon: 'folder_open',
        key: 'reveal',
        label: '在文件管理器中显示',
        onSelect: selected => openDocumentPath(selected, 'reveal')
      },
      {
        icon: 'content_copy',
        key: 'copy-relative-path',
        label: '复制相对路径',
        onSelect: selected => copyDocumentText(selected.relativePath, '相对路径已复制')
      }
    )
    return actions
  }
  const previewBreadcrumbItems = selectedDocument == null
    ? []
    : [
      ...selectedDocument.relativePath.split('/').filter(Boolean).slice(0, -1),
      selectedDocument.title
    ]
  const previewBreadcrumbNodes = previewBreadcrumbItems.flatMap((item, index) => {
    const isLast = index === previewBreadcrumbItems.length - 1
    return [
      react.createElement(
        'span',
        {
          className: isLast
            ? 'oneworks-relay__document-preview-breadcrumb-item is-current'
            : 'oneworks-relay__document-preview-breadcrumb-item',
          key: `breadcrumb-${index}-item`,
          title: item
        },
        item
      ),
      ...(isLast
        ? []
        : [
          react.createElement(
            'span',
            {
              'aria-hidden': 'true',
              className: 'oneworks-relay__document-preview-breadcrumb-separator',
              key: `breadcrumb-${index}-separator`
            },
            'chevron_right'
          )
        ])
    ]
  })
  const previewBody = selectedDocument == null
    ? react.createElement('div', { className: 'oneworks-relay__document-preview-empty' }, '选择左侧文件查看内容')
    : documentContentLoading
    ? react.createElement('div', { className: 'oneworks-relay__document-preview-empty' }, '正在加载文档内容')
    : documentContentError != null
    ? react.createElement(
      'div',
      { className: 'oneworks-relay__document-preview-empty oneworks-relay__document-preview-empty--error' },
      documentContentError
    )
    : documentContent == null
    ? react.createElement('div', { className: 'oneworks-relay__document-preview-empty' }, '选择左侧文件查看内容')
    : CodeEditor == null
    ? react.createElement(
      'pre',
      {
        'aria-label': `${selectedDocument.title} 内容`,
        className: 'oneworks-relay__document-preview-pre'
      },
      documentContent.content
    )
    : react.createElement(CodeEditor, {
      ariaLabel: `${selectedDocument.title} 内容`,
      className: 'oneworks-relay__document-preview-editor',
      language: 'markdown',
      path: selectedDocument.path,
      readOnly: true,
      value: documentContent.content
    })
  const documentPreview = selectedDocument == null
    ? null
    : react.createElement(
      'section',
      {
        'aria-label': '文档内容预览',
        className: [
          'oneworks-relay__document-preview',
          documentPreviewClosing ? 'oneworks-relay__document-preview--closing' : ''
        ].filter(Boolean).join(' '),
        onAnimationEnd: (event: { currentTarget: unknown; target: unknown }) => {
          if (documentPreviewClosing && event.currentTarget === event.target) {
            finishDocumentPreviewClose()
          }
        }
      },
      react.createElement(
        'header',
        { className: 'oneworks-relay__document-preview-head' },
        react.createElement(
          'div',
          { className: 'oneworks-relay__document-preview-copy' },
          react.createElement(
            'nav',
            {
              'aria-label': '文档路径',
              className: 'oneworks-relay__document-preview-breadcrumb',
              title: selectedDocument.displayPath
            },
            previewBreadcrumbNodes
          )
        ),
        react.createElement(
          'div',
          { className: 'oneworks-relay__document-preview-actions' },
          react.createElement(
            'button',
            {
              'aria-label': '关闭预览',
              className: 'oneworks-relay__button oneworks-relay__document-preview-close',
              onClick: closeDocumentPreview,
              title: '关闭预览',
              type: 'button'
            },
            react.createElement('span', { className: 'material-symbols-rounded oneworks-relay__icon' }, 'close')
          )
        )
      ),
      react.createElement('div', { className: 'oneworks-relay__document-preview-body' }, previewBody)
    )
  return react.createElement(
    'section',
    { className: 'oneworks-relay__profile-section oneworks-relay__profile-section--documents' },
    react.createElement(
      'div',
      {
        className: [
          'oneworks-relay__personal-docs',
          selectedDocument == null ? '' : 'oneworks-relay__personal-docs--preview-open',
          documentPreviewClosing ? 'oneworks-relay__personal-docs--preview-closing' : ''
        ].filter(Boolean).join(' ')
      },
      react.createElement(
        'div',
        { className: 'oneworks-relay__personal-docs-list-pane' },
        InteractionList == null
          ? react.createElement('div', { className: 'oneworks-relay__empty' }, '标准文档列表组件不可用')
          : react.createElement(InteractionList, {
            actionDisplay: 'inline',
            actions: getDocumentActions,
            activeKey: selectedDocumentKey ?? undefined,
            border: 'borderless',
            className: 'oneworks-relay__host-interaction-list oneworks-relay__personal-docs-list',
            descriptionPlacement: 'content',
            emptyText: '没有匹配的文档',
            iconSize: 18,
            inlineActionLimit: 3,
            items: documentItems,
            padding: 'none',
            search: {
              onChange: setFilter,
              placeholder: projectRuleScope
                ? '搜索项目规则文档、路径或同步状态'
                : teamScope
                ? '搜索团队文档、路径或同步状态'
                : '搜索账号文档、路径或同步状态',
              value: filter
            },
            splitActionHover: true,
            mode: 'resource',
            onSelect: selectDocument
          })
      ),
      documentPreview
    )
  )
}

const renderDocumentTabActions = (props: {
  account: RelayAuthAccount | null
  accountKey: string
  ctx: PluginClientContext
  onChanged: () => void
  react: PluginReactHost
  team?: RelayProfileTeam
  view?: PluginViewContext
}) => {
  const { account, accountKey, ctx, onChanged, react, team, view } = props
  return react.createElement(
    'span',
    { className: 'oneworks-relay__document-tab-actions' },
    renderButton(react, view, {
      icon: 'sync',
      label: '同步所有文档',
      onClick: () => {
        if (team == null) {
          void Promise.all(PERSONAL_DOCUMENT_SYNC_KINDS.map(kind =>
            requestJson<RelayStatus>(
              ctx,
              'personal-document-sync-enabled',
              {
                accountKey,
                enabled: true,
                kind,
                serverId: cleanText(account?.serverId)
              }
            )
          )).then(() => {
            onChanged()
          }).catch(error => {
            ctx.notifications?.show?.({
              description: toErrorMessage(error),
              level: 'error',
              title: '同步文档失败'
            })
          })
          return
        }

        void requestJson<RelayStatus>(
          ctx,
          'team-document-sync-enabled',
          {
            accountKey,
            enabled: true,
            kind: 'agents',
            serverId: cleanText(account?.serverId),
            teamId: team.id
          }
        ).then(() => {
          onChanged()
        }).catch(error => {
          ctx.notifications?.show?.({
            description: toErrorMessage(error),
            level: 'error',
            title: '同步文档失败'
          })
        })
      }
    })
  )
}

const tokenScopeLabel = (scope?: string) => {
  if (scope === 'team') return '团队级'
  if (scope === 'platform') return '平台级'
  return '用户级'
}

const tokenPermissionLabel = (
  profile: RelayProfileStatus | null,
  token: RelayProfileAccessToken | TokenEditorState
) => {
  if (token.scope === 'team') {
    const team = profile?.teams?.find(item => cleanText(item.id) === cleanText(token.teamId))
    return `团队 API${team == null ? '' : ` · ${teamDisplayName(team)}`}`
  }
  if (token.scope === 'platform') return '平台 API'
  return '个人 API'
}

const tokenStatusLabel = (token: RelayProfileAccessToken) => cleanText(token.revokedAt) == null ? '可用' : '已撤销'

const matchesNativeSearch = (values: unknown[], normalizedFilter: string) =>
  normalizedFilter === '' ||
  values.some(value => cleanText(value)?.toLowerCase().includes(normalizedFilter) === true)

type RelayConnectionVisualState = 'offline' | 'online' | 'stale' | 'unknown'

const deviceConnectionState = (status?: string): { label: string; state: RelayConnectionVisualState } => {
  const normalized = cleanText(status)?.toLowerCase()
  if (normalized === 'online') return { label: '在线', state: 'online' }
  if (normalized === 'stale') return { label: '待确认', state: 'stale' }
  if (normalized === 'offline') return { label: '离线', state: 'offline' }
  return { label: '未知', state: 'unknown' }
}

const isCurrentClientDevice = (
  ctx: PluginClientContext,
  device: RelayDeviceSummary,
  status: RelayStatus | null
) => {
  const deviceId = cleanText(device.id)
  const currentDeviceId = cleanText(status?.device?.id)
  if (deviceId == null) return false
  if (device.isCurrentClientDevice === true) return true
  if (currentDeviceId != null && deviceId === currentDeviceId) return true
  return deviceId.startsWith('fixture-device:') && cleanText(device.pluginScope) === ctx.scope
}

const pathBasename = (path?: string) => {
  const normalized = cleanText(path)?.replace(/[/\\]+$/u, '')
  if (normalized == null) return undefined
  const segments = normalized.split(/[/\\]+/u).filter(Boolean)
  return segments.at(-1) ?? normalized
}

const managementServerKindLabel = (kind?: string) => {
  const normalized = cleanText(kind)?.toLowerCase()
  if (normalized === 'electron') return 'Electron'
  if (normalized === 'web') return 'Web'
  if (normalized === 'daemon') return 'Daemon'
  if (normalized === 'workspace') return 'Workspace'
  return cleanText(kind) ?? 'Management Server'
}

const managementServerIcon = (kind?: string) => {
  const normalized = cleanText(kind)?.toLowerCase()
  if (normalized === 'electron') return 'desktop_windows'
  if (normalized === 'web') return 'language'
  if (normalized === 'daemon') return 'terminal'
  return 'lan'
}

const managementServerTitle = (server: NonNullable<RelayDeviceSummary['managementServers']>[number]) => (
  cleanText(server.name) ??
    pathBasename(server.workspaceFolder) ??
    managementServerKindLabel(server.kind)
)

type RelayDeviceManagerSummary = NonNullable<RelayDeviceSummary['managementServers']>[number]

const deviceManagementServers = (device: RelayDeviceSummary) =>
  (device.managementServers ?? []).filter(server => cleanText(server.id) != null)

const deviceEnvironmentValues = (environment?: RelayDeviceSummary['deviceInfo']) => [
  environment?.arch,
  environment?.deviceType,
  environment?.osName,
  environment?.osPlatform,
  environment?.osRelease,
  environment?.osType,
  environment?.osVersion,
  environment?.runtime,
  environment?.runtimeVersion
]

const deviceEnvironmentForDisplay = (
  device: RelayDeviceSummary,
  managers: RelayDeviceManagerSummary[]
) => {
  if (device.deviceInfo != null) return device.deviceInfo
  return managers.find(server => server.environment != null)?.environment
}

const deviceTypeLabel = (environment?: RelayDeviceSummary['deviceInfo']) => {
  const normalized = cleanText(environment?.deviceType)?.toLowerCase()
  if (normalized === 'computer' || normalized === 'desktop' || normalized === 'laptop') return '电脑'
  if (normalized === 'server') return '服务器'
  if (normalized === 'phone' || normalized === 'mobile') return '手机'
  if (normalized === 'tablet') return '平板'
  return cleanText(environment?.deviceType) ?? '未知'
}

const osNameLabel = (environment?: RelayDeviceSummary['deviceInfo']) => {
  const normalized = cleanText(environment?.osPlatform)?.toLowerCase()
  if (normalized === 'darwin') return 'macOS'
  if (normalized === 'win32') return 'Windows'
  if (normalized === 'linux') return 'Linux'
  return cleanText(environment?.osName) ?? cleanText(environment?.osType) ?? cleanText(environment?.osPlatform)
}

const osDetailLabel = (environment?: RelayDeviceSummary['deviceInfo']) => {
  const osName = osNameLabel(environment)
  return cleanTextList([
    osName,
    environment?.osVersion,
    environment?.osRelease,
    environment?.arch
  ]).join(' · ') || '-'
}

const runtimeDetailLabel = (environment?: RelayDeviceSummary['deviceInfo']) => {
  const runtime = cleanText(environment?.runtime)
  const runtimeVersion = cleanText(environment?.runtimeVersion)
  if (runtime == null && runtimeVersion == null) return '-'
  if (runtime == null) return runtimeVersion ?? '-'
  return runtimeVersion == null ? runtime : `${runtime} ${runtimeVersion}`
}

const deviceInfoSummary = (environment?: RelayDeviceSummary['deviceInfo']) => {
  if (environment == null) return undefined
  const summary = cleanTextList([
    deviceTypeLabel(environment),
    osDetailLabel(environment)
  ]).filter(value => value !== '-' && value !== '未知')
    .join(' · ')
  return cleanText(summary)
}

const managementServerIp = (server: RelayDeviceManagerSummary) => (
  cleanText(server.lastSeenIp) ??
    cleanText(server.ip) ??
    cleanText(server.registeredIp)
)

interface RelayDeviceProjectGroup {
  id: string
  kind?: string
  kindLabel: string
  projects: RelayDeviceProjectRow[]
  status?: string
  title: string
}

interface RelayDeviceProjectRow {
  groupId: string
  groupKindLabel: string
  groupTitle: string
  id: string
  path?: string
  status?: string
  title: string
  updatedAt?: string
}

const projectStatus = (
  projectStatusValue: string | undefined,
  managerStatus: string | undefined,
  deviceStatusValue: string | undefined
) => cleanText(projectStatusValue) ?? cleanText(managerStatus) ?? cleanText(deviceStatusValue)

const projectTitle = (input: {
  fallbackTitle: string
  name?: string
  path?: string
  title?: string
}) => (
  pathBasename(input.path) ??
    pathBasename(input.title) ??
    pathBasename(input.name) ??
    input.fallbackTitle
)

const managerProjectRows = (
  device: RelayDeviceSummary,
  manager: RelayDeviceManagerSummary,
  managerIndex: number
): RelayDeviceProjectGroup => {
  const groupId = cleanText(manager.id) ?? `manager-${managerIndex}`
  const groupTitle = managementServerTitle(manager)
  const kindLabel = managementServerKindLabel(manager.kind)
  const declaredProjects = manager.projects ?? []
  const projects = declaredProjects
    .map((project, projectIndex): RelayDeviceProjectRow => {
      const path = cleanText(project.workspaceFolder)
      const title = projectTitle({
        fallbackTitle: groupTitle,
        name: project.name,
        path,
        title: project.title
      })
      return {
        groupId,
        groupKindLabel: kindLabel,
        groupTitle,
        id: cleanText(project.id) ?? `${groupId}:project:${projectIndex}`,
        path,
        status: projectStatus(project.status, manager.status, device.status),
        title,
        updatedAt: cleanText(project.lastSeenAt) ?? cleanText(project.createdAt) ?? cleanText(manager.lastSeenAt)
      }
    })
  if (projects.length === 0 && cleanText(manager.workspaceFolder) != null) {
    const path = cleanText(manager.workspaceFolder)
    projects.push({
      groupId,
      groupKindLabel: kindLabel,
      groupTitle,
      id: `${groupId}:workspace`,
      path,
      status: projectStatus(undefined, manager.status, device.status),
      title: projectTitle({ fallbackTitle: groupTitle, path }),
      updatedAt: cleanText(manager.lastSeenAt)
    })
  }
  return {
    id: groupId,
    kind: cleanText(manager.kind),
    kindLabel,
    projects,
    status: cleanText(manager.status) ?? cleanText(device.status),
    title: groupTitle
  }
}

const deviceProjectGroups = (
  device: RelayDeviceSummary,
  managers: RelayDeviceManagerSummary[]
): RelayDeviceProjectGroup[] => {
  if (managers.length === 0) {
    const path = cleanText(device.workspaceFolder)
    if (path == null) return []
    const title = projectTitle({ fallbackTitle: deviceDisplayName(device), path })
    return [{
      id: cleanText(device.id) ?? 'device',
      kind: 'workspace',
      kindLabel: 'Workspace',
      projects: [{
        groupId: cleanText(device.id) ?? 'device',
        groupKindLabel: 'Workspace',
        groupTitle: deviceDisplayName(device),
        id: `${cleanText(device.id) ?? 'device'}:workspace`,
        path,
        status: cleanText(device.status),
        title,
        updatedAt: cleanText(device.lastSeenAt)
      }],
      status: cleanText(device.status),
      title: deviceDisplayName(device)
    }]
  }
  return managers.map((manager, index) => managerProjectRows(device, manager, index))
}

const deviceConnectionRank = (status?: string) => {
  const state = deviceConnectionState(status).state
  if (state === 'online') return 0
  if (state === 'stale') return 1
  if (state === 'unknown') return 2
  return 3
}

const timestampValue = (value?: string) => {
  const text = cleanText(value)
  if (text == null) return 0
  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

const projectIdentityKey = (project: RelayDeviceProjectRow) => (
  cleanText(project.path)?.toLowerCase() ??
    cleanText(project.id)?.toLowerCase() ??
    project.title.toLowerCase()
)

const dedupeDeviceProjectGroups = (groups: RelayDeviceProjectGroup[]) => {
  const groupIndexById = new Map(groups.map((group, index) => [group.id, index]))
  const candidates = groups.flatMap((group, groupIndex) =>
    group.projects.map((project, projectIndex) => ({
      group,
      groupIndex,
      key: projectIdentityKey(project),
      project,
      projectIndex,
      rank: deviceConnectionRank(project.status ?? group.status),
      timestamp: timestampValue(project.updatedAt)
    }))
  )
  const selected = new Map<string, { groupId: string; projectId: string }>()
  candidates
    .sort((left, right) => (
      left.rank - right.rank ||
      right.timestamp - left.timestamp ||
      left.groupIndex - right.groupIndex ||
      left.projectIndex - right.projectIndex
    ))
    .forEach(candidate => {
      if (selected.has(candidate.key)) return
      selected.set(candidate.key, {
        groupId: candidate.group.id,
        projectId: candidate.project.id
      })
    })

  const selectedByGroup = new Map<string, Set<string>>()
  selected.forEach(value => {
    const groupProjects = selectedByGroup.get(value.groupId) ?? new Set<string>()
    groupProjects.add(value.projectId)
    selectedByGroup.set(value.groupId, groupProjects)
  })

  return groups
    .map(group => ({
      ...group,
      projects: group.projects.filter(project => selectedByGroup.get(group.id)?.has(project.id) === true)
    }))
    .filter(group => group.projects.length > 0)
    .sort((left, right) => {
      const leftRank = Math.min(
        deviceConnectionRank(left.status),
        ...left.projects.map(project => deviceConnectionRank(project.status ?? left.status))
      )
      const rightRank = Math.min(
        deviceConnectionRank(right.status),
        ...right.projects.map(project => deviceConnectionRank(project.status ?? right.status))
      )
      const leftFreshness = Math.max(0, ...left.projects.map(project => timestampValue(project.updatedAt)))
      const rightFreshness = Math.max(0, ...right.projects.map(project => timestampValue(project.updatedAt)))
      return (
        leftRank - rightRank ||
        rightFreshness - leftFreshness ||
        (groupIndexById.get(left.id) ?? 0) - (groupIndexById.get(right.id) ?? 0)
      )
    })
}

const projectSearchValues = (project: RelayDeviceProjectRow, group: RelayDeviceProjectGroup) => [
  project.title,
  project.path,
  project.groupTitle,
  project.groupKindLabel,
  deviceConnectionState(project.status ?? group.status).label,
  project.updatedAt
]

const groupSearchValues = (group: RelayDeviceProjectGroup) => [
  group.title,
  group.kindLabel,
  deviceConnectionState(group.status).label
]

const loginIpText = (ip?: string) => {
  const value = cleanText(ip)
  return value == null ? undefined : `IP ${value}`
}

const copyTextToClipboard = (
  ctx: PluginClientContext,
  value: string | undefined,
  successTitle: string
) => {
  const text = cleanText(value)
  if (text == null) return
  void (async () => {
    if (navigator.clipboard?.writeText == null) {
      throw new Error('当前环境不支持剪贴板。')
    }
    await navigator.clipboard.writeText(text)
  })()
    .then(() => {
      ctx.notifications?.show?.({
        description: text,
        level: 'success',
        title: successTitle
      })
    })
    .catch(error => {
      ctx.notifications?.show?.({
        description: toErrorMessage(error),
        level: 'error',
        title: '复制失败'
      })
    })
}

const managementServerSearchValues = (
  server: RelayDeviceManagerSummary
) => [
  server.id,
  managementServerTitle(server),
  managementServerKindLabel(server.kind),
  deviceConnectionState(server.status).label,
  managementServerIp(server),
  server.pluginScope,
  server.workspaceFolder,
  ...deviceEnvironmentValues(server.environment)
]

const deviceDisplayName = (device: RelayDeviceSummary | null | undefined) => (
  cleanText(device?.alias) ?? cleanText(device?.name) ?? cleanText(device?.id) ?? '设备'
)

const deviceMachineName = (device: RelayDeviceSummary | null | undefined) => (
  cleanText(device?.name) ?? cleanText(device?.id) ?? '设备'
)

const deviceScopeLabel = (
  ctx: PluginClientContext,
  device: RelayDeviceSummary,
  status: RelayStatus | null
) => isCurrentClientDevice(ctx, device, status) ? '本机' : '远端'

const deviceSearchValues = (
  ctx: PluginClientContext,
  device: RelayDeviceSummary,
  status: RelayStatus | null
) => {
  const connection = deviceConnectionState(device.status)
  const managementServers = deviceManagementServers(device)
  return [
    deviceDisplayName(device),
    deviceMachineName(device),
    device.id,
    device.ip,
    device.lastSeenIp,
    device.registeredIp,
    connection.label,
    deviceScopeLabel(ctx, device, status),
    ...deviceEnvironmentValues(device.deviceInfo),
    ...managementServers.flatMap(managementServerSearchValues)
  ]
}

const renderDevicePresenceIcon = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  input: {
    current: boolean
    state: string
  }
) =>
  react.createElement(
    'span',
    {
      className: `${adminListSurfaceClassNames.nativeIcon} oneworks-relay__device-presence-icon`,
      'data-current': input.current ? 'true' : 'false',
      title: input.current ? '本机设备' : '远端设备',
      'data-state': input.state
    },
    renderIcon(react, view, input.current ? 'important_devices' : 'computer'),
    react.createElement('span', {
      'aria-hidden': true,
      className: 'oneworks-relay__device-presence-dot'
    })
  )

const renderNativePresenceIcon = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  input: {
    icon: string
    state: string
    title: string
  }
) =>
  react.createElement(
    'span',
    {
      className: `${adminListSurfaceClassNames.nativeIcon} oneworks-relay__device-presence-icon`,
      'data-current': 'false',
      'data-state': input.state,
      title: input.title
    },
    renderIcon(react, view, input.icon),
    react.createElement('span', {
      'aria-hidden': true,
      className: 'oneworks-relay__device-presence-dot'
    })
  )

const TokensPanel = (props: {
  accountKey: string
  ctx: PluginClientContext
  profile: RelayProfileStatus | null
  react: PluginReactHost
  view?: PluginViewContext
}) => {
  const { accountKey, ctx, profile, react, view } = props
  const [filter, setFilter] = react.useState('')
  const tokens = profile?.security?.accessTokens ?? []
  const normalizedFilter = filter.trim().toLowerCase()
  const visibleTokens = normalizedFilter === ''
    ? tokens
    : tokens.filter(token =>
      matchesNativeSearch(
        [
          token.name,
          token.scope,
          token.tokenPreview,
          tokenStatusLabel(token),
          tokenPermissionLabel(profile, token)
        ],
        normalizedFilter
      )
    )
  const columns =
    'var(--relay-admin-list-native-icon-size, var(--app-chrome-icon-size, 18px)) minmax(160px, 1.4fr) minmax(80px, .6fr) minmax(120px, 1fr) minmax(140px, 1fr) minmax(120px, .8fr) minmax(100px, .8fr) minmax(70px, .5fr) auto'
  return react.createElement(
    'section',
    { className: 'oneworks-relay__profile-section' },
    renderSearchInput(react, view, {
      className: adminListSurfaceClassNames.nativeSearch,
      onChange: setFilter,
      placeholder: '搜索令牌名称、类型、团队、Preview、状态',
      suffix: renderButton(react, view, {
        icon: 'add',
        label: '生成令牌',
        onClick: () =>
          navigateTo(
            ctx.scope,
            routePath(ctx.scope, {
              accountKey,
              page: 'token',
              tokenId: 'new'
            })
          )
      }),
      value: filter
    }),
    react.createElement(
      NativeList,
      { react },
      react.createElement(
        'div',
        {
          className: adminListSurfaceClassNames.nativeRow,
          'data-kind': 'header',
          style: { '--relay-admin-list-native-row-columns': columns }
        },
        react.createElement('span', null),
        ...['名称', '类型', 'Preview', '权限范围', '创建时间', '最后使用', '状态'].map(label =>
          react.createElement('span', { className: adminListSurfaceClassNames.nativeCell, key: label }, label)
        ),
        react.createElement('span', null)
      ),
      ...(visibleTokens.length === 0
        ? [react.createElement(NativeEmpty, { key: 'empty', react, text: '暂无 API 令牌' })]
        : visibleTokens.map(token => {
          const tokenId = cleanText(token.id) ?? ''
          const name = cleanText(token.name) ?? '未命名令牌'
          return react.createElement(
            'div',
            {
              className: adminListSurfaceClassNames.nativeRow,
              'data-state': cleanText(token.revokedAt) == null ? 'enabled' : 'disabled',
              key: tokenId || name,
              style: { '--relay-admin-list-native-row-columns': columns }
            },
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeIcon },
              renderIcon(react, view, 'key')
            ),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeMain },
              react.createElement(
                'button',
                {
                  className: `oneworks-relay__link-button ${adminListSurfaceClassNames.nativeTitle}`,
                  onClick: () =>
                    navigateTo(
                      ctx.scope,
                      routePath(ctx.scope, {
                        accountKey,
                        page: 'token',
                        tokenId
                      })
                    ),
                  type: 'button'
                },
                name
              )
            ),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeCell },
              tokenScopeLabel(token.scope)
            ),
            react.createElement(
              'span',
              { className: `${adminListSurfaceClassNames.nativeCell} oneworks-relay__token-preview-cell` },
              cleanText(token.tokenPreview) ?? '-',
              cleanText(token.tokenPreview) == null ? null : renderButton(react, view, {
                icon: 'content_copy',
                label: '复制 Preview',
                onClick: () => {
                  void navigator.clipboard?.writeText(token.tokenPreview ?? '')
                }
              })
            ),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeCell },
              tokenPermissionLabel(profile, token)
            ),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeCell },
              formatDateTime(token.createdAt)
            ),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeCell },
              formatDateTime(token.lastUsedAt)
            ),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeCell },
              tokenStatusLabel(token)
            ),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeActions },
              renderButton(react, view, {
                icon: 'edit',
                label: '配置令牌',
                onClick: () =>
                  navigateTo(
                    ctx.scope,
                    routePath(ctx.scope, {
                      accountKey,
                      page: 'token',
                      tokenId
                    })
                  )
              }),
              renderButton(react, view, {
                danger: true,
                disabled: cleanText(token.revokedAt) != null,
                icon: 'block',
                label: '撤销令牌',
                onClick: () => {
                  void requestJson(
                    ctx,
                    `profile/access-tokens/${encodeURIComponent(tokenId)}`,
                    { accountKey },
                    'DELETE'
                  )
                    .then(() =>
                      navigateTo(ctx.scope, routePath(ctx.scope, { accountKey, page: 'profile', tab: 'tokens' }))
                    )
                }
              })
            )
          )
        }))
    )
  )
}

const DevicesPanel = (props: {
  accountKey: string
  ctx: PluginClientContext
  profile: RelayProfileStatus | null
  react: PluginReactHost
  status: RelayStatus | null
  view?: PluginViewContext
}) => {
  const { accountKey, ctx, profile, react, status, view } = props
  const [filter, setFilter] = react.useState('')
  const devices = profile?.devices ?? []
  const InteractionList = view?.ui?.InteractionList
  const deviceItems: RelayDeviceInteractionItem[] = devices.map((device) => {
    const deviceId = cleanText(device.id) ?? ''
    const title = deviceDisplayName(device)
    const machineName = deviceMachineName(device)
    const connection = deviceConnectionState(device.status)
    const isCurrentDevice = isCurrentClientDevice(ctx, device, status)
    const scopeLabel = deviceScopeLabel(ctx, device, status)
    return {
      device,
      deviceId,
      icon: isCurrentDevice ? 'important_devices' : 'computer',
      iconFilled: isCurrentDevice,
      iconState: connection.state,
      kind: 'device',
      key: `device:${deviceId || title}`,
      searchText: cleanTextList(deviceSearchValues(ctx, device, status)).join(' '),
      title,
      tooltip: cleanTextList([
        machineName,
        scopeLabel,
        connection.label,
        deviceInfoSummary(device.deviceInfo),
        cleanText(device.lastSeenIp) ?? cleanText(device.ip)
      ]).join(' · ')
    }
  })

  if (InteractionList != null) {
    return react.createElement(
      'section',
      { className: 'oneworks-relay__profile-section' },
      react.createElement(InteractionList, {
        border: 'borderless',
        className: 'oneworks-relay__host-interaction-list oneworks-relay__device-list',
        emptyText: devices.length === 0 ? '暂无设备' : '没有匹配的设备',
        iconSize: 18,
        items: deviceItems,
        padding: 'none',
        search: {
          onChange: setFilter,
          placeholder: '搜索设备名称或状态',
          value: filter
        },
        mode: 'resource',
        onSelect: (item: RelayDeviceInteractionItem) => {
          if (item.deviceId === '') return
          navigateTo(
            ctx.scope,
            routePath(ctx.scope, {
              accountKey,
              deviceId: item.deviceId,
              page: 'device',
              tab: 'profile'
            })
          )
        }
      })
    )
  }

  const normalizedFilter = filter.trim().toLowerCase()
  const visibleDevices = normalizedFilter === ''
    ? devices
    : devices.filter(device => matchesNativeSearch(deviceSearchValues(ctx, device, status), normalizedFilter))
  return react.createElement(
    'section',
    { className: 'oneworks-relay__profile-section' },
    renderSearchInput(react, view, {
      className: adminListSurfaceClassNames.nativeSearch,
      onChange: setFilter,
      placeholder: '搜索设备名称或状态',
      value: filter
    }),
    react.createElement(
      NativeList,
      { react },
      ...(visibleDevices.length === 0
        ? [
          react.createElement(NativeEmpty, {
            key: 'empty',
            react,
            text: devices.length === 0 ? '暂无设备' : '没有匹配的设备'
          })
        ]
        : visibleDevices.flatMap(device => {
          const deviceId = cleanText(device.id) ?? ''
          const title = deviceDisplayName(device)
          const machineName = deviceMachineName(device)
          const connection = deviceConnectionState(device.status)
          const isCurrentDevice = isCurrentClientDevice(ctx, device, status)
          const openDetail = () => {
            if (deviceId === '') return
            navigateTo(
              ctx.scope,
              routePath(ctx.scope, {
                accountKey,
                deviceId,
                page: 'device',
                tab: 'profile'
              })
            )
          }
          return [react.createElement(
            'div',
            {
              'aria-label': `${title} · ${deviceScopeLabel(ctx, device, status)} · ${connection.label}`,
              className: adminListSurfaceClassNames.nativeRow,
              'data-clickable': deviceId === '' ? undefined : 'true',
              key: deviceId || title,
              onClick: openDetail,
              onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                openDetail()
              },
              role: deviceId === '' ? undefined : 'button',
              style: {
                '--relay-admin-list-native-row-columns':
                  'var(--relay-admin-list-native-icon-size, var(--app-chrome-icon-size, 18px)) minmax(0, 1fr)'
              },
              tabIndex: deviceId === '' ? undefined : 0
            },
            renderDevicePresenceIcon(react, view, {
              current: isCurrentDevice,
              state: connection.state
            }),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeMain },
              react.createElement(
                'span',
                {
                  className: `${adminListSurfaceClassNames.nativeTitle} oneworks-relay__device-title`,
                  title: machineName
                },
                react.createElement(
                  'span',
                  { className: 'oneworks-relay__device-title-text' },
                  title
                )
              )
            )
          )]
        }))
    )
  )
}

const DeviceDetailView = (props: {
  account: RelayAuthAccount | null
  accountKey: string
  ctx: PluginClientContext
  deviceId: string
  profile: RelayProfileStatus | null
  react: PluginReactHost
  status: RelayStatus | null
  tab: RelayDeviceDetailTab
  view?: PluginViewContext
}) => {
  const { account, accountKey, ctx, deviceId, profile, react, status, tab, view } = props
  const device = profile?.devices?.find(item => cleanText(item.id) === deviceId)
  const accountName = accountDisplayName(account)
  const NativeTabs = view?.ui?.NativeTabs
  const launcherSurface = isLauncherSurface(view)
  const title = device == null ? cleanText(deviceId) ?? '设备' : deviceDisplayName(device)
  const connection = deviceConnectionState(device?.status)
  const isCurrentDevice = device == null ? false : isCurrentClientDevice(ctx, device, status)
  const managers = device == null ? [] : deviceManagementServers(device)
  const [projectFilter, setProjectFilter] = react.useState('')
  const [loginFilter, setLoginFilter] = react.useState('')
  const tabPanel = device == null
    ? renderTeamStatePanel(react, view, 'error', '未找到设备', `当前账号下没有找到 ${deviceId}。`)
    : tab === 'projects'
    ? renderDeviceProjectsPanel({
      ctx,
      device,
      filter: projectFilter,
      managers,
      onFilterChange: setProjectFilter,
      react,
      view
    })
    : tab === 'logins'
    ? renderDeviceLoginsPanel({
      device,
      filter: loginFilter,
      managers,
      onFilterChange: setLoginFilter,
      react,
      view
    })
    : renderDeviceProfilePanel({ ctx, device, isCurrentDevice, managers, react, status, view })
  return react.createElement(
    'main',
    { className: 'oneworks-relay' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__shell' },
      react.createElement(
        'section',
        { className: 'oneworks-relay__surface' },
        react.createElement(
          'section',
          {
            className: [
              'oneworks-relay__profile',
              'oneworks-relay__profile--team-detail',
              'oneworks-relay__profile--device-detail',
              launcherSurface ? 'oneworks-relay__profile--launcher' : ''
            ].filter(Boolean).join(' ')
          },
          launcherSurface
            ? null
            : react.createElement(
              'header',
              { className: 'oneworks-relay__team-hero oneworks-relay__device-hero' },
              react.createElement(
                'div',
                { className: 'oneworks-relay__team-hero-main' },
                react.createElement(
                  'span',
                  {
                    className: 'oneworks-relay__device-avatar',
                    'data-current': isCurrentDevice ? 'true' : 'false',
                    'data-state': connection.state
                  },
                  renderIcon(react, view, isCurrentDevice ? 'important_devices' : 'computer'),
                  react.createElement('span', {
                    'aria-hidden': true,
                    className: 'oneworks-relay__device-avatar-dot'
                  })
                ),
                react.createElement(
                  'span',
                  { className: 'oneworks-relay__team-hero-copy' },
                  react.createElement('strong', null, title),
                  react.createElement(
                    'span',
                    null,
                    [accountName, isCurrentDevice ? '本机设备' : '远端设备', connection.label].filter(Boolean).join(
                      ' · '
                    )
                  )
                )
              )
            ),
          NativeTabs == null
            ? react.createElement('div', { className: 'oneworks-relay__empty' }, '标准标签组件不可用')
            : react.createElement(NativeTabs, {
              activeKey: tab,
              ariaLabel: '设备详情',
              className: 'oneworks-relay__profile-tabs',
              items: deviceDetailTabs.map((item): PluginHostNativeTabItem => ({
                icon: item.icon,
                key: item.key,
                label: item.label
              })),
              onChange: (nextTab: RelayDeviceDetailTab) =>
                navigateTo(
                  ctx.scope,
                  routePath(ctx.scope, {
                    accountKey,
                    deviceId,
                    page: 'device',
                    tab: nextTab
                  })
                )
            }),
          react.createElement(
            'div',
            { className: 'oneworks-relay__team-detail-panel native-tabs-panel' },
            tabPanel
          )
        )
      )
    )
  )
}

const renderDeviceProfilePanel = (props: {
  ctx: PluginClientContext
  device: RelayDeviceSummary
  isCurrentDevice: boolean
  managers: NonNullable<RelayDeviceSummary['managementServers']>
  react: PluginReactHost
  status: RelayStatus | null
  view?: PluginViewContext
}) => {
  const { ctx, device, isCurrentDevice, managers, react, status, view } = props
  const connection = deviceConnectionState(device.status)
  const environment = deviceEnvironmentForDisplay(device, managers)
  const latestIp = cleanText(device.lastSeenIp) ??
    cleanText(device.ip) ??
    managers.map(managementServerIp).find(value => value != null) ??
    cleanText(device.registeredIp)
  return react.createElement(
    'section',
    { className: 'oneworks-relay__team-config-detail' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__team-detail-list' },
      renderTeamDetailRow(react, view, {
        description: '用户可识别的设备名称',
        icon: 'badge',
        label: '设备名称',
        value: deviceDisplayName(device)
      }),
      renderTeamDetailRow(react, view, {
        description: '硬件或运行设备类型',
        icon: 'computer',
        label: '设备类型',
        value: deviceTypeLabel(environment)
      }),
      renderTeamDetailRow(react, view, {
        description: '操作系统与架构',
        icon: 'developer_board',
        label: '系统信息',
        value: osDetailLabel(environment)
      }),
      renderTeamDetailRow(react, view, {
        description: '上报设备信息的运行时',
        icon: 'terminal',
        label: '运行时',
        value: runtimeDetailLabel(environment)
      }),
      renderTeamDetailRow(react, view, {
        description: '基于当前客户端识别',
        icon: isCurrentDevice ? 'important_devices' : 'computer',
        label: '设备归属',
        value: deviceScopeLabel(ctx, device, status)
      }),
      renderTeamDetailRow(react, view, {
        description: '最近一次心跳状态',
        icon: 'sync',
        label: '连接状态',
        value: connection.label
      }),
      renderTeamDetailRow(react, view, {
        description: '当前设备下的管理服务实例',
        icon: 'dns',
        label: 'Management Server',
        value: `${managers.length} 个`
      }),
      renderTeamDetailRow(react, view, {
        description: '设备最近一次上报的插件 scope',
        icon: 'extension',
        label: '插件范围',
        value: cleanText(device.pluginScope) ?? '-'
      }),
      renderTeamDetailRow(react, view, {
        description: '最近一次服务端看到的连接来源',
        icon: 'lan',
        label: '最近 IP',
        value: latestIp ?? '-'
      }),
      renderTeamDetailRow(react, view, {
        description: '创建 / 最近心跳',
        icon: 'schedule',
        label: '时间',
        value: [
          `创建 ${formatDateTime(device.createdAt)}`,
          `心跳 ${formatDateTime(device.lastSeenAt)}`
        ].join(' · ')
      }),
      renderTeamDetailRow(react, view, {
        description: '排查时使用的稳定标识',
        icon: 'fingerprint',
        label: '设备 ID',
        value: cleanText(device.id) ?? '-'
      }),
      renderTeamDetailRow(react, view, {
        description: '当前客户端是否连接到这台设备',
        icon: 'home_pin',
        label: '本机识别',
        value: isCurrentDevice ? '是' : '否'
      })
    )
  )
}

const renderDeviceProjectsPanel = (props: {
  ctx: PluginClientContext
  device: RelayDeviceSummary
  filter: string
  managers: NonNullable<RelayDeviceSummary['managementServers']>
  onFilterChange: (value: string) => void
  react: PluginReactHost
  view?: PluginViewContext
}) => {
  const { ctx, device, filter, managers, onFilterChange, react, view } = props
  const groups = dedupeDeviceProjectGroups(
    deviceProjectGroups(device, managers).filter(group => group.projects.length > 0)
  )
  const grouped = groups.length > 1
  const InteractionList = view?.ui?.InteractionList
  const copyProjectPath = (item: RelayDeviceProjectInteractionItem) => {
    copyTextToClipboard(ctx, item.path, '路径已复制')
  }
  const projectItemFor = (
    group: RelayDeviceProjectGroup,
    project: RelayDeviceProjectRow
  ): RelayDeviceProjectInteractionItem => {
    const connection = deviceConnectionState(project.status ?? group.status)
    const tooltip = cleanTextList([
      project.path,
      grouped ? group.title : undefined,
      connection.label
    ]).join(' · ')
    return {
      description: undefined,
      icon: 'folder_open',
      iconState: connection.state,
      key: `project:${project.id}`,
      kind: 'project',
      path: project.path,
      project,
      group,
      searchText: cleanTextList([
        ...projectSearchValues(project, group),
        project.path
      ]).join(' '),
      title: project.title,
      tooltip: tooltip === '' ? project.title : tooltip
    }
  }
  const listItems: RelayDeviceProjectInteractionItem[] = grouped
    ? groups.map(group => {
      const groupConnection = deviceConnectionState(group.status)
      return {
        children: group.projects.map(project => projectItemFor(group, project)),
        icon: managementServerIcon(group.kind),
        iconState: groupConnection.state,
        itemType: 'groupTitle',
        key: `group:${group.id}`,
        kind: 'managementServer',
        group,
        searchText: cleanTextList(groupSearchValues(group)).join(' '),
        title: group.title,
        tooltip: `${group.kindLabel} · ${groupConnection.label}`
      }
    })
    : groups.flatMap(group => group.projects.map(project => projectItemFor(group, project)))
  const getProjectActions = (
    item: RelayDeviceProjectInteractionItem
  ): Array<PluginHostInteractionListAction<RelayDeviceProjectInteractionItem>> => {
    if (item.kind !== 'project' || cleanText(item.path) == null) return []
    return [{
      icon: 'content_copy',
      key: 'copy-path',
      label: '复制路径',
      onSelect: copyProjectPath
    }]
  }

  if (InteractionList != null) {
    return react.createElement(
      'section',
      { className: 'oneworks-relay__profile-section' },
      react.createElement(InteractionList, {
        actionDisplay: 'inline',
        actions: getProjectActions,
        border: 'borderless',
        className: 'oneworks-relay__host-interaction-list oneworks-relay__device-project-list',
        descriptionPlacement: 'content',
        emptyText: groups.length === 0 ? '暂无项目' : '没有匹配的项目',
        iconSize: 18,
        inlineActionLimit: 1,
        items: listItems,
        padding: 'none',
        search: {
          onChange: onFilterChange,
          placeholder: '搜索项目名称、路径或状态',
          value: filter
        },
        showItemDescription: false,
        splitActionHover: true,
        mode: grouped ? 'grouped' : 'resource'
      })
    )
  }

  const normalizedFilter = filter.trim().toLowerCase()
  const visibleGroups = groups
    .map(group => {
      const groupMatches = matchesNativeSearch(groupSearchValues(group), normalizedFilter)
      const projects = groupMatches
        ? group.projects
        : group.projects.filter(project => matchesNativeSearch(projectSearchValues(project, group), normalizedFilter))
      return { ...group, projects }
    })
    .filter(group => group.projects.length > 0)
  const rows = visibleGroups.flatMap(group => {
    const groupConnection = deviceConnectionState(group.status)
    const groupRow = grouped
      ? [react.createElement(
        'div',
        {
          className: `${adminListSurfaceClassNames.nativeRow} oneworks-relay__device-management-group-row`,
          key: `group:${group.id}`,
          style: {
            '--relay-admin-list-native-row-columns':
              'var(--relay-admin-list-native-icon-size, var(--app-chrome-icon-size, 18px)) minmax(0, 1fr)'
          },
          title: `${group.kindLabel} · ${groupConnection.label}`
        },
        renderNativePresenceIcon(react, view, {
          icon: managementServerIcon(group.kind),
          state: groupConnection.state,
          title: `${group.kindLabel} · ${groupConnection.label}`
        }),
        react.createElement(
          'span',
          { className: adminListSurfaceClassNames.nativeMain },
          react.createElement('span', { className: adminListSurfaceClassNames.nativeTitle }, group.title)
        )
      )]
      : []
    return [
      ...groupRow,
      ...group.projects.map(project => {
        const connection = deviceConnectionState(project.status ?? group.status)
        const projectTooltip = cleanTextList([
          project.path,
          group.title,
          connection.label
        ]).join(' · ')
        return react.createElement(
          'div',
          {
            className: `${adminListSurfaceClassNames.nativeRow} ${grouped ? 'oneworks-relay__device-project-row' : ''}`,
            key: `project:${project.id}`,
            style: {
              '--relay-admin-list-native-row-columns':
                'var(--relay-admin-list-native-icon-size, var(--app-chrome-icon-size, 18px)) minmax(0, 1fr)'
            },
            title: projectTooltip === '' ? project.title : projectTooltip
          },
          renderNativePresenceIcon(react, view, {
            icon: 'folder_open',
            state: connection.state,
            title: connection.label
          }),
          react.createElement(
            'span',
            { className: adminListSurfaceClassNames.nativeMain },
            react.createElement('span', { className: adminListSurfaceClassNames.nativeTitle }, project.title)
          )
        )
      })
    ]
  })
  return react.createElement(
    'section',
    { className: 'oneworks-relay__profile-section' },
    renderSearchInput(react, view, {
      className: adminListSurfaceClassNames.nativeSearch,
      onChange: onFilterChange,
      placeholder: '搜索项目名称、路径或状态',
      value: filter
    }),
    react.createElement(
      NativeList,
      { react, variant: grouped ? 'grouped' : 'resource' },
      ...(rows.length === 0
        ? [
          react.createElement(NativeEmpty, {
            key: 'empty',
            react,
            text: groups.length === 0 ? '暂无项目' : '没有匹配的项目'
          })
        ]
        : rows)
    )
  )
}

const renderDeviceLoginsPanel = (props: {
  device: RelayDeviceSummary
  filter: string
  managers: NonNullable<RelayDeviceSummary['managementServers']>
  onFilterChange: (value: string) => void
  react: PluginReactHost
  view?: PluginViewContext
}) => {
  const { device, filter, managers, onFilterChange, react, view } = props
  const InteractionList = view?.ui?.InteractionList
  const normalizedFilter = filter.trim().toLowerCase()
  const rows: RelayDeviceLoginInteractionItem[] = [
    {
      icon: 'login',
      key: 'device-created',
      kind: 'loginRecord',
      meta: cleanTextList([
        formatDateTime(device.createdAt),
        loginIpText(cleanText(device.registeredIp) ?? cleanText(device.ip))
      ]).join(' · '),
      searchText: cleanTextList(['设备注册', device.registeredIp, device.ip, device.createdAt]).join(' '),
      title: '设备注册'
    },
    {
      icon: 'sync',
      key: 'device-heartbeat',
      kind: 'loginRecord',
      meta: cleanTextList([
        formatDateTime(device.lastSeenAt),
        loginIpText(cleanText(device.lastSeenIp) ?? cleanText(device.ip))
      ]).join(' · '),
      searchText: cleanTextList(['设备最近心跳', device.lastSeenIp, device.ip, device.lastSeenAt]).join(' '),
      title: '设备最近心跳'
    },
    ...managers.map(server => ({
      icon: managementServerIcon(server.kind),
      key: `manager:${cleanText(server.id) ?? managementServerTitle(server)}`,
      kind: 'loginRecord' as const,
      meta: cleanTextList([
        managementServerKindLabel(server.kind),
        formatDateTime(server.lastSeenAt),
        loginIpText(managementServerIp(server))
      ]).join(' · '),
      searchText: cleanTextList([
        managementServerTitle(server),
        managementServerKindLabel(server.kind),
        server.lastSeenAt,
        server.ip,
        server.lastSeenIp,
        server.registeredIp
      ]).join(' '),
      title: `${managementServerTitle(server)} 心跳`
    }))
  ]
  if (InteractionList != null) {
    return react.createElement(
      'section',
      { className: 'oneworks-relay__profile-section' },
      react.createElement(InteractionList, {
        border: 'borderless',
        className: 'oneworks-relay__host-interaction-list oneworks-relay__device-login-list',
        emptyText: rows.length === 0 ? '暂无登录记录' : '没有匹配的登录记录',
        iconSize: 18,
        items: rows,
        padding: 'none',
        search: {
          onChange: onFilterChange,
          placeholder: '搜索登录记录、服务或 IP',
          value: filter
        },
        mode: 'resource'
      })
    )
  }

  const visibleRows = rows.filter(row => matchesNativeSearch([row.title, row.meta, row.searchText], normalizedFilter))
  return react.createElement(
    'section',
    { className: 'oneworks-relay__profile-section' },
    renderSearchInput(react, view, {
      className: adminListSurfaceClassNames.nativeSearch,
      onChange: onFilterChange,
      placeholder: '搜索登录记录、服务或 IP',
      value: filter
    }),
    react.createElement(
      NativeList,
      { react },
      ...(visibleRows.length === 0
        ? [react.createElement(NativeEmpty, { key: 'empty', react, text: '没有匹配的登录记录' })]
        : visibleRows.map(row =>
          react.createElement(
            'div',
            {
              className: adminListSurfaceClassNames.nativeRow,
              key: row.key,
              style: {
                '--relay-admin-list-native-row-columns':
                  'var(--relay-admin-list-native-icon-size, var(--app-chrome-icon-size, 18px)) minmax(0, 1fr)'
              }
            },
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeIcon },
              renderIcon(react, view, typeof row.icon === 'string' ? row.icon : 'login')
            ),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeMain },
              react.createElement('span', { className: adminListSurfaceClassNames.nativeTitle }, row.title),
              react.createElement('span', { className: adminListSurfaceClassNames.nativeMeta }, row.meta)
            )
          )
        ))
    )
  )
}

const TeamsPanel = (props: {
  accountKey: string
  ctx: PluginClientContext
  profile: RelayProfileStatus | null
  react: PluginReactHost
  view?: PluginViewContext
}) => {
  const { accountKey, ctx, profile, react, view } = props
  const [filter, setFilter] = react.useState('')
  const teams = profile?.teams ?? []
  const InteractionList = view?.ui?.InteractionList
  const teamItems: RelayTeamInteractionItem[] = teams.map((team) => {
    const teamId = cleanText(team.id) ?? ''
    const name = teamDisplayName(team)
    return {
      avatar: {
        alt: name,
        fallback: getAvatarInitials(name),
        src: cleanText(team.avatarUrl)
      },
      kind: 'team',
      key: `team:${teamId || name}`,
      searchText: name,
      team,
      teamId,
      title: name,
      tooltip: name
    }
  })

  if (InteractionList != null) {
    return react.createElement(
      'section',
      { className: 'oneworks-relay__profile-section' },
      react.createElement(InteractionList, {
        border: 'borderless',
        className: 'oneworks-relay__host-interaction-list oneworks-relay__team-list',
        emptyText: teams.length === 0 ? '暂无团队' : '没有匹配的团队',
        iconSize: 18,
        items: teamItems,
        padding: 'none',
        search: {
          onChange: setFilter,
          placeholder: '搜索团队名称',
          value: filter
        },
        mode: 'resource',
        onSelect: (item: RelayTeamInteractionItem) => {
          if (item.teamId === '') return
          navigateTo(
            ctx.scope,
            routePath(ctx.scope, {
              accountKey,
              page: 'team',
              tab: 'overview',
              teamId: item.teamId
            })
          )
        }
      })
    )
  }

  const normalizedFilter = filter.trim().toLowerCase()
  const visibleTeams = normalizedFilter === ''
    ? teams
    : teams.filter(team =>
      matchesNativeSearch(
        [
          teamDisplayName(team)
        ],
        normalizedFilter
      )
    )
  return react.createElement(
    'section',
    { className: 'oneworks-relay__profile-section' },
    renderSearchInput(react, view, {
      className: adminListSurfaceClassNames.nativeSearch,
      onChange: setFilter,
      placeholder: '搜索团队名称',
      value: filter
    }),
    react.createElement(
      NativeList,
      { react },
      ...(visibleTeams.length === 0
        ? [
          react.createElement(NativeEmpty, {
            key: 'empty',
            react,
            text: teams.length === 0 ? '暂无团队' : '没有匹配的团队'
          })
        ]
        : visibleTeams.map(team => {
          const teamId = cleanText(team.id) ?? ''
          const name = teamDisplayName(team)
          return react.createElement(
            'div',
            {
              className: adminListSurfaceClassNames.nativeRow,
              key: teamId || name,
              style: {
                '--relay-admin-list-native-row-columns':
                  'var(--relay-admin-list-native-icon-size, var(--app-chrome-icon-size, 18px)) minmax(0, 1fr) var(--relay-admin-list-native-icon-size, var(--app-chrome-icon-size, 18px))'
              }
            },
            renderAvatar(react, { avatarUrl: team.avatarUrl, className: adminListSurfaceClassNames.nativeIcon, name }),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeMain },
              react.createElement('button', {
                className: `oneworks-relay__link-button ${adminListSurfaceClassNames.nativeTitle}`,
                onClick: () =>
                  navigateTo(
                    ctx.scope,
                    routePath(ctx.scope, {
                      accountKey,
                      page: 'team',
                      tab: 'overview',
                      teamId
                    })
                  ),
                type: 'button'
              }, name)
            ),
            react.createElement(
              'span',
              { className: adminListSurfaceClassNames.nativeActions },
              renderIcon(react, view, 'chevron_right')
            )
          )
        }))
    )
  )
}

const SecurityPanel = (props: {
  accountKey: string
  ctx: PluginClientContext
  onChanged: () => void
  profile: RelayProfileStatus | null
  react: PluginReactHost
  view?: PluginViewContext
}) => {
  const { accountKey, ctx, onChanged, profile, react, view } = props
  const [passwordOpen, setPasswordOpen] = react.useState(false)
  const [currentPassword, setCurrentPassword] = react.useState('')
  const [newPassword, setNewPassword] = react.useState('')
  const security = profile?.security
  const rows = [
    {
      action: passwordOpen
        ? react.createElement(
          'span',
          { className: adminListSurfaceClassNames.nativeActions },
          renderInput(react, view, {
            onChange: setCurrentPassword,
            placeholder: '当前密码',
            type: 'password',
            value: currentPassword
          }),
          renderInput(react, view, {
            onChange: setNewPassword,
            placeholder: '新密码',
            type: 'password',
            value: newPassword
          }),
          renderButton(react, view, {
            icon: 'check',
            label: '保存密码',
            onClick: () => {
              void requestJson(ctx, 'profile/password', {
                accountKey,
                currentPassword,
                newPassword
              }).then(() => {
                setPasswordOpen(false)
                setCurrentPassword('')
                setNewPassword('')
                onChanged()
              })
            }
          }),
          renderButton(react, view, {
            icon: 'close',
            label: '取消',
            onClick: () => setPasswordOpen(false)
          })
        )
        : react.createElement(
          'span',
          { className: adminListSurfaceClassNames.nativeActions },
          renderButton(react, view, {
            icon: 'edit',
            label: '修改密码',
            onClick: () => setPasswordOpen(true)
          })
        ),
      icon: 'password',
      meta: security?.password?.enabled === true ? '已启用密码登录' : '未设置密码',
      title: '密码管理'
    },
    {
      icon: 'passkey',
      meta: security?.passkeys?.enabled === true ? `${security.passkeys.count ?? 0} 个 Passkey` : '暂未启用',
      title: 'Passkey 登录'
    },
    {
      icon: 'verified_user',
      meta: security?.twoFactor?.enabled === true ? '已启用' : '暂未启用',
      title: '双因素认证'
    },
    {
      action: react.createElement(
        'span',
        { className: adminListSurfaceClassNames.nativeActions },
        renderButton(react, view, {
          danger: true,
          icon: 'delete_forever',
          label: '删除账号',
          onClick: () => {
            void requestJson(ctx, 'profile/account', { accountKey }, 'DELETE').then(() => {
              navigateTo(ctx.scope, routePath(ctx.scope, { page: 'accounts' }))
            })
          }
        })
      ),
      danger: true,
      icon: 'delete_forever',
      meta: '删除远端账号并清除本地登录态',
      title: '删除账号'
    }
  ]
  return react.createElement(
    'section',
    { className: 'oneworks-relay__profile-section' },
    react.createElement(
      NativeList,
      { react },
      ...rows.map(row =>
        react.createElement(
          'div',
          {
            className: adminListSurfaceClassNames.nativeRow,
            'data-danger': row.danger === true ? 'true' : undefined,
            key: row.title
          },
          react.createElement(
            'span',
            { className: adminListSurfaceClassNames.nativeIcon },
            renderIcon(react, view, row.icon)
          ),
          react.createElement(
            'span',
            { className: adminListSurfaceClassNames.nativeMain },
            react.createElement('span', { className: adminListSurfaceClassNames.nativeTitle }, row.title),
            react.createElement('span', { className: adminListSurfaceClassNames.nativeMeta }, row.meta)
          ),
          row.action ?? react.createElement('span', { className: adminListSurfaceClassNames.nativeActions })
        )
      )
    )
  )
}

const MessagesPage = (props: {
  profile: RelayProfileStatus | null
  react: PluginReactHost
  view?: PluginViewContext
}) => {
  const { profile, react, view } = props
  const messages = [
    ...(profile?.messages ?? []).map(message => ({
      body: cleanText(message.body) ?? '-',
      createdAt: message.createdAt,
      icon: message.kind === 'announcement' ? 'campaign' : 'person',
      meta: cleanTextList([
        message.kind === 'personal' ? '个人通知' : message.kind === 'announcement' ? '公告' : '系统',
        message.createdBy?.name,
        message.audience?.team?.name
      ]).join(' · '),
      status: message.kind === 'personal' ? '个人' : message.kind === 'announcement' ? '公告' : '系统',
      title: cleanText(message.title) ?? '消息'
    })),
    ...(profile?.invitations ?? []).map(invitation => ({
      body: `${cleanText(invitation.inviter?.name) ?? '管理员'} 邀请你加入团队。`,
      createdAt: invitation.createdAt,
      icon: 'group_add',
      meta: cleanTextList(['团队邀请', invitation.teamName, invitation.status]).join(' · '),
      status: cleanText(invitation.status) ?? '邀请',
      title: cleanText(invitation.teamName) == null ? '团队邀请' : `${invitation.teamName} 邀请`
    }))
  ]
  return react.createElement(
    'main',
    { className: 'oneworks-relay' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__shell' },
      react.createElement(
        'section',
        { className: 'oneworks-relay__surface' },
        react.createElement(
          'section',
          { className: 'oneworks-relay__messages relay-message-center' },
          messages.length === 0
            ? react.createElement('div', { className: 'relay-message-center__empty' }, '暂无消息')
            : react.createElement(
              'div',
              { className: 'relay-message-center__list' },
              ...messages.map((message, index) =>
                react.createElement(
                  'article',
                  { className: 'relay-message-center__item', key: `${message.title}-${index}` },
                  react.createElement(
                    'span',
                    { className: 'relay-message-center__item-icon' },
                    renderIcon(react, view, message.icon)
                  ),
                  react.createElement(
                    'div',
                    { className: 'relay-message-center__item-copy' },
                    react.createElement('h4', null, message.title),
                    react.createElement('p', null, message.body),
                    react.createElement('span', { className: 'relay-message-center__item-meta' }, message.meta)
                  ),
                  react.createElement(
                    'div',
                    { className: 'relay-message-center__item-side' },
                    react.createElement('span', { className: 'relay-message-center__status' }, message.status),
                    react.createElement('time', null, formatDateTime(message.createdAt))
                  )
                )
              )
            )
        )
      )
    )
  )
}

const AccountsPage = (props: {
  ctx: PluginClientContext
  onChanged: () => void
  react: PluginReactHost
  status: RelayStatus | null
  view?: PluginViewContext
}) => {
  const { ctx, onChanged, react, status, view } = props
  const [filter, setFilter] = react.useState('')
  const accounts = status?.accounts ?? []
  const servers = getServers(status)
  const groups = groupAccountsByServer(accounts, servers)
  const showGroups = groups.length > 1
  const launcherSurface = isLauncherSurface(view)
  const launcherSearchValue = launcherSurface ? (cleanText(view?.host?.launcherSearch?.value) ?? '') : ''
  const searchValue = launcherSurface ? launcherSearchValue : filter
  const InteractionList = view?.ui?.InteractionList
  const items = launcherSurface
    ? showGroups
      ? groups.map(group => buildServerAccountInteractionItem(group, servers))
      : accounts.map(account => buildLauncherAccountInteractionItem(account, servers, false))
    : showGroups
    ? groups.map(group => buildServerAccountInteractionItem(group, servers))
    : accounts.map(account => buildAccountInteractionItem(account, servers))
  return react.createElement(
    'main',
    { className: 'oneworks-relay' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__shell' },
      react.createElement(
        'section',
        { className: 'oneworks-relay__surface' },
        react.createElement(
          'section',
          {
            className: [
              'oneworks-relay__profile oneworks-relay__profile--accounts',
              launcherSurface ? 'oneworks-relay__profile--launcher' : ''
            ].filter(Boolean).join(' ')
          },
          InteractionList == null
            ? react.createElement('div', { className: 'oneworks-relay__empty' }, '标准账号列表组件不可用')
            : react.createElement(InteractionList, {
              actionDisplay: launcherSurface ? undefined : 'inline',
              actions: launcherSurface ? undefined : getAccountInteractionActions(ctx, onChanged),
              border: 'borderless',
              className: 'oneworks-relay__host-interaction-list',
              descriptionPlacement: launcherSurface ? undefined : 'content',
              emptyText: accounts.length === 0 ? '暂无登录账号' : '没有匹配账号',
              iconSize: launcherSurface ? undefined : 18,
              inlineActionLimit: launcherSurface ? undefined : 2,
              items,
              padding: launcherSurface ? undefined : 'none',
              search: {
                onChange: launcherSurface ? () => undefined : setFilter,
                placeholder: launcherSurface
                  ? '搜索账号'
                  : showGroups
                  ? '搜索账号、邮箱、服务或状态'
                  : '搜索账号',
                renderInput: !launcherSurface,
                value: searchValue
              },
              splitActionHover: launcherSurface ? undefined : true,
              mode: launcherSurface ? 'launcher' : 'grouped',
              onSelect: (item: RelayAccountInteractionItem) => {
                if (item.kind !== 'account' || item.accountKey == null) return
                navigateTo(
                  ctx.scope,
                  routePath(ctx.scope, {
                    accountKey: item.accountKey,
                    page: 'profile',
                    tab: 'account'
                  })
                )
              }
            })
        )
      )
    )
  )
}

const buildLauncherAccountInteractionItem = (
  account: RelayAuthAccount,
  servers: RelayServerStatus[],
  includeServerLabel: boolean
): RelayAccountInteractionItem => {
  const item = buildAccountInteractionItem(account, servers)
  const detailText = cleanTextList([
    accountSubtitle(account),
    includeServerLabel ? accountServerGroupLabel(account, servers) : undefined
  ]).join(' · ')
  return {
    ...item,
    description: undefined,
    meta: account.enabled === false ? '已禁用' : undefined,
    tooltip: detailText === '' ? item.title : `${item.title} · ${detailText}`
  }
}

const buildAccountInteractionItem = (
  account: RelayAuthAccount,
  servers: RelayServerStatus[]
): RelayAccountInteractionItem => {
  const accountKey = getAccountKey(account)
  const name = accountDisplayName(account)
  const subtitle = accountSubtitle(account)
  const server = findServerForAccount(account, servers)
  const serverLabel = accountServerGroupLabel(account, servers)
  return {
    account,
    accountKey,
    avatar: {
      alt: name,
      fallback: getAvatarInitials(name),
      src: cleanText(account.avatarUrl)
    },
    description: subtitle,
    disabled: account.enabled === false,
    kind: 'account',
    key: `account:${accountKey}`,
    searchText: cleanTextList([
      name,
      subtitle,
      account.email,
      account.loginId,
      account.userId,
      account.role,
      account.enabled === false ? 'disabled 禁用' : 'enabled 启用',
      serverLabel,
      serverAddress(server),
      account.serverAlias,
      account.serverUrl
    ]).join(' '),
    title: name,
    tooltip: subtitle === '' ? name : `${name} · ${subtitle}`
  }
}

const buildServerAccountInteractionItem = (
  group: { accounts: RelayAuthAccount[]; key: string; label: string; server?: RelayServerStatus },
  servers: RelayServerStatus[]
): RelayAccountInteractionItem => {
  const address = serverAddress(group.server)
  const children = group.accounts.map(account => buildAccountInteractionItem(account, servers))
  return {
    children,
    icon: serverGroupIcon(group),
    itemType: 'groupTitle',
    kind: 'server',
    key: `server:${group.key}`,
    searchText: cleanTextList([
      group.label,
      address,
      ...children.map(child => child.searchText)
    ]).join(' '),
    server: group.server,
    serverId: cleanText(group.server?.id) ?? group.key,
    title: group.label,
    tooltip: address === '' ? group.label : address
  }
}

const getAccountInteractionActions = (
  ctx: PluginClientContext,
  onChanged: () => void
) =>
(item: RelayAccountInteractionItem): Array<PluginHostInteractionListAction<RelayAccountInteractionItem>> => {
  if (item.kind === 'server') {
    return [{
      icon: 'login',
      key: 'login',
      label: '登录',
      onSelect: () => {
        navigateTo(
          ctx.scope,
          routePath(ctx.scope, {
            page: 'login',
            serverId: item.serverId
          })
        )
      }
    }]
  }
  const accountKey = item.accountKey
  if (accountKey == null || accountKey === '') return []
  const enabled = item.account?.enabled !== false
  return [
    {
      icon: enabled ? 'toggle_off' : 'toggle_on',
      key: enabled ? 'disable' : 'enable',
      label: enabled ? '禁用' : '启用',
      onSelect: () => {
        void requestJson(ctx, enabled ? 'users/disable' : 'users/enable', { accountKey }).then(onChanged)
      }
    },
    {
      danger: true,
      icon: 'delete',
      key: 'delete-local',
      label: '删除本机数据',
      onSelect: () => {
        void requestJson(ctx, 'users/delete-local', { accountKey }).then(onChanged)
      }
    }
  ]
}

interface RelayRememberedLogin {
  avatarUrl?: string
  email: string
  name: string
  provider: string
  serverUrl: string
  updatedAt: string
}

const relayRememberedLoginStorageKey = 'oneworks.relay.login.accounts.v1'

const readRelayRememberedLogins = (): RelayRememberedLogin[] => {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(relayRememberedLoginStorageKey) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.flatMap(item => {
      if (!isRecord(item)) return []
      const email = cleanText(item.email)
      const name = cleanText(item.name)
      const provider = cleanText(item.provider)
      const serverUrl = cleanText(item.serverUrl)
      const updatedAt = cleanText(item.updatedAt)
      if (email == null || name == null || provider == null || serverUrl == null || updatedAt == null) return []
      return [{ avatarUrl: cleanText(item.avatarUrl), email, name, provider, serverUrl, updatedAt }]
    })
  } catch {
    return []
  }
}

const writeRelayRememberedLogins = (accounts: RelayRememberedLogin[]) => {
  try {
    globalThis.localStorage?.setItem(relayRememberedLoginStorageKey, JSON.stringify(accounts.slice(0, 12)))
  } catch {
    // Login still succeeds when browser storage is unavailable.
  }
}

const LoginPage = (props: {
  ctx: PluginClientContext
  onLoginComplete?: () => Promise<void> | void
  react: PluginReactHost
  route: Extract<RelayHomeRoute, { page: 'login' }>
  serverName: string
  view?: PluginViewContext
}) => {
  const { ctx, react, route, serverName, view } = props
  const launcherSurface = isLauncherSurface(view)
  const [login, setLogin] = react.useState<Awaited<ReturnType<typeof createRelayLoginOptions>> | null>(null)
  const [fallbackLoginUrl, setFallbackLoginUrl] = react.useState('')
  const [loginMethod, setLoginMethod] = react.useState<RelayLoginMethod>('password')
  const [loginId, setLoginId] = react.useState('')
  const [password, setPassword] = react.useState('')
  const [confirmPassword, setConfirmPassword] = react.useState('')
  const [inviteCode, setInviteCode] = react.useState('')
  const [completingRegistration, setCompletingRegistration] = react.useState(false)
  const [verificationCode, setVerificationCode] = react.useState('')
  const [rememberAccount, setRememberAccount] = react.useState(true)
  const [rememberedAccounts, setRememberedAccounts] = react.useState<RelayRememberedLogin[]>(readRelayRememberedLogins)
  const [error, setError] = react.useState<string | null>(null)
  const [loading, setLoading] = react.useState(true)
  const [submitting, setSubmitting] = react.useState(false)
  const [sendingCode, setSendingCode] = react.useState(false)
  react.useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)
    setLogin(null)
    setFallbackLoginUrl('')
    setCompletingRegistration(false)
    setConfirmPassword('')
    setInviteCode('')
    void createRelayLoginOptions(ctx, {
      forcePluginHomeRedirect: true,
      serverId: route.serverId
    }).then(result => {
      if (!disposed) {
        setLogin(result)
        const enabledMethods = result.options.loginMethods.enabled
        setLoginMethod(
          enabledMethods.includes(result.options.loginMethods.default)
            ? result.options.loginMethods.default
            : enabledMethods[0] ?? 'password'
        )
        setLoading(false)
      }
    }).catch(errorValue => {
      if (!disposed) {
        setError(toErrorMessage(errorValue))
        if (errorValue instanceof RelayLoginOptionsUnavailableError) {
          setFallbackLoginUrl(errorValue.loginUrl)
        }
        setLoading(false)
      }
    })
    return () => {
      disposed = true
    }
  }, [ctx, route.serverId])

  const openLoginDestination = (destination: string) => {
    const desktopApi = (window as typeof window & {
      oneworksDesktop?: { openExternalUrl?: (url: string) => Promise<void> }
    }).oneworksDesktop
    if (desktopApi?.openExternalUrl != null) {
      void desktopApi.openExternalUrl(destination).catch(openError => setError(toErrorMessage(openError)))
      return
    }
    window.location.href = destination
  }

  const openHostedLogin = (method?: RelayLoginMethod) => {
    const target = cleanText(login?.loginUrl) ?? cleanText(fallbackLoginUrl)
    if (target == null) return
    const url = new URL(target)
    if (method != null) url.searchParams.set('login_method', method)
    openLoginDestination(url.toString())
  }

  const finishLogin = async (payload: Record<string, unknown>, provider: string) => {
    const token = cleanText(payload.token)
    if (token == null) throw new Error('Relay 登录响应缺少 token。')
    await completeRelayLoginCallback(ctx, { serverId: login?.serverId, token }, props.onLoginComplete)
    if (rememberAccount && login != null) {
      const user = isRecord(payload.user) ? payload.user : {}
      const email = cleanText(user.email) ?? loginId.trim()
      if (email !== '') {
        const account: RelayRememberedLogin = {
          avatarUrl: cleanText(user.avatarUrl),
          email,
          name: cleanText(user.name) ?? email,
          provider,
          serverUrl: login.remoteBaseUrl,
          updatedAt: new Date().toISOString()
        }
        setRememberedAccounts(current => {
          const next = [
            account,
            ...current.filter(item =>
              !(
                item.serverUrl === account.serverUrl &&
                item.provider === account.provider &&
                item.email === account.email
              )
            )
          ].slice(0, 12)
          writeRelayRememberedLogins(next)
          return next
        })
      }
    }
    navigateTo(ctx.scope, routePath(ctx.scope, { page: 'accounts' }))
  }

  const submitLogin = async () => {
    if (login == null || submitting) return
    setError(null)
    if (loginMethod === 'passkey') {
      openHostedLogin('passkey')
      return
    }
    if (loginId.trim() === '') {
      setError('请输入邮箱或账号名。')
      return
    }
    if (loginMethod === 'password' && password === '') {
      setError('请输入密码。')
      return
    }
    if (loginMethod === 'password' && completingRegistration) {
      if (password.length < 8) {
        setError(login.options.messages.passwordMinLength)
        return
      }
      if (confirmPassword === '') {
        setError(login.options.messages.confirmPasswordRequired)
        return
      }
      if (confirmPassword !== password) {
        setError(login.options.messages.passwordMismatch)
        return
      }
      if (inviteCode.trim() === '') {
        setError(login.options.messages.inviteRequired)
        return
      }
    }
    if (loginMethod === 'verification_code' && verificationCode.trim() === '') {
      setError('请输入验证码。')
      return
    }
    setSubmitting(true)
    try {
      const options = login.options
      const registering = loginMethod === 'password' && completingRegistration
      const payload = await postRelayLoginJson(
        ctx,
        login.serverId,
        loginMethod === 'password'
          ? registering ? 'invite-login' : 'password-login'
          : 'email-code-login',
        loginMethod === 'password'
          ? {
            email: loginId.trim(),
            inviteCode: registering ? inviteCode.trim() : undefined,
            loginId: loginId.trim(),
            password
          }
          : {
            code: verificationCode.trim(),
            email: loginId.trim(),
            loginId: loginId.trim()
          }
      )
      await finishLogin(payload, loginMethod)
    } catch (loginError) {
      const message = toErrorMessage(loginError)
      if (
        loginMethod === 'password' &&
        loginError instanceof RelayLoginRequestError &&
        loginError.code === 'registration_required'
      ) {
        setCompletingRegistration(true)
        setConfirmPassword('')
        setInviteCode('')
        setError(login.options.messages.inviteRequired)
      } else {
        setError(message === 'Invalid email or password.' ? login.options.messages.invalidCredentials : message)
      }
      setSubmitting(false)
    }
  }

  const sendVerificationCode = async () => {
    if (login == null || sendingCode) return
    if (loginId.trim() === '') {
      setError('请输入邮箱或账号名。')
      return
    }
    setError(null)
    setSendingCode(true)
    try {
      await postRelayLoginJson(ctx, login.serverId, 'email-verification-send', {
        email: loginId.trim(),
        loginId: loginId.trim(),
        locale: login.options.locale,
        purpose: 'login'
      })
      ctx.notifications?.show?.({ level: 'success', title: '验证码已发送' })
    } catch (sendError) {
      setError(toErrorMessage(sendError))
    } finally {
      setSendingCode(false)
    }
  }

  const loginMethodLabel = (method: RelayLoginMethod) => {
    const messages = login?.options.messages
    if (method === 'passkey') return messages?.useLoginMethodPasskey ?? 'Passkey'
    if (method === 'verification_code') return messages?.useLoginMethodVerificationCode ?? '验证码'
    return messages?.useLoginMethodPassword ?? '密码'
  }
  const loginMethodIcon = (method: RelayLoginMethod) => {
    if (method === 'passkey') return 'passkey'
    if (method === 'verification_code') return 'mark_email_read'
    return 'password'
  }
  const renderProviderIcon = (provider: RelayLoginProviderOption): PluginReactNode => {
    if (provider.icon === 'google') {
      return react.createElement(
        'span',
        { 'aria-hidden': 'true', className: 'oneworks-relay__login-provider-brand-icon' },
        react.createElement(
          'svg',
          { focusable: 'false', viewBox: '0 0 48 48' },
          react.createElement('path', {
            d: 'M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917Z',
            fill: '#FFC107'
          }),
          react.createElement('path', {
            d: 'm6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691Z',
            fill: '#FF3D00'
          }),
          react.createElement('path', {
            d: 'M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44Z',
            fill: '#4CAF50'
          }),
          react.createElement('path', {
            d: 'M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917Z',
            fill: '#1976D2'
          })
        )
      )
    }
    if (provider.icon === 'github') {
      return react.createElement(
        'span',
        { 'aria-hidden': 'true', className: 'oneworks-relay__login-provider-brand-icon' },
        react.createElement(
          'svg',
          { focusable: 'false', viewBox: '0 0 98 96' },
          react.createElement('path', {
            d: 'M48.9 0C21.9 0 0 21.9 0 48.9c0 21.6 14 39.9 33.4 46.4 2.4.5 3.3-1.1 3.3-2.4 0-1.2 0-5 0-9.1-13.6 3-16.5-5.8-16.5-5.8-2.2-5.7-5.4-7.2-5.4-7.2-4.4-3 .3-3 .3-3 4.9.3 7.5 5 7.5 5 4.3 7.4 11.3 5.3 14.1 4 .4-3.1 1.7-5.3 3.1-6.5-10.8-1.2-22.2-5.4-22.2-24.2 0-5.3 1.9-9.7 5-13.1-.5-1.2-2.2-6.2.5-12.9 0 0 4.1-1.3 13.4 5 3.9-1.1 8.1-1.6 12.3-1.6s8.4.6 12.3 1.6c9.3-6.3 13.4-5 13.4-5 2.7 6.7 1 11.7.5 12.9 3.1 3.4 5 7.8 5 13.1 0 18.8-11.4 22.9-22.3 24.2 1.8 1.5 3.3 4.5 3.3 9.1 0 6.5-.1 11.8-.1 13.4 0 1.3.9 2.8 3.4 2.4 19.4-6.5 33.4-24.8 33.4-46.4C97.8 21.9 75.9 0 48.9 0Z'
          })
        )
      )
    }
    return renderIcon(react, view, provider.icon === 'feishu' ? 'workspaces' : 'login', { size: 18 })
  }
  const updateLoginMethod = (method: RelayLoginMethod) => {
    setError(null)
    setCompletingRegistration(false)
    setConfirmPassword('')
    setInviteCode('')
    setLoginMethod(method)
  }

  const renderLoginButton = (input: {
    className: string
    disabled?: boolean
    icon: string
    iconNode?: PluginReactNode
    key?: string
    label: string
    onClick?: () => void
    primary?: boolean
    type?: 'button' | 'submit'
  }) =>
    react.createElement(
      'button',
      {
        'aria-label': input.label,
        className: input.className,
        'data-primary': input.primary === true ? 'true' : undefined,
        disabled: input.disabled,
        key: input.key,
        onClick: input.onClick,
        type: input.type ?? 'button'
      },
      input.iconNode ?? renderIcon(react, view, input.icon, { size: 18 }),
      react.createElement('span', null, input.label)
    )

  const options = login?.options
  const rememberRow = options == null
    ? null
    : react.createElement(
      'label',
      { className: 'oneworks-relay__login-remember' },
      react.createElement('input', {
        checked: rememberAccount,
        onChange: (event: Event) => setRememberAccount((event.target as HTMLInputElement).checked),
        type: 'checkbox'
      }),
      react.createElement('span', null, options.messages.rememberAccount)
    )
  const renderLoginField = (icon: string, control: PluginReactNode) =>
    react.createElement(
      'div',
      { className: 'oneworks-relay__login-field' },
      react.createElement(
        'span',
        { 'aria-hidden': 'true', className: 'oneworks-relay__login-field-icon' },
        renderIcon(react, view, icon, { size: 18 })
      ),
      control
    )

  const methodForm = options == null
    ? null
    : loginMethod === 'passkey'
    ? react.createElement(
      'section',
      { className: 'oneworks-relay__login-form oneworks-relay__login-section' },
      react.createElement(
        'strong',
        { className: 'oneworks-relay__login-section-title' },
        options.messages.passkeyTitle
      ),
      react.createElement(
        'p',
        { className: 'oneworks-relay__login-note' },
        'Passkey 需要在 Relay 服务域名完成浏览器安全校验。继续后可选择或登记凭证，完成后会回到当前 OneWorks 页面。'
      ),
      error == null
        ? null
        : react.createElement('div', { className: 'oneworks-relay__login-error', role: 'alert' }, error),
      renderLoginButton({
        className: 'oneworks-relay__login-submit',
        icon: 'passkey',
        label: '使用 Passkey 继续',
        onClick: () => openHostedLogin('passkey'),
        primary: true
      })
    )
    : react.createElement(
      'form',
      {
        className: 'oneworks-relay__login-form oneworks-relay__login-section',
        onSubmit: (event: Event) => {
          event.preventDefault()
          void submitLogin()
        }
      },
      renderLoginField(
        'person',
        renderInput(react, view, {
          ariaLabel: '邮箱或账号名',
          autoFocus: true,
          onChange: setLoginId,
          placeholder: options.messages.emailPlaceholder,
          value: loginId
        })
      ),
      loginMethod === 'password'
        ? react.createElement(
          react.Fragment,
          null,
          renderLoginField(
            'password',
            renderInput(react, view, {
              ariaLabel: '密码',
              onChange: setPassword,
              placeholder: options.messages.passwordPlaceholder,
              type: 'password',
              value: password
            })
          ),
          completingRegistration
            ? react.createElement(
              react.Fragment,
              null,
              renderLoginField(
                'password',
                renderInput(react, view, {
                  ariaLabel: '确认密码',
                  onChange: setConfirmPassword,
                  placeholder: options.messages.confirmPasswordPlaceholder,
                  type: 'password',
                  value: confirmPassword
                })
              ),
              renderLoginField(
                'key',
                renderInput(react, view, {
                  ariaLabel: '邀请码',
                  onChange: setInviteCode,
                  placeholder: options.messages.inviteCodePlaceholder,
                  value: inviteCode
                })
              )
            )
            : null
        )
        : renderLoginField(
          'pin',
          react.createElement(
            'div',
            { className: 'oneworks-relay__login-code-row' },
            renderInput(react, view, {
              ariaLabel: '验证码',
              onChange: setVerificationCode,
              placeholder: options.messages.passkeyCodePlaceholder,
              value: verificationCode
            }),
            renderLoginButton({
              className: 'oneworks-relay__login-code-button',
              disabled: sendingCode,
              icon: 'send',
              label: sendingCode ? '发送中...' : options.messages.passkeySendCode,
              onClick: () => void sendVerificationCode()
            })
          )
        ),
      rememberRow,
      error == null
        ? null
        : react.createElement('div', { className: 'oneworks-relay__login-error', role: 'alert' }, error),
      renderLoginButton({
        className: 'oneworks-relay__login-submit',
        disabled: submitting,
        icon: loginMethod === 'password' ? 'login' : 'fact_check',
        label: submitting
          ? options.messages.signingIn
          : completingRegistration
          ? options.messages.continueWithRegistration
          : options.messages.signInMode,
        primary: true,
        type: 'submit'
      })
    )

  const alternateLoginMethods = options?.loginMethods.enabled.filter(method => method !== loginMethod) ?? []
  const methodSwitcher = options == null || alternateLoginMethods.length === 0
    ? null
    : react.createElement(
      'section',
      { 'aria-label': '切换登录方式', className: 'oneworks-relay__login-method-switcher' },
      ...alternateLoginMethods.map(method =>
        renderLoginButton({
          className: 'oneworks-relay__login-method-switch-button',
          icon: loginMethodIcon(method),
          key: method,
          label: loginMethodLabel(method),
          onClick: () => updateLoginMethod(method)
        })
      )
    )

  const currentRememberedAccounts = login == null
    ? []
    : rememberedAccounts.filter(account => account.serverUrl === login.remoteBaseUrl)
  const selectRememberedAccount = (account: RelayRememberedLogin) => {
    setError(null)
    setLoginId(account.email)
    if (
      (account.provider === 'password' || account.provider === 'passkey' || account.provider === 'verification_code') &&
      options?.loginMethods.enabled.includes(account.provider)
    ) {
      updateLoginMethod(account.provider)
      return
    }
    const provider = options?.providers.find(item => item.id === account.provider)
    if (provider != null) {
      const url = new URL(provider.startUrl)
      url.searchParams.set('login_hint', account.email)
      window.location.href = url.toString()
    }
  }

  return react.createElement(
    'main',
    {
      className: `oneworks-relay oneworks-relay--login-route${launcherSurface ? ' oneworks-relay--launcher-login' : ''}`
    },
    react.createElement(
      'div',
      { className: 'oneworks-relay__shell' },
      react.createElement(
        'section',
        { className: 'oneworks-relay__surface' },
        error != null &&
          login == null && !loading
          ? react.createElement(
            'div',
            { className: 'oneworks-relay__login-native oneworks-relay__login-native--error' },
            renderIcon(react, view, 'warning', { size: 28 }),
            react.createElement('strong', null, `无法读取 ${serverName} 登录能力`),
            react.createElement('span', null, error),
            fallbackLoginUrl === ''
              ? null
              : renderLoginButton({
                className: 'oneworks-relay__login-submit',
                icon: 'open_in_new',
                label: `打开 ${serverName} 兼容登录页`,
                onClick: () => openHostedLogin(),
                primary: true
              })
          )
          : loading || options == null
          ? react.createElement(
            'div',
            { className: 'oneworks-relay__login-loading' },
            renderIcon(react, view, 'progress_activity', { size: 18 }),
            `正在读取 ${serverName} 登录能力...`
          )
          : react.createElement(
            'section',
            { className: 'oneworks-relay__login-native' },
            currentRememberedAccounts.length === 0
              ? null
              : react.createElement(
                'section',
                { className: 'oneworks-relay__login-accounts oneworks-relay__login-section' },
                react.createElement(
                  'strong',
                  { className: 'oneworks-relay__login-section-title' },
                  options.messages.recentAccounts
                ),
                ...currentRememberedAccounts.map(account =>
                  react.createElement(
                    'button',
                    {
                      className: 'oneworks-relay__login-account-button',
                      key: `${account.provider}:${account.email}`,
                      onClick: () => selectRememberedAccount(account),
                      type: 'button'
                    },
                    react.createElement(
                      'span',
                      { className: 'oneworks-relay__login-account-avatar' },
                      account.name.slice(0, 1).toUpperCase()
                    ),
                    react.createElement(
                      'span',
                      { className: 'oneworks-relay__login-account-copy' },
                      react.createElement('strong', null, account.name),
                      react.createElement('small', null, `${account.provider} · ${account.email}`)
                    )
                  )
                )
              ),
            methodForm,
            methodSwitcher,
            options.providers.length === 0
              ? null
              : react.createElement(
                'section',
                { className: 'oneworks-relay__login-sso oneworks-relay__login-section' },
                react.createElement(
                  'div',
                  { className: 'oneworks-relay__login-provider-grid' },
                  ...options.providers.map(provider =>
                    renderLoginButton({
                      className: 'oneworks-relay__login-provider-button',
                      icon: 'login',
                      iconNode: renderProviderIcon(provider),
                      key: provider.id,
                      label: provider.label,
                      onClick: () => openLoginDestination(provider.startUrl)
                    })
                  )
                )
              ),
            react.createElement(
              'footer',
              { className: 'oneworks-relay__login-footer' },
              renderLoginButton({
                className: 'oneworks-relay__login-service-picker',
                icon: 'dns',
                label: '登录到其他服务器',
                onClick: () => navigateTo(ctx.scope, routePath(ctx.scope, { page: 'servers' }))
              }),
              react.createElement(
                'button',
                {
                  className: 'oneworks-relay__login-compatibility',
                  onClick: () => openHostedLogin(),
                  type: 'button'
                },
                '注册新账号或使用完整安全登录页'
              )
            )
          )
      )
    )
  )
}

const ServersPage = (props: {
  ctx: PluginClientContext
  onChanged: () => void
  react: PluginReactHost
  status: RelayStatus | null
  view?: PluginViewContext
}) => {
  const { ctx, onChanged, react, status, view } = props
  const servers = getServers(status)
  const [editingKey, setEditingKey] = react.useState('')
  const [draft, setDraft] = react.useState<ServerDraft>({ name: '', remoteBaseUrl: '' })
  const saveDraft = async () => {
    const update = view?.options?.update
    if (update == null) throw new Error('当前环境不支持保存服务器配置。')
    const nextOptions = buildRelayServerOptionsUpdate(view?.options?.value ?? ctx.options ?? {}, draft)
    await update(nextOptions)
    setEditingKey('')
    setDraft({ name: '', remoteBaseUrl: '' })
    onChanged()
  }
  return react.createElement(
    'main',
    { className: 'oneworks-relay' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__shell' },
      react.createElement(
        'section',
        { className: 'oneworks-relay__surface' },
        react.createElement(
          'section',
          { className: 'oneworks-relay__servers' },
          react.createElement(
            NativeList,
            { react },
            ...servers.map((server, index) => {
              const key = cleanText(server.id) ?? cleanText(server.remoteBaseUrl) ?? `server-${index}`
              const official = server.official === true || isOfficialServerId(cleanText(server.id))
              const editing = editingKey === key
              const title = serverDisplayName(server)
              const address = serverAddress(server)
              return react.createElement(
                'div',
                { className: adminListSurfaceClassNames.nativeRow, key, title: address },
                renderAvatar(react, {
                  className: adminListSurfaceClassNames.nativeIcon,
                  name: title,
                  state: 'server'
                }),
                editing
                  ? react.createElement(
                    'span',
                    { className: `oneworks-relay__server-editor ${adminListSurfaceClassNames.nativeMain}` },
                    renderInput(react, view, {
                      onChange: value => setDraft(current => ({ ...current, name: value })),
                      placeholder: '服务名称',
                      value: draft.name
                    }),
                    renderInput(react, view, {
                      onChange: value => setDraft(current => ({ ...current, remoteBaseUrl: value })),
                      placeholder: 'https://relay.example.com',
                      value: draft.remoteBaseUrl
                    })
                  )
                  : react.createElement(
                    'span',
                    { className: adminListSurfaceClassNames.nativeMain },
                    react.createElement('strong', { className: adminListSurfaceClassNames.nativeTitle }, title),
                    react.createElement('span', { className: adminListSurfaceClassNames.nativeMeta }, address)
                  ),
                react.createElement(
                  'span',
                  { className: adminListSurfaceClassNames.nativeActions },
                  editing
                    ? [
                      renderButton(react, view, {
                        icon: 'check',
                        key: 'save',
                        label: '保存服务器',
                        onClick: () => {
                          void saveDraft().catch(error =>
                            ctx.notifications?.show?.({
                              level: 'error',
                              title: toErrorMessage(error)
                            })
                          )
                        }
                      }),
                      renderButton(react, view, {
                        icon: 'close',
                        key: 'cancel',
                        label: '取消',
                        onClick: () => setEditingKey('')
                      })
                    ]
                    : [
                      renderButton(react, view, {
                        icon: 'login',
                        key: 'login',
                        label: '登录',
                        onClick: () =>
                          navigateTo(
                            ctx.scope,
                            routePath(ctx.scope, {
                              page: 'login',
                              serverId: key
                            })
                          )
                      }),
                      official ? null : renderButton(react, view, {
                        icon: 'edit',
                        key: 'edit',
                        label: '修改服务器',
                        onClick: () => {
                          setEditingKey(key)
                          setDraft({
                            id: cleanText(server.id),
                            name: cleanText(server.name) ?? '',
                            remoteBaseUrl: address
                          })
                        }
                      })
                    ]
                )
              )
            }),
            react.createElement(
              'div',
              { className: `${adminListSurfaceClassNames.nativeRow} oneworks-relay__server-management-form` },
              react.createElement(
                'span',
                { className: adminListSurfaceClassNames.nativeIcon, 'aria-hidden': 'true' },
                renderIcon(react, view, 'add_link', { size: 18 })
              ),
              react.createElement(
                'span',
                { className: `oneworks-relay__server-editor ${adminListSurfaceClassNames.nativeMain}` },
                renderInput(react, view, {
                  onChange: value => setDraft(current => ({ ...current, name: value })),
                  placeholder: '服务名称',
                  value: editingKey === '' ? draft.name : ''
                }),
                renderInput(react, view, {
                  onChange: value => setDraft(current => ({ ...current, remoteBaseUrl: value })),
                  placeholder: 'https://relay.example.com',
                  value: editingKey === '' ? draft.remoteBaseUrl : ''
                })
              ),
              react.createElement(
                'span',
                { className: adminListSurfaceClassNames.nativeActions },
                renderButton(react, view, {
                  disabled: editingKey !== '',
                  icon: 'check',
                  label: '加入服务器',
                  onClick: () => {
                    void saveDraft().catch(error =>
                      ctx.notifications?.show?.({
                        level: 'error',
                        title: toErrorMessage(error)
                      })
                    )
                  }
                }),
                renderButton(react, view, {
                  icon: 'close',
                  label: '清空',
                  onClick: () => setDraft({ name: '', remoteBaseUrl: '' })
                })
              )
            )
          )
        )
      )
    )
  )
}

const tokenEditorInitialState = (
  token: RelayProfileAccessToken | undefined,
  profile: RelayProfileStatus | null
): TokenEditorState => ({
  name: cleanText(token?.name) ?? '',
  permissionGroupIds: (token?.permissionGroupIds ?? []).join(', '),
  permissionGroupMode: token?.permissionGroupMode ?? 'all',
  scope: token?.scope ?? 'user',
  teamId: cleanText(token?.teamId) ?? cleanText(profile?.teams?.[0]?.id) ?? ''
})

const TokenEditorPage = (props: {
  accountKey: string
  ctx: PluginClientContext
  onChanged: () => void
  profile: RelayProfileStatus | null
  react: PluginReactHost
  tokenId: string
  view?: PluginViewContext
}) => {
  const { accountKey, ctx, onChanged, profile, react, tokenId, view } = props
  const isCreate = tokenId === 'new'
  const token = isCreate ? undefined : profile?.security?.accessTokens?.find(item => cleanText(item.id) === tokenId)
  const [form, setForm] = react.useState<TokenEditorState>(() => tokenEditorInitialState(token, profile))
  const [createdToken, setCreatedToken] = react.useState('')
  const [error, setError] = react.useState<string | null>(null)
  react.useEffect(() => {
    setForm(tokenEditorInitialState(token, profile))
    setCreatedToken('')
    setError(null)
  }, [profile, tokenId])
  const save = async () => {
    if (form.name.trim() === '') {
      setError('请输入令牌名称')
      return
    }
    if (form.scope === 'team' && form.teamId.trim() === '') {
      setError('请选择团队')
      return
    }
    const payload = {
      accountKey,
      name: form.name.trim(),
      permissionGroupIds: form.permissionGroupIds.split(',').map(item => item.trim()).filter(Boolean),
      permissionGroupMode: form.permissionGroupMode,
      scope: form.scope,
      teamId: form.scope === 'team' ? form.teamId : undefined
    }
    try {
      setError(null)
      const response = isCreate
        ? await requestJson<RelayProfileStatus>(ctx, 'profile/access-tokens', payload)
        : await requestJson<RelayProfileStatus>(
          ctx,
          `profile/access-tokens/${encodeURIComponent(tokenId)}`,
          payload,
          'PATCH'
        )
      const accessToken = cleanText(response.result?.accessToken)
      if (accessToken != null) setCreatedToken(accessToken)
      onChanged()
      if (!isCreate) navigateTo(ctx.scope, routePath(ctx.scope, { accountKey, page: 'profile', tab: 'tokens' }))
    } catch (saveError) {
      setError(toErrorMessage(saveError))
    }
  }
  const revoke = async () => {
    if (isCreate) return
    await requestJson(ctx, `profile/access-tokens/${encodeURIComponent(tokenId)}`, { accountKey }, 'DELETE')
    onChanged()
    navigateTo(ctx.scope, routePath(ctx.scope, { accountKey, page: 'profile', tab: 'tokens' }))
  }
  const scopeOptions = [
    { label: '用户级', value: 'user' },
    { label: '团队级', value: 'team' },
    { label: '平台级', value: 'platform' }
  ]
  const permissionModeOptions = [
    { label: '全部用户组', value: 'all' },
    { label: '指定用户组', value: 'custom' }
  ]
  return react.createElement(
    'main',
    { className: 'oneworks-relay' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__shell' },
      react.createElement(
        'section',
        { className: 'oneworks-relay__surface' },
        react.createElement(
          'section',
          { className: 'oneworks-relay__profile oneworks-relay__profile--token-detail' },
          error == null ? null : react.createElement('div', { className: 'oneworks-relay__config-error' }, error),
          createdToken === ''
            ? null
            : react.createElement(
              'div',
              { className: 'oneworks-relay__profile-section' },
              react.createElement('strong', null, '新令牌'),
              react.createElement('code', null, createdToken),
              renderButton(react, view, {
                icon: 'content_copy',
                label: '复制令牌',
                onClick: () => {
                  void navigator.clipboard?.writeText(createdToken)
                }
              })
            ),
          react.createElement(
            'div',
            { className: 'oneworks-relay__token-editor' },
            renderTokenEditorRow(
              react,
              view,
              '令牌类型',
              '用户级操作当前账号数据，团队级绑定一个团队，平台级使用平台用户组授权。',
              renderSelect(react, view, {
                onChange: value =>
                  setForm(current => ({
                    ...current,
                    scope: (Array.isArray(value) ? value[0] : value) as TokenEditorState['scope']
                  })),
                options: scopeOptions,
                value: form.scope
              })
            ),
            renderTokenEditorRow(
              react,
              view,
              '令牌名称',
              '用于区分 OpenAPI 调用来源。',
              renderInput(react, view, {
                onChange: value => setForm(current => ({ ...current, name: value })),
                placeholder: '令牌名称',
                value: form.name
              })
            ),
            form.scope === 'team'
              ? renderTokenEditorRow(
                react,
                view,
                '授权团队',
                '令牌只访问这个团队允许的资源。',
                renderSelect(react, view, {
                  onChange: value =>
                    setForm(current => ({
                      ...current,
                      teamId: Array.isArray(value) ? value[0] ?? '' : value
                    })),
                  options: (profile?.teams ?? []).map(team => ({
                    label: teamDisplayName(team),
                    value: cleanText(team.id) ?? ''
                  })),
                  value: form.teamId
                })
              )
              : null,
            renderTokenEditorRow(
              react,
              view,
              '权限范围',
              tokenPermissionLabel(profile, form),
              renderSelect(react, view, {
                onChange: value =>
                  setForm(current => ({
                    ...current,
                    permissionGroupMode:
                      (Array.isArray(value) ? value[0] : value) as TokenEditorState['permissionGroupMode']
                  })),
                options: permissionModeOptions,
                value: form.permissionGroupMode
              })
            ),
            form.permissionGroupMode === 'custom'
              ? renderTokenEditorRow(
                react,
                view,
                '用户组',
                '多个用户组用英文逗号分隔。',
                renderInput(react, view, {
                  onChange: value => setForm(current => ({ ...current, permissionGroupIds: value })),
                  placeholder: 'group-a, group-b',
                  value: form.permissionGroupIds
                })
              )
              : null,
            react.createElement(
              'div',
              { className: 'oneworks-relay__token-editor-actions' },
              renderButton(react, view, {
                icon: 'close',
                label: '返回列表',
                onClick: () =>
                  navigateTo(
                    ctx.scope,
                    routePath(ctx.scope, {
                      accountKey,
                      page: 'profile',
                      tab: 'tokens'
                    })
                  )
              }),
              isCreate ? null : renderButton(react, view, {
                danger: true,
                icon: 'block',
                label: '撤销令牌',
                onClick: () => {
                  void revoke().catch(revokeError => setError(toErrorMessage(revokeError)))
                }
              }),
              renderButton(react, view, {
                icon: 'check',
                label: isCreate ? '生成令牌' : '保存令牌配置',
                onClick: () => {
                  void save()
                },
                primary: true
              })
            )
          )
        )
      )
    )
  )
}

const renderTokenEditorRow = (
  react: PluginReactHost,
  _view: PluginViewContext | undefined,
  label: string,
  description: string,
  control: PluginReactNode
) =>
  react.createElement(
    'div',
    { className: 'oneworks-relay__token-editor-row', key: label },
    react.createElement(
      'span',
      { className: 'oneworks-relay__token-editor-label' },
      react.createElement('strong', null, label),
      react.createElement('span', null, description)
    ),
    react.createElement('span', { className: 'oneworks-relay__token-editor-control' }, control)
  )

const configDistributionHasDetails = (status?: RelayConfigDistributionStatus) => (
  cleanText(status?.hash) != null ||
  cleanText(status?.version) != null ||
  cleanText(status?.lastAppliedAt) != null ||
  cleanText(status?.lastSyncedAt) != null ||
  (status?.sources?.length ?? 0) > 0
)

const configDistributionState = (status?: RelayConfigDistributionStatus) => {
  if (cleanText(status?.lastError) != null) return '同步失败'
  return configDistributionHasDetails(status) ? '已同步' : '未同步'
}

const configShareProfileStatusLabel = (profile: RelayConfigShareProfile) => {
  const status = cleanText(profile.status)
  if (status === 'published') return '已发布'
  if (status === 'draft') return '草稿'
  if (status === 'archived') return '已归档'
  return status ?? '未知状态'
}

const teamCanManageConfig = (team?: RelayProfileTeam | null) => {
  const role = teamRoleText(team).toLowerCase()
  return role === 'owner' || role === 'admin' || role === 'editor'
}

const teamConfigEnabled = (team?: RelayProfileTeam | null) => (
  team?.membership?.configEnabled ?? team?.configEnabled ?? true
)

const configDistributionTone = (status?: RelayConfigDistributionStatus) => {
  if (cleanText(status?.lastError) != null) return 'danger'
  return configDistributionHasDetails(status) ? 'success' : 'neutral'
}

const scopedConfigDistributionForTeam = (
  status: RelayConfigDistributionStatus | undefined,
  team: RelayProfileTeam | undefined
): RelayConfigDistributionStatus | undefined => {
  if (status == null) return undefined
  const teamId = cleanText(team?.id)
  if (teamId == null) return status
  const sources = (status.sources ?? []).filter(source => cleanText(source.teamId) === teamId)
  if (sources.length === 0) {
    return {
      ...status,
      hash: null,
      lastAppliedAt: null,
      lastError: null,
      lastSyncedAt: null,
      sources: [],
      version: null
    }
  }
  return {
    ...status,
    sources
  }
}

const renderTeamMetric = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  props: {
    icon: string
    label: string
    meta?: PluginReactNode
    tone?: 'danger' | 'neutral' | 'primary' | 'success' | 'warning'
    value: PluginReactNode
  }
) =>
  react.createElement(
    'span',
    { className: 'oneworks-relay__team-metric', 'data-tone': props.tone ?? 'neutral', key: props.label },
    react.createElement(
      'span',
      { className: 'oneworks-relay__team-metric-icon' },
      renderIcon(react, view, props.icon, { size: 16 })
    ),
    react.createElement(
      'span',
      { className: 'oneworks-relay__team-metric-copy' },
      react.createElement('span', { className: 'oneworks-relay__team-metric-label' }, props.label),
      react.createElement('strong', null, props.value ?? '-'),
      props.meta == null
        ? null
        : react.createElement('span', { className: 'oneworks-relay__team-metric-meta' }, props.meta)
    )
  )

interface TeamDetailRowProps {
  description?: PluginReactNode
  icon: string
  label: string
  value: PluginReactNode
}

const renderTeamDetailRow = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  props: TeamDetailRowProps
) =>
  react.createElement(
    'div',
    { className: 'oneworks-relay__team-detail-row', key: props.label },
    react.createElement(
      'span',
      { className: 'oneworks-relay__team-detail-label' },
      react.createElement(
        'span',
        { className: 'oneworks-relay__team-detail-icon', 'aria-hidden': 'true' },
        renderIcon(react, view, props.icon, { size: 16 })
      ),
      react.createElement(
        'span',
        { className: 'oneworks-relay__team-detail-copy' },
        react.createElement('strong', { className: 'oneworks-relay__team-detail-title' }, props.label),
        props.description == null
          ? null
          : react.createElement(
            'span',
            { className: 'oneworks-relay__team-detail-description' },
            props.description
          )
      )
    ),
    react.createElement('span', { className: 'oneworks-relay__team-detail-value' }, props.value ?? '-')
  )

const renderTeamSection = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  icon: string,
  title: string,
  meta: string | undefined,
  ...children: PluginReactNode[]
) =>
  react.createElement(
    'section',
    { className: 'oneworks-relay__team-panel-section' },
    renderSectionHead(react, view, icon, title, meta),
    ...children
  )

const renderTeamStatePanel = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  icon: string,
  title: string,
  description: string
) =>
  react.createElement(
    'div',
    { className: 'oneworks-relay__team-state' },
    react.createElement(
      'span',
      { className: 'oneworks-relay__team-state-icon' },
      renderIcon(react, view, icon, { size: 20 })
    ),
    react.createElement(
      'span',
      { className: 'oneworks-relay__team-state-copy' },
      react.createElement('strong', null, title),
      react.createElement('span', null, description)
    )
  )

const getConfigShareProfilesForTeam = (
  targets: RelayConfigShareTargets | null,
  team: RelayProfileTeam | undefined
) => {
  const teamId = cleanText(team?.id)
  if (teamId == null) return []
  return targets?.profilesByTeamId?.[teamId] ?? []
}

const createInitialShareState = (): ShareState => ({
  draft: null,
  error: null,
  loadingTargets: false,
  previewing: false,
  profileName: '',
  publishing: false,
  targets: null,
  text: '{}'
})

const TeamDetailView = (props: {
  accountKey: string
  configPanel?: 'content' | 'versions'
  configProfileId?: string
  ctx: PluginClientContext
  onChanged: () => void
  profile: RelayProfileStatus | null
  profileLoading: boolean
  projectRuleId?: string
  react: PluginReactHost
  status: RelayStatus | null
  tab: RelayProfileTeamDetailTab
  teamId: string
  view?: PluginViewContext
}) => {
  const {
    accountKey,
    configPanel,
    configProfileId,
    ctx,
    onChanged,
    profile,
    profileLoading,
    projectRuleId,
    react,
    status,
    tab,
    teamId,
    view
  } = props
  const [share, setShare] = react.useState<ShareState>(createInitialShareState)
  const [configActionId, setConfigActionId] = react.useState<string | null>(null)
  const [configActionError, setConfigActionError] = react.useState<string | null>(null)
  const [configSearch, setConfigSearch] = react.useState('')
  const [projectSearch, setProjectSearch] = react.useState('')
  const launcherSurface = isLauncherSurface(view)
  const launcherSearchValue = launcherSurface ? (cleanText(view?.host?.launcherSearch?.value) ?? '') : ''
  const account = getProfileAccount(profile, status, accountKey)
  const team = profile?.teams?.find(item => cleanText(item.id) === teamId)
  const configDistribution = scopedConfigDistributionForTeam(status?.configDistribution ?? status?.configSync, team)
  const teamName = team == null ? cleanText(teamId) ?? '团队' : teamDisplayName(team)
  const teamPending = team == null && (profile == null || profileLoading)
  const teamSubtitle = teamPending
    ? '正在加载团队资料'
    : team == null
    ? '团队资料暂不可用'
    : cleanTextList([team.slug, cleanText(team.description)]).join(' · ')
  const routeDetailActive = tab === 'projects' && projectRuleId != null
  const mainClassName = [
    'oneworks-relay',
    routeDetailActive ? 'oneworks-relay--project-rule-route' : '',
    tab === 'documents' ? 'oneworks-relay--documents-tab' : '',
    tab === 'configs' && configPanel === 'content' ? 'oneworks-relay--team-config-content-tab' : ''
  ].filter(Boolean).join(' ')
  const loadTargets = async () => {
    setShare(current => ({ ...current, error: null, loadingTargets: true }))
    try {
      const targets = await requestJson<RelayConfigShareTargets>(ctx, 'config-share-targets', { accountKey, teamId })
      setShare(current => ({ ...current, loadingTargets: false, targets }))
    } catch (error) {
      setShare(current => ({ ...current, error: toErrorMessage(error), loadingTargets: false }))
    }
  }
  react.useEffect(() => {
    if (share.error != null) return
    const shouldLoadTargets = tab === 'configs' || tab === 'projects'
    if (shouldLoadTargets && share.targets == null && !share.loadingTargets) {
      void loadTargets()
    }
  }, [tab, share.targets, share.loadingTargets, share.error])
  const panel = teamPending
    ? renderTeamStatePanel(react, view, 'sync', '正在加载团队', '团队资料和共享配置会在账号信息恢复后展示。')
    : team == null
    ? renderTeamStatePanel(react, view, 'error', '未找到团队', `当前账号下没有找到 ${teamId}。`)
    : tab === 'configs'
    ? renderTeamConfigsPanel({
      accountKey,
      actionError: configActionError,
      actionId: configActionId,
      configDistribution,
      configPanel,
      configProfileId,
      ctx,
      loadTargets,
      onActionIdChange: setConfigActionId,
      onActionErrorChange: setConfigActionError,
      onChanged,
      react,
      search: configSearch,
      setSearch: setConfigSearch,
      targets: share.targets,
      targetsError: share.error,
      targetsLoading: share.loadingTargets,
      team,
      view
    })
    : tab === 'projects'
    ? renderTeamProjectsPanel({
      account,
      accountKey,
      configDistribution,
      ctx,
      onChanged,
      projectRuleId,
      react,
      search: launcherSurface ? launcherSearchValue : projectSearch,
      setSearch: launcherSurface ? () => undefined : setProjectSearch,
      status,
      targets: share.targets,
      targetsError: share.error,
      targetsLoading: share.loadingTargets,
      team,
      view
    })
    : tab === 'documents'
    ? react.createElement(DocumentSyncPanel, {
      account,
      accountKey,
      ctx,
      onChanged,
      react,
      status,
      team,
      view
    })
    : renderTeamOverviewPanel(react, view, configDistribution, team)
  const NativeTabs = view?.ui?.NativeTabs
  const tabs = routeDetailActive
    ? null
    : NativeTabs == null
    ? react.createElement('div', { className: 'oneworks-relay__empty' }, '标准标签组件不可用')
    : react.createElement(NativeTabs, {
      activeKey: tab,
      actions: !launcherSurface && tab === 'documents' && team != null
        ? renderDocumentTabActions({ account, accountKey, ctx, onChanged, react, team, view })
        : undefined,
      ariaLabel: '团队详情',
      className: 'oneworks-relay__profile-tabs oneworks-relay__team-detail-tabs',
      items: teamDetailTabs.map((item): PluginHostNativeTabItem => ({
        icon: item.icon,
        key: item.key,
        label: item.label
      })),
      onChange: (nextTab: RelayProfileTeamDetailTab) =>
        navigateTo(
          ctx.scope,
          routePath(ctx.scope, {
            accountKey,
            page: 'team',
            tab: nextTab,
            teamId
          })
        )
    })
  return react.createElement(
    'main',
    { className: mainClassName },
    react.createElement(
      'div',
      { className: 'oneworks-relay__shell' },
      react.createElement(
        'section',
        { className: 'oneworks-relay__surface' },
        react.createElement(
          'section',
          {
            className: [
              'oneworks-relay__profile oneworks-relay__profile--team-detail',
              launcherSurface ? 'oneworks-relay__profile--launcher' : '',
              tab === 'documents' ? 'oneworks-relay__profile--documents-tab' : ''
            ].filter(Boolean).join(' ')
          },
          launcherSurface || routeDetailActive ? null : react.createElement(
            'div',
            { className: 'oneworks-relay__team-hero' },
            react.createElement(
              'div',
              { className: 'oneworks-relay__team-hero-main' },
              renderAvatar(react, {
                avatarUrl: team?.avatarUrl,
                className: 'oneworks-relay__team-avatar',
                name: teamName
              }),
              react.createElement(
                'span',
                { className: 'oneworks-relay__team-hero-copy' },
                react.createElement('strong', null, teamName),
                react.createElement(
                  'span',
                  null,
                  teamSubtitle === '' ? '通过 Relay 共享配置与成员工作环境' : teamSubtitle
                )
              )
            )
          ),
          tabs,
          react.createElement(
            'div',
            {
              className: [
                'oneworks-relay__team-detail-panel',
                routeDetailActive ? 'oneworks-relay__team-detail-panel--route-detail' : 'native-tabs-panel',
                tab === 'documents' ? 'oneworks-relay__documents-panel' : ''
              ].filter(Boolean).join(' ')
            },
            panel
          )
        )
      )
    )
  )
}

const renderTeamOverviewPanel = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  configDistribution: RelayConfigDistributionStatus | undefined,
  team: RelayProfileTeam
) => {
  const canManageConfig = teamCanManageConfig(team)
  const configEnabled = teamConfigEnabled(team)
  return react.createElement(
    'div',
    { className: 'oneworks-relay__team-overview' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__team-metric-grid' },
      renderTeamMetric(react, view, {
        icon: 'groups',
        label: '成员',
        meta: '团队可见成员',
        value: typeof team.memberCount === 'number' ? `${team.memberCount} 人` : '-'
      }),
      renderTeamMetric(react, view, {
        icon: 'admin_panel_settings',
        label: '我的权限',
        meta: canManageConfig ? '可查看和发布团队配置' : '可使用已分配配置',
        tone: canManageConfig ? 'primary' : 'neutral',
        value: teamRoleText(team)
      }),
      renderTeamMetric(react, view, {
        icon: 'rule_settings',
        label: '团队配置',
        meta: configEnabled ? '会合并到当前全局配置' : '不会参与本机配置合并',
        tone: configEnabled ? 'success' : 'warning',
        value: configEnabled ? '可用' : '未启用'
      }),
      renderTeamMetric(react, view, {
        icon: 'sync',
        label: '同步状态',
        meta: cleanText(configDistribution?.lastError) ?? formatDateTime(configDistribution?.lastSyncedAt),
        tone: configDistributionTone(configDistribution),
        value: configDistributionState(configDistribution)
      })
    ),
    react.createElement(
      'section',
      { className: 'oneworks-relay__team-panel-section' },
      react.createElement(
        'div',
        { className: 'oneworks-relay__team-detail-list' },
        renderTeamDetailRow(react, view, {
          description: '用于 Relay 服务端识别团队',
          icon: 'badge',
          label: '团队 ID',
          value: valueOrDash(team.id)
        }),
        renderTeamDetailRow(react, view, {
          description: '团队短标识',
          icon: 'label',
          label: 'Slug',
          value: valueOrDash(team.slug)
        }),
        renderTeamDetailRow(react, view, {
          description: '发布共享配置时的默认目标',
          icon: 'publish',
          label: '默认发布',
          value: team.defaultForPublishing === true ? '是' : '否'
        }),
        renderTeamDetailRow(react, view, {
          description: '本机最近一次从 Relay 拉取团队配置',
          icon: 'sync',
          label: '最后同步',
          value: formatDateTime(configDistribution?.lastSyncedAt)
        }),
        renderTeamDetailRow(react, view, {
          description: '团队资料最近更新时间',
          icon: 'schedule',
          label: '更新时间',
          value: formatDateTime(team.updatedAt)
        })
      )
    )
  )
}

const configShareProfileTitle = (profile: RelayConfigShareProfile) =>
  cleanText(profile.name) ?? cleanText(profile.id) ?? '未命名配置'

const findConfigSourceForProfile = (
  sources: RelayConfigDistributionSourceStatus[],
  profile: RelayConfigShareProfile
) => {
  const profileId = cleanText(profile.id)
  if (profileId == null) return undefined
  return sources.find(source => cleanText(source.profileId) === profileId)
}

const configSourceEnabled = (source?: RelayConfigDistributionSourceStatus) => (
  source != null && source.enabled !== false
)

const configSourceStatusLabel = (source?: RelayConfigDistributionSourceStatus) => {
  if (source == null) return '未启用'
  if (source.enabled === false) return '已停用'
  return '启用中'
}

const renderTeamConfigToggle = (props: {
  accountKey: string
  actionId: string | null
  ctx: PluginClientContext
  onActionErrorChange: (value: string | null) => void
  onActionIdChange: (value: string | null) => void
  onChanged: () => void
  profile: RelayConfigShareProfile
  react: PluginReactHost
  source?: RelayConfigDistributionSourceStatus
  view?: PluginViewContext
}) => {
  const { accountKey, actionId, ctx, onActionErrorChange, onActionIdChange, onChanged, profile, react, source, view } =
    props
  const profileId = cleanText(profile.id)
  const enabled = configSourceEnabled(source)
  const busy = profileId != null && actionId === profileId
  return renderButton(react, view, {
    disabled: profileId == null || busy,
    icon: enabled ? 'toggle_on' : 'toggle_off',
    label: enabled ? '停用配置' : '启用配置',
    onClick: () => {
      if (profileId == null) return
      onActionErrorChange(null)
      onActionIdChange(profileId)
      void requestJson(ctx, 'config-source-enabled', {
        accountKey,
        enabled: !enabled,
        id: profileId,
        kind: 'profile'
      }).then(() => {
        onChanged()
      }).catch(error => {
        onActionErrorChange(toErrorMessage(error))
      }).finally(() => {
        onActionIdChange(null)
      })
    }
  })
}

const configDistributionMatchedProject = (status?: RelayConfigDistributionStatus) => (
  status?.matchedProject === true || (typeof status?.matchedProject === 'string' && status.matchedProject !== '')
)

const configSourceFieldSummary = (source?: RelayConfigDistributionSourceStatus) => {
  const fields = source?.fields ?? []
  if (fields.length === 0) return undefined
  return fields.join(', ')
}

const projectRulePatterns = (
  rule: RelayConfigProjectRule | null | undefined,
  key: 'allow' | 'deny'
) => cleanTextList(rule?.[key] ?? [])

const projectRuleRepositoryValues = (values: string[]) => [
  ...new Set(
    values
      .map(normalizeRelayGitRepositoryIdentity)
      .filter((value): value is string => value != null)
  )
]

const compactProjectRule = (projects: string[]): RelayConfigProjectRule | null => {
  const allow = projectRuleRepositoryValues(projects)
  if (allow.length === 0) return null
  return { allow }
}

const gitRepositoryIdentity = (value: string) => {
  const text = cleanText(value)
  if (text == null) return { meta: 'Git 仓库', title: '待填写' }
  const normalized = normalizeRelayGitRepositoryIdentity(text) ?? text
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 3) {
    const host = parts[0] ?? ''
    const owner = parts[parts.length - 2] ?? ''
    const repo = parts[parts.length - 1] ?? ''
    const provider = /github\.com$/iu.test(host) ? 'GitHub' : host
    return { meta: provider, title: `${owner}/${repo}` }
  }
  if (parts.length === 2) return { meta: 'Git 仓库', title: `${parts[0]}/${parts[1]}` }
  return { meta: '本地仓库名', title: text }
}

const projectRuleItemId = (
  profile: RelayConfigShareProfile | undefined,
  source: RelayConfigDistributionSourceStatus | undefined,
  index: number
) => (
  cleanText(source?.assignmentId) ?? cleanText(profile?.id) ?? cleanText(source?.profileId) ?? `rule-${index + 1}`
)

const projectRuleItemMatches = (item: RelayTeamProjectInteractionItem, ruleId: string) => (
  item.ruleId === ruleId ||
  cleanText(item.profile?.id) === ruleId ||
  cleanText(item.source?.assignmentId) === ruleId ||
  cleanText(item.source?.profileId) === ruleId
)

const projectAssignmentDraftFrom = (assignment: RelayConfigShareProfileAssignment) => ({
  enabled: assignment.enabled !== false ? 'true' : 'false',
  mode: assignment.mode ?? 'default',
  projects: projectRulePatterns(assignment.project, 'allow'),
  versionId: cleanText(assignment.versionId) ?? ''
})

const projectAssignmentDraftKey = (assignment: RelayConfigShareProfileAssignment, index: number) => (
  cleanText(assignment.id) ?? `assignment-${index + 1}`
)

const renderProjectRuleEditorField = (
  react: PluginReactHost,
  label: string,
  description: string,
  control: PluginReactNode
) =>
  react.createElement(
    'label',
    { className: 'oneworks-relay__project-rule-field', key: label },
    react.createElement(
      'span',
      { className: 'oneworks-relay__project-rule-field-copy' },
      react.createElement('strong', null, label),
      react.createElement('span', null, description)
    ),
    control
  )

const TeamProjectRuleDetailPanel = (props: {
  account: RelayAuthAccount | null
  accountKey: string
  ctx: PluginClientContext
  matchLabel: string
  onChanged: () => void
  profile?: RelayConfigShareProfile
  react: PluginReactHost
  rule: RelayTeamProjectInteractionItem
  status: RelayStatus | null
  team: RelayProfileTeam
  view?: PluginViewContext
}) => {
  const { account, accountKey, ctx, matchLabel, onChanged, profile, react, rule, status, team, view } = props
  const NativeTabs = view?.ui?.NativeTabs
  const profileId = cleanText(profile?.id ?? rule.source?.profileId)
  const teamId = cleanText(team.id)
  const projectRuleStateId = cleanText(rule.source?.assignmentId ?? rule.ruleId) ?? ''
  const routeStateKey = `${accountKey}\0${teamId ?? ''}\0${profileId ?? ''}\0${projectRuleStateId}`
  const [activeTab, setActiveTab] = react.useState<RelayProjectRuleDetailTab>(initialProjectRuleDetailTab)
  const [loadedDetail, setLoadedDetail] = react.useState<
    {
      routeStateKey: string
      value: RelayConfigShareProfileDetail
    } | null
  >(null)
  const [drafts, setDrafts] = react.useState<Record<string, ReturnType<typeof projectAssignmentDraftFrom>>>({})
  const [repositoryEdit, setRepositoryEdit] = react.useState<RelayProjectRuleRepositoryEditState | null>(null)
  const [loading, setLoading] = react.useState(false)
  const [repositorySearch, setRepositorySearch] = react.useState('')
  const [savingIds, setSavingIds] = react.useState<Set<string>>(new Set())
  const acknowledgedDraftsRef = react.useRef(new Map<string, ReturnType<typeof projectAssignmentDraftFrom>>())
  const contextRef = react.useRef(ctx)
  const detailRequestRef = react.useRef(0)
  const mountedRef = react.useRef(true)
  const routeStateRef = react.useRef({ generation: 0, key: routeStateKey })
  contextRef.current = ctx
  if (routeStateRef.current.key !== routeStateKey) {
    routeStateRef.current = {
      generation: routeStateRef.current.generation + 1,
      key: routeStateKey
    }
  }
  const detail = loadedDetail?.routeStateKey === routeStateKey ? loadedDetail.value : null

  react.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const showProjectRuleError = (title: string, description: string) => {
    contextRef.current.notifications?.show?.({ description, level: 'error', title })
  }

  react.useEffect(() => {
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    let cancelled = false
    const isCurrent = () => !cancelled && mountedRef.current && detailRequestRef.current === requestId

    setLoadedDetail(null)
    setDrafts({})
    setRepositoryEdit(null)
    setSavingIds(new Set())
    acknowledgedDraftsRef.current.clear()

    if (profileId == null) {
      setLoading(false)
      showProjectRuleError('无法读取项目规则', '当前项目规则缺少配置方案 ID。')
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    const requestContext = contextRef.current
    const loadDetail = async () => {
      await projectRuleAssignmentSaveQueue.waitForIdleByPrefix(
        projectRuleProfileSaveKeyPrefix(accountKey, teamId, profileId)
      )
      if (!isCurrent()) return undefined
      return await requestJson<RelayConfigShareProfileDetail>(requestContext, 'config-share-profile-detail', {
        accountKey,
        profileId,
        teamId
      })
    }
    void loadDetail().then(nextDetail => {
      if (nextDetail == null) return
      if (!isCurrent()) return
      const nextAssignments = nextDetail.assignments ?? []
      const nextDrafts = Object.fromEntries(nextAssignments.map((assignment, index) => [
        projectAssignmentDraftKey(assignment, index),
        projectAssignmentDraftFrom(assignment)
      ]))
      setLoadedDetail({ routeStateKey, value: nextDetail })
      setDrafts(nextDrafts)
      acknowledgedDraftsRef.current = new Map(Object.entries(nextDrafts))
    }).catch(nextError => {
      if (!isCurrent()) return
      setLoadedDetail(null)
      setDrafts({})
      acknowledgedDraftsRef.current.clear()
      showProjectRuleError('读取项目规则失败', toErrorMessage(nextError))
    }).finally(() => {
      if (isCurrent()) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [accountKey, profileId, routeStateKey, teamId])

  const assignments = detail?.assignments ?? []
  const visibleAssignments = cleanText(rule.source?.assignmentId) == null
    ? assignments
    : [
      ...assignments.filter(item => cleanText(item.id) === cleanText(rule.source?.assignmentId)),
      ...assignments.filter(item => cleanText(item.id) !== cleanText(rule.source?.assignmentId))
    ]
  const versions = detail?.versions ?? []
  const versionOptions = [
    { label: '跟随当前发布版本', value: '' },
    ...versions.map(version => ({
      label: cleanTextList([
        typeof version.version === 'number' ? `v${version.version}` : undefined,
        cleanText(version.id)
      ]).join(' · ') || cleanText(version.id) || '未命名版本',
      value: cleanText(version.id) ?? ''
    })).filter(option => option.value !== '')
  ]
  const updateDraft = (
    assignment: RelayConfigShareProfileAssignment,
    index: number,
    patch: Partial<ReturnType<typeof projectAssignmentDraftFrom>>
  ) => {
    const key = projectAssignmentDraftKey(assignment, index)
    const nextDraft = {
      ...(drafts[key] ?? projectAssignmentDraftFrom(assignment)),
      ...patch
    }
    setDrafts(current => ({
      ...current,
      [key]: nextDraft
    }))
    return nextDraft
  }
  const saveAssignment = async (
    assignment: RelayConfigShareProfileAssignment,
    index: number,
    draftOverride?: ReturnType<typeof projectAssignmentDraftFrom>
  ) => {
    const saveRouteGeneration = routeStateRef.current.generation
    const isCurrentRoute = () => (
      mountedRef.current && routeStateRef.current.generation === saveRouteGeneration
    )
    const assignmentId = cleanText(assignment.id)
    if (assignmentId == null) {
      if (isCurrentRoute()) showProjectRuleError('保存失败', '当前项目规则缺少 assignment ID。')
      return { current: isCurrentRoute(), latest: true, saved: false }
    }
    const key = projectAssignmentDraftKey(assignment, index)
    const draft = draftOverride ?? drafts[key] ?? projectAssignmentDraftFrom(assignment)
    const project = compactProjectRule(draft.projects)
    if (project == null) {
      if (isCurrentRoute()) {
        showProjectRuleError('无法保存项目规则', '请至少添加一个符合标准的 Git 仓库地址。')
      }
      return { current: isCurrentRoute(), latest: true, saved: false }
    }
    if (isCurrentRoute()) {
      setSavingIds(current => {
        const next = new Set(current)
        next.add(assignmentId)
        return next
      })
    }
    const saveQueueKey = projectRuleAssignmentSaveKey(accountKey, teamId, profileId, assignmentId)
    const requestContext = contextRef.current
    const result = await projectRuleAssignmentSaveQueue.enqueue(saveQueueKey, async () => {
      await requestJson(requestContext, 'config-share-assignment-update', {
        accountKey,
        assignmentId,
        enabled: draft.enabled === 'true',
        mode: draft.mode,
        project,
        versionId: cleanText(draft.versionId) ?? undefined
      })
    })
    const current = isCurrentRoute()
    if (!result.saved && result.latest && current) {
      showProjectRuleError('保存项目规则失败', toErrorMessage(result.error))
    }
    if (result.saved && current) acknowledgedDraftsRef.current.set(key, draft)
    if (current && result.latest) {
      setSavingIds(currentSavingIds => {
        const next = new Set(currentSavingIds)
        next.delete(assignmentId)
        return next
      })
    }
    return { ...result, current }
  }
  const updateRepository = (
    assignment: RelayConfigShareProfileAssignment,
    index: number,
    rowIndex: number,
    value: string
  ) => {
    const draft = drafts[projectAssignmentDraftKey(assignment, index)] ?? projectAssignmentDraftFrom(assignment)
    const projects = draft.projects.length === 0 ? [''] : draft.projects
    updateDraft(assignment, index, {
      projects: projects.map((item, nextIndex) => nextIndex === rowIndex ? value : item)
    })
  }
  const commitRepository = async (
    assignment: RelayConfigShareProfileAssignment,
    index: number,
    rowIndex: number,
    value: string
  ) => {
    const draft = drafts[projectAssignmentDraftKey(assignment, index)] ?? projectAssignmentDraftFrom(assignment)
    const projects = draft.projects.length === 0 ? [''] : draft.projects
    const normalizedRepository = normalizeRelayGitRepositoryIdentity(value)
    if (normalizedRepository == null) {
      showProjectRuleError(
        'Git 仓库地址无效',
        '请输入标准 Git 远端身份，例如 github.com/owner/repo、HTTPS URL 或 SSH URL。'
      )
      return false
    }
    const duplicate = projects.some((item, nextIndex) => (
      nextIndex !== rowIndex &&
      relayGitRepositoryIdentitiesEqual(item, normalizedRepository)
    ))
    if (duplicate) {
      showProjectRuleError('Git 仓库已存在', `${normalizedRepository} 已经在当前匹配列表中。`)
      return false
    }
    const nextDraft = updateDraft(assignment, index, {
      projects: projects.map((item, nextIndex) => nextIndex === rowIndex ? normalizedRepository : item)
    })
    const result = await saveAssignment(assignment, index, nextDraft)
    if (result.saved && result.current) setRepositoryEdit(null)
    return result.saved
  }
  const removeRepository = (assignment: RelayConfigShareProfileAssignment, index: number, rowIndex: number) => {
    const draft = drafts[projectAssignmentDraftKey(assignment, index)] ?? projectAssignmentDraftFrom(assignment)
    const nextDraft = updateDraft(assignment, index, {
      projects: draft.projects.filter((_, nextIndex) => nextIndex !== rowIndex)
    })
    void saveAssignment(assignment, index, nextDraft).then(result => {
      if (!result.saved && result.latest && result.current) {
        const key = projectAssignmentDraftKey(assignment, index)
        const acknowledgedDraft = acknowledgedDraftsRef.current.get(key) ?? draft
        setDrafts(current => ({ ...current, [key]: acknowledgedDraft }))
      }
    })
  }
  const addRepository = (assignment: RelayConfigShareProfileAssignment, index: number) => {
    const draft = drafts[projectAssignmentDraftKey(assignment, index)] ?? projectAssignmentDraftFrom(assignment)
    const repositoryIndex = draft.projects.length
    const key = `${projectAssignmentDraftKey(assignment, index)}:repository:${repositoryIndex}`
    setRepositorySearch('')
    setRepositoryEdit({ added: true, key, originalValue: '' })
    updateDraft(assignment, index, { projects: [...draft.projects, ''] })
  }
  const cancelRepositoryEdit = (
    assignment: RelayConfigShareProfileAssignment,
    index: number,
    rowIndex: number
  ) => {
    if (repositoryEdit == null) return
    const draft = drafts[projectAssignmentDraftKey(assignment, index)] ?? projectAssignmentDraftFrom(assignment)
    updateDraft(assignment, index, {
      projects: repositoryEdit.added
        ? draft.projects.filter((_, nextIndex) => nextIndex !== rowIndex)
        : draft.projects.map((item, nextIndex) => (
          nextIndex === rowIndex ? repositoryEdit.originalValue : item
        ))
    })
    setRepositoryEdit(null)
  }
  const updateAndSaveAssignment = (
    assignment: RelayConfigShareProfileAssignment,
    index: number,
    patch: Partial<ReturnType<typeof projectAssignmentDraftFrom>>
  ) => {
    const key = projectAssignmentDraftKey(assignment, index)
    const nextDraft = updateDraft(assignment, index, patch)
    void saveAssignment(assignment, index, nextDraft).then(result => {
      if (!result.saved && result.latest && result.current) {
        const acknowledgedDraft = acknowledgedDraftsRef.current.get(key) ?? projectAssignmentDraftFrom(assignment)
        setDrafts(current => ({ ...current, [key]: acknowledgedDraft }))
      }
    })
  }
  const firstVisibleAssignment = visibleAssignments[0]
  const documentAssignmentId = cleanText(rule.source?.assignmentId) ?? cleanText(firstVisibleAssignment?.id)
  const projectRuleDocumentQuery = readDocumentPanelQueryValue('doc')
  react.useEffect(() => {
    if (projectRuleDocumentQuery !== '') {
      setActiveTab('documents')
    }
  }, [documentAssignmentId, projectRuleDocumentQuery])
  const tabActions = activeTab === 'rules' && firstVisibleAssignment != null
    ? renderButton(react, view, {
      disabled: repositoryEdit != null || savingIds.size > 0,
      icon: 'add',
      label: '添加仓库',
      onClick: () => addRepository(firstVisibleAssignment, 0)
    })
    : null
  const changeActiveTab = (nextTab: RelayProjectRuleDetailTab) => {
    if (nextTab !== 'documents') {
      writeDocumentPanelQuery({ documentPath: null, search: '' })
    }
    setActiveTab(nextTab)
  }
  const tabs = NativeTabs == null
    ? react.createElement('div', { className: 'oneworks-relay__empty' }, '标准标签组件不可用')
    : react.createElement(NativeTabs, {
      activeKey: activeTab,
      actions: tabActions,
      ariaLabel: '项目规则详情',
      className: 'oneworks-relay__profile-tabs oneworks-relay__project-rule-tabs',
      items: projectRuleDetailTabs.map((item): PluginHostNativeTabItem => ({
        icon: item.icon,
        key: item.key,
        label: item.label
      })),
      onChange: changeActiveTab
    })
  const overviewPanel = react.createElement(
    'div',
    { className: 'oneworks-relay__team-detail-list' },
    renderTeamDetailRow(react, view, {
      description: '匹配规则归属的配置方案',
      icon: 'rule_settings',
      label: '规则组',
      value: profile == null ? valueOrDash(rule.title) : configShareProfileTitle(profile)
    }),
    renderTeamDetailRow(react, view, {
      description: '当前 Git 项目是否命中团队分发',
      icon: 'folder_open',
      label: '当前项目',
      value: matchLabel
    }),
    renderTeamDetailRow(react, view, {
      description: '服务端 assignment 数量',
      icon: 'account_tree',
      label: '匹配规则',
      value: loading ? '读取中' : `${assignments.length} 条`
    })
  )
  const repositoryItems: RelayProjectRuleRepositoryRow[] = visibleAssignments.flatMap(
    (assignment, assignmentIndex) => {
      const draft = drafts[projectAssignmentDraftKey(assignment, assignmentIndex)] ??
        projectAssignmentDraftFrom(assignment)
      const repositories = draft.projects.length === 0 ? [''] : draft.projects
      return repositories.map((repository, repositoryIndex) => {
        const identity = gitRepositoryIdentity(repository)
        return {
          assignment,
          assignmentIndex,
          key: `${projectAssignmentDraftKey(assignment, assignmentIndex)}:repository:${repositoryIndex}`,
          meta: identity.meta,
          repositoryCount: repositories.length,
          repositoryIndex,
          searchText: cleanTextList([
            'Git',
            '仓库',
            identity.title,
            identity.meta,
            repository,
            assignment.id,
            assignment.profileId,
            teamId
          ]).join(' '),
          title: identity.title,
          value: repository
        }
      })
    }
  )
  const filteredRepositoryItems = repositoryItems.filter(item =>
    matchesNativeSearch(
      [item.title, item.meta, item.value, item.searchText],
      repositorySearch.trim().toLowerCase()
    )
  )
  const rulesPanel = visibleAssignments.length === 0
    ? react.createElement(
      'div',
      { className: 'oneworks-relay__empty' },
      loading ? '正在加载匹配规则...' : '暂无匹配规则'
    )
    : react.createElement(
      'div',
      { className: 'oneworks-relay__project-rule-list-panel' },
      renderSearchInput(react, view, {
        ariaLabel: '搜索 Git 仓库规则',
        onChange: setRepositorySearch,
        placeholder: '搜索 Git 仓库、组织或仓库地址',
        value: repositorySearch
      }),
      filteredRepositoryItems.length === 0
        ? react.createElement('div', { className: 'oneworks-relay__empty' }, '没有匹配的 Git 仓库')
        : react.createElement(
          'div',
          { className: 'oneworks-relay__project-rule-repository-list' },
          ...filteredRepositoryItems.map(item =>
            react.createElement(
              'div',
              {
                className: 'oneworks-relay__project-rule-repository-row',
                'data-editing': repositoryEdit?.key === item.key ? 'true' : undefined,
                key: item.key
              },
              react.createElement(
                'span',
                { className: 'oneworks-relay__project-rule-repository-kind' },
                renderIcon(react, view, 'hub', { size: 16 }),
                react.createElement(
                  'span',
                  { className: 'oneworks-relay__project-rule-repository-copy' },
                  react.createElement('strong', null, item.title),
                  react.createElement('span', null, item.meta)
                )
              ),
              repositoryEdit?.key === item.key
                ? react.createElement(
                  'div',
                  { className: 'oneworks-relay__project-rule-repository-control' },
                  renderInput(react, view, {
                    autoFocus: true,
                    onChange: value =>
                      updateRepository(
                        item.assignment,
                        item.assignmentIndex,
                        item.repositoryIndex,
                        value
                      ),
                    placeholder: 'github.com/owner/repo',
                    value: item.value
                  })
                )
                : react.createElement(
                  'span',
                  { className: 'oneworks-relay__project-rule-repository-address' },
                  item.value || '待填写 Git 仓库地址'
                ),
              react.createElement(
                'span',
                { className: 'oneworks-relay__project-rule-repository-actions' },
                repositoryEdit?.key === item.key
                  ? renderButton(react, view, {
                    disabled: savingIds.size > 0,
                    icon: 'check',
                    label: '确认仓库',
                    onClick: () => {
                      void commitRepository(
                        item.assignment,
                        item.assignmentIndex,
                        item.repositoryIndex,
                        item.value
                      )
                    }
                  })
                  : renderButton(react, view, {
                    disabled: repositoryEdit != null || savingIds.size > 0,
                    icon: 'edit',
                    label: '编辑仓库',
                    onClick: () =>
                      setRepositoryEdit({
                        added: false,
                        key: item.key,
                        originalValue: item.value
                      })
                  }),
                repositoryEdit?.key === item.key
                  ? renderButton(react, view, {
                    disabled: savingIds.size > 0,
                    icon: 'close',
                    label: '取消编辑',
                    onClick: () =>
                      cancelRepositoryEdit(
                        item.assignment,
                        item.assignmentIndex,
                        item.repositoryIndex
                      )
                  })
                  : renderButton(react, view, {
                    disabled: repositoryEdit != null || savingIds.size > 0 || item.repositoryCount === 1,
                    icon: 'close',
                    label: '移除仓库',
                    onClick: () => removeRepository(item.assignment, item.assignmentIndex, item.repositoryIndex)
                  })
              )
            )
          )
        )
    )
  const settingsPanel = visibleAssignments.length === 0
    ? react.createElement(
      'div',
      { className: 'oneworks-relay__empty' },
      loading ? '正在加载应用设置...' : '暂无应用设置'
    )
    : react.createElement(
      'div',
      { className: 'oneworks-relay__project-rule-settings-panel' },
      ...visibleAssignments.map((assignment, index) => {
        const draft = drafts[projectAssignmentDraftKey(assignment, index)] ??
          projectAssignmentDraftFrom(assignment)
        const assignmentId = cleanText(assignment.id)
        const saving = assignmentId != null && savingIds.has(assignmentId)
        const settingsDisabled = saving || assignmentId == null ||
          projectRuleRepositoryValues(draft.projects).length === 0
        return react.createElement(
          'section',
          {
            'aria-busy': saving,
            className: 'oneworks-relay__project-rule-settings',
            key: projectAssignmentDraftKey(assignment, index)
          },
          react.createElement(
            'div',
            { className: 'oneworks-relay__project-rule-fields' },
            renderProjectRuleEditorField(
              react,
              '状态',
              '停用后保留规则但不参与分发',
              renderSelect(react, view, {
                disabled: settingsDisabled,
                onChange: value =>
                  updateAndSaveAssignment(assignment, index, {
                    enabled: Array.isArray(value) ? value[0] ?? 'true' : value
                  }),
                options: [
                  { label: '启用规则', value: 'true' },
                  { label: '暂不启用', value: 'false' }
                ],
                value: draft.enabled
              })
            ),
            renderProjectRuleEditorField(
              react,
              '合并方式',
              '普通合并会叠加团队配置；覆盖模式优先生效',
              renderSelect(react, view, {
                disabled: settingsDisabled,
                onChange: value =>
                  updateAndSaveAssignment(assignment, index, {
                    mode: (Array.isArray(value) ? value[0] ?? 'default' : value) as 'default' | 'override'
                  }),
                options: [
                  { label: '普通合并', value: 'default' },
                  { label: '覆盖当前配置', value: 'override' }
                ],
                value: draft.mode
              })
            ),
            renderProjectRuleEditorField(
              react,
              '配置版本',
              '推荐跟随当前发布；需要锁定时再选择具体版本',
              renderSelect(react, view, {
                disabled: settingsDisabled,
                onChange: value =>
                  updateAndSaveAssignment(assignment, index, {
                    versionId: Array.isArray(value) ? value[0] ?? '' : value
                  }),
                options: versionOptions,
                value: draft.versionId
              })
            )
          )
        )
      })
    )
  const documentsPanel = documentAssignmentId == null || teamId == null
    ? react.createElement('div', { className: 'oneworks-relay__empty' }, '当前项目规则缺少文档命名空间。')
    : react.createElement(DocumentSyncPanel, {
      account,
      accountKey,
      ctx,
      onChanged,
      projectRule: {
        assignmentId: documentAssignmentId,
        teamId
      },
      react,
      status,
      team,
      view
    })
  const tabPanel = activeTab === 'overview'
    ? overviewPanel
    : activeTab === 'documents'
    ? documentsPanel
    : activeTab === 'settings'
    ? settingsPanel
    : rulesPanel

  return react.createElement(
    'section',
    {
      className: [
        'oneworks-relay__team-config-detail oneworks-relay__project-rule-detail',
        activeTab === 'documents' ? 'oneworks-relay__project-rule-detail--documents' : ''
      ].filter(Boolean).join(' ')
    },
    tabs,
    react.createElement('div', { className: 'native-tabs-panel oneworks-relay__project-rule-tab-panel' }, tabPanel)
  )
}

const renderTeamProjectsPanel = (props: {
  account: RelayAuthAccount | null
  accountKey: string
  configDistribution: RelayConfigDistributionStatus | undefined
  ctx: PluginClientContext
  onChanged: () => void
  projectRuleId?: string
  react: PluginReactHost
  search: string
  setSearch: (value: string) => void
  status: RelayStatus | null
  targets: RelayConfigShareTargets | null
  targetsError: string | null
  targetsLoading: boolean
  team: RelayProfileTeam
  view?: PluginViewContext
}) => {
  const {
    account,
    accountKey,
    configDistribution,
    ctx,
    onChanged,
    projectRuleId,
    react,
    search,
    setSearch,
    status,
    targets,
    targetsError,
    targetsLoading,
    team,
    view
  } = props
  const InteractionList = view?.ui?.InteractionList
  const launcherSurface = isLauncherSurface(view)
  const sources = configDistribution?.sources ?? []
  const profiles = getConfigShareProfilesForTeam(targets, team)
  const profileEntries: Array<[string, RelayConfigShareProfile]> = profiles.flatMap(profile => {
    const profileId = cleanText(profile.id)
    return profileId == null ? [] : [[profileId, profile]]
  })
  const profilesById = new Map<string, RelayConfigShareProfile>(
    profileEntries
  )
  const matchedProject = configDistributionMatchedProject(configDistribution)
  const matchedProjectLabel = matchedProject ? '已命中' : '未命中'
  const targetLoadError = cleanText(targetsError)
  const profileItems = profiles.map((profile, index): RelayTeamProjectInteractionItem => {
    const source = findConfigSourceForProfile(sources, profile)
    const title = `${configShareProfileTitle(profile)} 项目规则`
    const assignmentCount = typeof profile.assignmentCount === 'number' ? profile.assignmentCount : undefined
    const description = cleanTextList([
      assignmentCount == null ? '项目匹配规则' : `${assignmentCount} 条项目匹配规则`,
      configShareProfileStatusLabel(profile),
      configSourceStatusLabel(source)
    ]).join(' · ')
    return {
      description,
      icon: 'account_tree',
      key: `project-rule:${projectRuleItemId(profile, source, index)}`,
      kind: 'projectRule',
      meta: source == null ? '待同步' : matchedProject ? '当前 Git 项目命中' : '当前 Git 项目未命中',
      profile,
      ruleId: projectRuleItemId(profile, source, index),
      searchText: cleanTextList([
        '项目',
        'Git',
        '匹配规则',
        title,
        description,
        profile.id,
        profile.name,
        profile.status,
        profile.teamName,
        source?.assignmentId,
        source?.profileId,
        source?.versionId,
        ...(source?.fields ?? [])
      ]).join(' '),
      source,
      title,
      tooltip: description === '' ? title : `${title} · ${description}`
    }
  })
  const orphanSourceItems = sources
    .filter(source => profilesById.get(cleanText(source.profileId) ?? '') == null)
    .map((source, index): RelayTeamProjectInteractionItem => {
      const title = cleanText(source.profileName) ?? cleanText(source.profileId) ?? '未命名项目规则'
      const fields = configSourceFieldSummary(source)
      const description = cleanTextList([
        configSourceStatusLabel(source),
        source.mode === 'override' ? '覆盖模式' : '默认模式',
        cleanText(source.versionId) ?? (typeof source.version === 'number' ? `v${source.version}` : undefined),
        fields == null ? undefined : `字段 ${fields}`
      ]).join(' · ')
      return {
        description,
        icon: 'account_tree',
        key: `project-rule-source:${projectRuleItemId(undefined, source, index)}`,
        kind: 'projectRule',
        meta: matchedProject ? '当前 Git 项目命中' : '当前 Git 项目未命中',
        ruleId: projectRuleItemId(undefined, source, index),
        searchText: cleanTextList([
          '项目',
          'Git',
          '匹配规则',
          title,
          description,
          source.assignmentId,
          source.profileId,
          source.profileName,
          source.teamName,
          source.version,
          source.versionId,
          ...(source.fields ?? []),
          matchedProject ? '当前项目 命中' : '未命中'
        ]).join(' '),
        source,
        title,
        tooltip: description === '' ? title : `${title} · ${description}`
      }
    })
  const projectItems = [...profileItems, ...orphanSourceItems]
  const selectedRule = projectRuleId == null
    ? undefined
    : projectItems.find(item => projectRuleItemMatches(item, projectRuleId))
  const openProjectRule = (item: RelayTeamProjectInteractionItem) => {
    navigateTo(
      ctx.scope,
      routePath(ctx.scope, {
        accountKey,
        page: 'team',
        projectRuleId: item.ruleId,
        tab: 'projects',
        teamId: cleanText(team.id) ?? ''
      })
    )
  }
  const openConfigDetail = (item: RelayTeamProjectInteractionItem) => {
    const profileId = cleanText(item.profile?.id ?? item.source?.profileId)
    if (profileId == null) return
    navigateTo(
      ctx.scope,
      routePath(ctx.scope, {
        accountKey,
        configProfileId: profileId,
        page: 'team',
        tab: 'configs',
        teamId: cleanText(team.id) ?? ''
      })
    )
  }
  const getProjectActions = (
    item: RelayTeamProjectInteractionItem
  ): Array<PluginHostInteractionListAction<RelayTeamProjectInteractionItem>> => {
    const actions: Array<PluginHostInteractionListAction<RelayTeamProjectInteractionItem>> = [{
      icon: 'chevron_right',
      key: 'open-rule',
      label: '打开规则',
      onSelect: () => openProjectRule(item)
    }]
    if (cleanText(item.profile?.id ?? item.source?.profileId) != null) {
      actions.unshift({
        icon: 'rule_settings',
        key: 'open-config',
        label: '查看配置',
        onSelect: () => openConfigDetail(item)
      })
    }
    return actions
  }
  const errorNode = cleanText(targetLoadError ?? configDistribution?.lastError) == null
    ? null
    : react.createElement(
      'div',
      { className: 'oneworks-relay__config-error' },
      cleanText(targetLoadError ?? configDistribution?.lastError)
    )
  const listRoute = () => {
    navigateTo(
      ctx.scope,
      routePath(ctx.scope, {
        accountKey,
        page: 'team',
        tab: 'projects',
        teamId: cleanText(team.id) ?? ''
      })
    )
  }
  if (projectRuleId != null) {
    return react.createElement(
      'div',
      { className: 'oneworks-relay__team-projects oneworks-relay__team-configs--detail' },
      selectedRule == null
        ? react.createElement(
          'div',
          { className: 'oneworks-relay__empty' },
          targetsLoading ? '正在加载项目规则...' : '项目规则不存在或当前团队未共享该规则'
        )
        : react.createElement(TeamProjectRuleDetailPanel, {
          account,
          accountKey,
          ctx,
          matchLabel: matchedProjectLabel,
          onChanged,
          profile: selectedRule.profile,
          react,
          rule: selectedRule,
          status,
          team,
          view
        })
    )
  }

  return react.createElement(
    'div',
    { className: 'oneworks-relay__team-projects' },
    react.createElement(
      'section',
      { className: 'oneworks-relay__team-panel-section' },
      errorNode,
      InteractionList == null
        ? react.createElement('div', { className: 'oneworks-relay__empty' }, '标准项目列表组件不可用')
        : react.createElement(InteractionList, {
          actionDisplay: launcherSurface ? undefined : 'inline',
          actions: launcherSurface ? undefined : getProjectActions,
          border: 'borderless',
          className: 'oneworks-relay__host-interaction-list oneworks-relay__team-project-list',
          descriptionPlacement: launcherSurface ? undefined : 'content',
          emptyText: targetsLoading
            ? '正在加载项目规则...'
            : projectItems.length === 0
            ? '暂无 Git 项目匹配规则'
            : '没有匹配的项目规则',
          iconSize: launcherSurface ? undefined : 18,
          inlineActionLimit: launcherSurface ? undefined : 1,
          items: projectItems,
          padding: launcherSurface ? undefined : 'none',
          search: {
            onChange: setSearch,
            placeholder: '搜索 Git 项目匹配规则、配置方案或分配 ID',
            renderInput: !launcherSurface,
            value: search
          },
          splitActionHover: launcherSurface ? undefined : true,
          mode: launcherSurface ? 'launcher' : 'resource',
          onSelect: openProjectRule
        })
    )
  )
}

const TEAM_CONFIG_CONTENT_TEMPLATE: Record<string, unknown> = {
  marketplaces: {},
  modelServices: {},
  plugins: [],
  recommendedModels: [],
  skillRegistries: [],
  skills: [],
  skillsMeta: {}
}

const stringifyTeamConfigContent = (value: Record<string, unknown> | undefined) =>
  JSON.stringify(value ?? TEAM_CONFIG_CONTENT_TEMPLATE, null, 2)

const parseTeamConfigContent = (text: string): Record<string, unknown> => {
  const parsed = JSON.parse(text.trim() || '{}') as unknown
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('配置内容必须是 JSON object。')
  }
  return parsed as Record<string, unknown>
}

const activeTeamConfigVersion = (detail: RelayConfigShareProfileDetail | null, profile: RelayConfigShareProfile) => {
  const versions = detail?.versions ?? []
  const activeVersionId = cleanText(detail?.profile?.activeVersionId ?? profile.activeVersionId)
  if (activeVersionId != null) {
    const active = versions.find(version => cleanText(version.id) === activeVersionId)
    if (active != null) return active
  }
  return versions.length === 0 ? undefined : versions[versions.length - 1]
}

const teamConfigDraftPublishable = (draft: RelayConfigShareDraft | null) => (
  draft?.configPatch != null && Object.keys(draft.configPatch).length > 0
)

const TeamConfigContentEditor = (props: {
  accountKey: string
  ctx: PluginClientContext
  errorNode: PluginReactNode
  loadTargets: () => Promise<void>
  onChanged: () => void
  profile: RelayConfigShareProfile
  react: PluginReactHost
  team: RelayProfileTeam
  view?: PluginViewContext
}) => {
  const { accountKey, ctx, errorNode, loadTargets, onChanged, profile, react, team, view } = props
  const CodeEditor = view?.ui?.CodeEditor
  const profileId = cleanText(profile.id)
  const teamId = cleanText(team.id)
  const [detail, setDetail] = react.useState<RelayConfigShareProfileDetail | null>(null)
  const [text, setText] = react.useState(() => stringifyTeamConfigContent(undefined))
  const [publishedText, setPublishedText] = react.useState(() => stringifyTeamConfigContent(undefined))
  const [savedText, setSavedText] = react.useState(() => stringifyTeamConfigContent(undefined))
  const [error, setError] = react.useState<string | null>(null)
  const [draft, setDraft] = react.useState<RelayConfigShareDraft | null>(null)
  const [loading, setLoading] = react.useState(false)
  const [drafting, setDrafting] = react.useState(false)
  const [saving, setSaving] = react.useState(false)
  const [dirty, setDirty] = react.useState(false)

  react.useEffect(() => {
    if (profileId == null) {
      setDetail(null)
      const nextText = stringifyTeamConfigContent(undefined)
      setText(nextText)
      setPublishedText(nextText)
      setSavedText(nextText)
      setError('配置 ID 不存在。')
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setDraft(null)
    setDirty(false)
    void requestJson<RelayConfigShareProfileDetail>(ctx, 'config-share-profile-detail', {
      accountKey,
      profileId,
      teamId
    }).then(nextDetail => {
      if (cancelled) return
      const version = activeTeamConfigVersion(nextDetail, profile)
      const nextText = stringifyTeamConfigContent(version?.configPatch)
      setDetail(nextDetail)
      setText(nextText)
      setPublishedText(nextText)
      setSavedText(nextText)
    }).catch(nextError => {
      if (cancelled) return
      const nextText = stringifyTeamConfigContent(undefined)
      setDetail(null)
      setText(nextText)
      setPublishedText(nextText)
      setSavedText(nextText)
      setError(toErrorMessage(nextError))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [accountKey, ctx, profileId, teamId])

  const updateText = (value: string) => {
    setText(value)
    setDraft(null)
    setDirty(value !== savedText)
  }

  const saveDraft = async () => {
    try {
      setError(null)
      setDrafting(true)
      const config = parseTeamConfigContent(text)
      const nextDraft = await requestJson<RelayConfigShareDraft>(ctx, 'config-share-draft', { config })
      setDraft(nextDraft)
      setSavedText(text)
      setDirty(false)
    } catch (nextError) {
      setError(toErrorMessage(nextError))
    } finally {
      setDrafting(false)
    }
  }

  const publishConfig = async () => {
    if (profileId == null || teamId == null) return
    try {
      setError(null)
      setSaving(true)
      const config = parseTeamConfigContent(text)
      const nextDraft = draft ?? await requestJson<RelayConfigShareDraft>(ctx, 'config-share-draft', { config })
      if (!teamConfigDraftPublishable(nextDraft)) {
        setDraft(nextDraft)
        throw new Error('没有可发布的团队配置内容。')
      }
      const response = await requestJson<{ draft?: RelayConfigShareDraft }>(ctx, 'config-share-publish', {
        accountKey,
        assignToTeam: true,
        changeNote: 'Updated from team config content editor.',
        config,
        profileId,
        profileName: configShareProfileTitle(profile),
        teamId
      })
      const publishedDraft = response.draft ?? nextDraft
      const nextText = stringifyTeamConfigContent(publishedDraft.configPatch)
      setDraft(publishedDraft)
      setText(nextText)
      setPublishedText(nextText)
      setSavedText(nextText)
      setDirty(false)
      ctx.notifications?.show?.({
        level: 'success',
        title: '配置内容已保存'
      })
      await loadTargets()
      onChanged()
    } catch (nextError) {
      setError(toErrorMessage(nextError))
    } finally {
      setSaving(false)
    }
  }

  const resetContent = () => {
    setText(publishedText)
    setSavedText(publishedText)
    setDraft(null)
    setDirty(false)
    setError(null)
  }

  const cancelEdit = () => {
    setText(savedText)
    setDirty(false)
    setError(null)
  }

  const hasLocalEdits = dirty && text !== savedText
  const hasUnpublishedContent = !hasLocalEdits && savedText !== publishedText

  return react.createElement(
    'section',
    { className: 'oneworks-relay__team-config-content' },
    errorNode,
    error == null ? null : react.createElement('div', { className: 'oneworks-relay__config-error' }, error),
    react.createElement(
      'div',
      { className: 'oneworks-relay__team-config-content-editor' },
      CodeEditor == null
        ? react.createElement('textarea', {
          'aria-label': `${configShareProfileTitle(profile)} 配置 JSON`,
          className: 'oneworks-relay__textarea oneworks-relay__team-config-json-textarea',
          onInput: (event: { currentTarget?: { value?: string } }) => {
            updateText(event.currentTarget?.value ?? '')
          },
          spellCheck: false,
          value: text
        })
        : react.createElement(CodeEditor, {
          ariaLabel: `${configShareProfileTitle(profile)} 配置 JSON`,
          className: 'oneworks-relay__team-config-json-editor',
          language: 'json',
          onChange: updateText,
          path: `relay-team-config-${profileId ?? 'draft'}.json`,
          value: text
        })
    ),
    react.createElement(
      'div',
      { className: 'oneworks-relay__team-config-content-actions' },
      loading
        ? react.createElement('span', { className: 'oneworks-relay__team-config-content-state' }, '正在加载当前版本')
        : hasLocalEdits
        ? react.createElement('span', { className: 'oneworks-relay__team-config-content-state' }, '有未保存改动')
        : hasUnpublishedContent
        ? react.createElement('span', { className: 'oneworks-relay__team-config-content-state' }, '内容和上一版本不同')
        : null,
      hasLocalEdits
        ? renderActionButton(react, view, {
          disabled: loading || drafting || saving,
          icon: 'restart_alt',
          label: '重置',
          onClick: resetContent
        })
        : null,
      hasLocalEdits
        ? renderActionButton(react, view, {
          disabled: loading || drafting || saving,
          icon: 'close',
          label: '取消',
          onClick: cancelEdit
        })
        : null,
      hasLocalEdits
        ? renderActionButton(react, view, {
          disabled: loading || drafting || saving,
          icon: 'save',
          label: drafting ? '保存中' : '保存',
          onClick: () => {
            void saveDraft()
          },
          primary: true
        })
        : null,
      !hasLocalEdits
        ? renderActionButton(react, view, {
          disabled: loading || drafting || saving || !hasUnpublishedContent,
          icon: 'undo',
          label: '回退',
          onClick: resetContent
        })
        : null,
      !hasLocalEdits
        ? renderActionButton(react, view, {
          disabled: loading || drafting || saving || !hasUnpublishedContent,
          icon: 'publish',
          label: saving ? '发布中' : '发布',
          onClick: () => {
            void publishConfig()
          },
          primary: true
        })
        : null
    )
  )
}

const renderTeamConfigVersionsPanel = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  profile: RelayConfigShareProfile,
  errorNode: PluginReactNode
) =>
  react.createElement(
    'section',
    { className: 'oneworks-relay__team-config-detail' },
    errorNode,
    react.createElement(
      NativeList,
      { react },
      react.createElement(
        'div',
        { className: adminListSurfaceClassNames.nativeRow },
        react.createElement(
          'span',
          { className: adminListSurfaceClassNames.nativeIcon, 'aria-hidden': 'true' },
          renderIcon(react, view, 'tag', { size: 18 })
        ),
        react.createElement(
          'span',
          { className: adminListSurfaceClassNames.nativeMain },
          react.createElement(
            'strong',
            { className: adminListSurfaceClassNames.nativeTitle },
            valueOrDash(profile.activeVersionId)
          ),
          react.createElement(
            'span',
            { className: adminListSurfaceClassNames.nativeMeta },
            cleanTextList([
              '当前发布版本',
              configShareProfileStatusLabel(profile),
              formatDateTime(profile.updatedAt)
            ]).join(' · ')
          )
        )
      )
    )
  )

const renderTeamConfigsPanel = (props: {
  accountKey: string
  actionError: string | null
  actionId: string | null
  configDistribution: RelayConfigDistributionStatus | undefined
  configPanel?: 'content' | 'versions'
  configProfileId?: string
  ctx: PluginClientContext
  loadTargets: () => Promise<void>
  onActionErrorChange: (value: string | null) => void
  onActionIdChange: (value: string | null) => void
  onChanged: () => void
  react: PluginReactHost
  search: string
  setSearch: (value: string) => void
  targets: RelayConfigShareTargets | null
  targetsError: string | null
  targetsLoading: boolean
  team: RelayProfileTeam
  view?: PluginViewContext
}) => {
  const {
    accountKey,
    actionError,
    actionId,
    configDistribution,
    configPanel,
    configProfileId,
    ctx,
    onActionErrorChange,
    onActionIdChange,
    onChanged,
    react,
    search,
    setSearch,
    targets,
    targetsError,
    targetsLoading,
    team,
    view
  } = props
  const sources = configDistribution?.sources ?? []
  const profiles = getConfigShareProfilesForTeam(targets, team)
  const selectedProfile = profiles.find(profile => cleanText(profile.id) === configProfileId)
  const selectedSource = selectedProfile == null ? undefined : findConfigSourceForProfile(sources, selectedProfile)
  const targetLoadError = cleanText(targetsError)
  const InteractionList = view?.ui?.InteractionList
  const profileItems: RelayTeamConfigInteractionItem[] = profiles.map((profile, index) => {
    const source = findConfigSourceForProfile(sources, profile)
    const title = configShareProfileTitle(profile)
    const profileId = cleanText(profile.id)
    const description = cleanTextList([
      configShareProfileStatusLabel(profile),
      configSourceStatusLabel(source),
      typeof profile.versionCount === 'number' ? `${profile.versionCount} 个版本` : undefined
    ]).join(' · ')
    return {
      ...(source == null ? {} : { source }),
      description,
      icon: 'rule_settings',
      key: `config-profile:${profileId ?? index}`,
      kind: 'teamConfigProfile',
      profile,
      searchText: cleanTextList([
        profile.id,
        profile.name,
        profile.status,
        profile.teamName,
        description,
        source?.profileId,
        source?.profileName,
        source?.teamName,
        source?.version,
        source?.versionId,
        ...(source?.fields ?? [])
      ]).join(' '),
      title,
      tooltip: description === '' ? title : `${title} · ${description}`
    }
  })
  const detailRoute = (profile: RelayConfigShareProfile) => {
    const profileId = cleanText(profile.id)
    if (profileId == null) return
    navigateTo(
      ctx.scope,
      routePath(ctx.scope, {
        accountKey,
        configProfileId: profileId,
        page: 'team',
        tab: 'configs',
        teamId: cleanText(team.id) ?? ''
      })
    )
  }
  const listRoute = () => {
    navigateTo(
      ctx.scope,
      routePath(ctx.scope, {
        accountKey,
        page: 'team',
        tab: 'configs',
        teamId: cleanText(team.id) ?? ''
      })
    )
  }
  const backRoute = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    listRoute()
  }
  const versionsRoute = (profile: RelayConfigShareProfile) => {
    const profileId = cleanText(profile.id)
    if (profileId == null) return
    navigateTo(
      ctx.scope,
      routePath(ctx.scope, {
        accountKey,
        configPanel: 'versions',
        configProfileId: profileId,
        page: 'team',
        tab: 'configs',
        teamId: cleanText(team.id) ?? ''
      })
    )
  }
  const contentRoute = (profile: RelayConfigShareProfile) => {
    const profileId = cleanText(profile.id)
    if (profileId == null) return
    navigateTo(
      ctx.scope,
      routePath(ctx.scope, {
        accountKey,
        configPanel: 'content',
        configProfileId: profileId,
        page: 'team',
        tab: 'configs',
        teamId: cleanText(team.id) ?? ''
      })
    )
  }
  const renderToggle = (profile: RelayConfigShareProfile, source?: RelayConfigDistributionSourceStatus) =>
    renderTeamConfigToggle({
      accountKey,
      actionId,
      ctx,
      onActionErrorChange,
      onActionIdChange,
      onChanged,
      profile,
      react,
      source,
      view
    })
  const errorNode = cleanText(actionError ?? targetLoadError ?? configDistribution?.lastError) == null
    ? null
    : react.createElement(
      'div',
      { className: 'oneworks-relay__config-error' },
      cleanText(actionError ?? targetLoadError ?? configDistribution?.lastError)
    )
  const setProfileSourceEnabled = (profile: RelayConfigShareProfile, source?: RelayConfigDistributionSourceStatus) => {
    const profileId = cleanText(profile.id)
    if (profileId == null) return
    onActionErrorChange(null)
    onActionIdChange(profileId)
    void requestJson(ctx, 'config-source-enabled', {
      accountKey,
      enabled: !configSourceEnabled(source),
      id: profileId,
      kind: 'profile'
    }).then(() => {
      onChanged()
    }).catch(error => {
      onActionErrorChange(toErrorMessage(error))
    }).finally(() => {
      onActionIdChange(null)
    })
  }
  const getProfileActions = (
    item: RelayTeamConfigInteractionItem
  ): Array<PluginHostInteractionListAction<RelayTeamConfigInteractionItem>> => {
    const profileId = cleanText(item.profile.id)
    const enabled = configSourceEnabled(item.source)
    const busy = profileId != null && actionId === profileId
    return [
      {
        disabled: profileId == null || busy,
        icon: enabled ? 'toggle_on' : 'toggle_off',
        key: 'toggle',
        label: enabled ? '停用配置' : '启用配置',
        onSelect: () => setProfileSourceEnabled(item.profile, item.source)
      },
      {
        disabled: profileId == null,
        icon: 'chevron_right',
        key: 'detail',
        label: '查看配置',
        onSelect: () => detailRoute(item.profile)
      }
    ]
  }

  if (configProfileId != null) {
    const showingContent = configPanel === 'content'
    const showingVersions = configPanel === 'versions'
    const showingSubpage = showingContent || showingVersions
    const subpageTitle = showingContent ? '配置内容' : showingVersions ? '版本列表' : undefined
    return react.createElement(
      'div',
      { className: 'oneworks-relay__team-configs oneworks-relay__team-configs--detail' },
      react.createElement(
        'div',
        { className: 'route-container-inline-breadcrumb' },
        react.createElement(
          'button',
          {
            'aria-label': '返回',
            className: 'route-container-inline-breadcrumb__back route-container-inline-breadcrumb__item--button',
            onClick: backRoute,
            title: '返回',
            type: 'button'
          },
          renderIcon(react, view, 'chevron_left', { size: 18 })
        ),
        react.createElement(
          'button',
          {
            'aria-label': '打开配置列表',
            className: 'route-container-inline-breadcrumb__item route-container-inline-breadcrumb__item--button',
            onClick: listRoute,
            title: '配置列表',
            type: 'button'
          },
          react.createElement('span', null, '配置列表')
        ),
        renderIcon(react, view, 'chevron_right', {
          className: 'route-container-inline-breadcrumb__separator',
          size: 18
        }),
        selectedProfile == null || !showingSubpage
          ? react.createElement(
            'span',
            {
              className: 'route-container-inline-breadcrumb__item route-container-inline-breadcrumb__item--current'
            },
            selectedProfile == null ? '配置详情' : configShareProfileTitle(selectedProfile)
          )
          : react.createElement(
            'button',
            {
              'aria-label': '返回配置详情',
              className: 'route-container-inline-breadcrumb__item route-container-inline-breadcrumb__item--button',
              onClick: () => detailRoute(selectedProfile),
              type: 'button'
            },
            react.createElement('span', null, configShareProfileTitle(selectedProfile))
          ),
        selectedProfile == null || !showingSubpage
          ? null
          : renderIcon(react, view, 'chevron_right', {
            className: 'route-container-inline-breadcrumb__separator',
            size: 18
          }),
        selectedProfile == null || !showingSubpage
          ? null
          : react.createElement(
            'span',
            {
              className: 'route-container-inline-breadcrumb__item route-container-inline-breadcrumb__item--current'
            },
            subpageTitle
          ),
        selectedProfile == null
          ? null
          : react.createElement(
            'span',
            { className: 'route-container-inline-breadcrumb__actions' },
            showingContent
              ? null
              : renderButton(react, view, {
                icon: 'data_object',
                label: '配置内容',
                onClick: () => contentRoute(selectedProfile)
              }),
            showingVersions
              ? null
              : renderButton(react, view, {
                icon: 'history',
                label: '版本列表',
                onClick: () => versionsRoute(selectedProfile)
              }),
            renderToggle(selectedProfile, selectedSource)
          )
      ),
      selectedProfile == null
        ? react.createElement(
          'div',
          { className: 'oneworks-relay__empty' },
          targetsLoading ? '正在加载配置详情...' : '配置不存在或当前团队未共享该配置'
        )
        : showingContent
        ? react.createElement(TeamConfigContentEditor, {
          accountKey,
          ctx,
          errorNode,
          loadTargets: props.loadTargets,
          onChanged,
          profile: selectedProfile,
          react,
          team,
          view
        })
        : showingVersions
        ? renderTeamConfigVersionsPanel(react, view, selectedProfile, errorNode)
        : react.createElement(
          'section',
          { className: 'oneworks-relay__team-config-detail' },
          errorNode,
          react.createElement(
            'div',
            { className: 'oneworks-relay__team-detail-list' },
            renderTeamDetailRow(react, view, {
              description: '团队管理员填写的说明',
              icon: 'notes',
              label: '描述',
              value: valueOrDash(selectedProfile.description)
            }),
            renderTeamDetailRow(react, view, {
              description: '服务端发布版本',
              icon: 'tag',
              label: '当前版本',
              value: cleanTextList([
                selectedProfile.activeVersionId,
                formatDateTime(selectedProfile.updatedAt)
              ]).join(' · ') || '-'
            })
          )
        )
    )
  }

  return react.createElement(
    'div',
    { className: 'oneworks-relay__team-configs' },
    react.createElement(
      'section',
      { className: 'oneworks-relay__team-panel-section' },
      errorNode,
      InteractionList == null
        ? react.createElement('div', { className: 'oneworks-relay__empty' }, '标准配置列表组件不可用')
        : react.createElement(InteractionList, {
          actionDisplay: 'inline',
          actions: getProfileActions,
          border: 'borderless',
          className: 'oneworks-relay__host-interaction-list oneworks-relay__team-config-list',
          descriptionPlacement: 'content',
          emptyText: targetsLoading
            ? '正在加载团队配置...'
            : profiles.length === 0
            ? '暂无团队共享配置'
            : '没有匹配的配置',
          iconSize: 18,
          inlineActionLimit: 2,
          items: profileItems,
          padding: 'none',
          search: {
            onChange: setSearch,
            placeholder: '搜索配置名称、状态、版本或来源',
            value: search
          },
          splitActionHover: true,
          mode: 'resource',
          onSelect: (item: RelayTeamConfigInteractionItem) => detailRoute(item.profile)
        })
    )
  )
}

const renderTeamSharePanel = (props: {
  accountKey: string
  ctx: PluginClientContext
  loadTargets: () => Promise<void>
  react: PluginReactHost
  setShare: (nextValue: ShareState | ((current: ShareState) => ShareState)) => void
  share: ShareState
  team: RelayProfileTeam
  view?: PluginViewContext
}) => {
  const { accountKey, ctx, loadTargets, react, setShare, share, team, view } = props
  const teamId = cleanText(team.id)
  const canManageConfig = teamCanManageConfig(team)
  const previewShare = async () => {
    try {
      setShare(current => ({ ...current, error: null, previewing: true }))
      const draft = await requestJson<RelayConfigShareDraft>(ctx, 'config-share-draft', {
        config: JSON.parse(share.text.trim() || '{}') as Record<string, unknown>
      })
      setShare(current => ({ ...current, draft, previewing: false }))
    } catch (error) {
      setShare(current => ({ ...current, error: toErrorMessage(error), previewing: false }))
    }
  }
  const publishShare = async () => {
    if (teamId == null) return
    try {
      setShare(current => ({ ...current, error: null, publishing: true }))
      const response = await requestJson<{ draft?: RelayConfigShareDraft }>(ctx, 'config-share-publish', {
        accountKey,
        assignToTeam: true,
        config: JSON.parse(share.text.trim() || '{}') as Record<string, unknown>,
        profileName: share.profileName.trim() === '' ? `${teamDisplayName(team)} 配置` : share.profileName.trim(),
        teamId
      })
      setShare(current => ({ ...current, draft: response.draft ?? current.draft, publishing: false }))
      await loadTargets()
    } catch (error) {
      setShare(current => ({ ...current, error: toErrorMessage(error), publishing: false }))
    }
  }
  if (!canManageConfig) {
    return react.createElement(
      'div',
      { className: 'oneworks-relay__team-share' },
      renderTeamSection(
        react,
        view,
        'lock',
        '共享配置',
        '仅可使用',
        react.createElement(
          'div',
          { className: 'oneworks-relay__team-permission-note' },
          renderIcon(react, view, 'lock', { size: 16 }),
          react.createElement('span', null, '当前账号没有团队配置管理权限，不能查看或发布团队共享配置。')
        )
      )
    )
  }
  return react.createElement(
    'div',
    { className: 'oneworks-relay__team-share' },
    renderTeamSection(
      react,
      view,
      'ios_share',
      '发布团队配置',
      '管理员可见',
      share.error == null
        ? null
        : react.createElement('div', { className: 'oneworks-relay__config-error' }, share.error),
      react.createElement(
        'div',
        { className: 'oneworks-relay__team-share-layout' },
        react.createElement(
          'div',
          { className: 'oneworks-relay__team-share-form' },
          react.createElement(
            'label',
            { className: 'oneworks-relay__team-share-field' },
            react.createElement('span', null, '配置名称'),
            renderInput(react, view, {
              onChange: value => setShare(current => ({ ...current, profileName: value })),
              placeholder: '团队共享配置名称',
              value: share.profileName
            })
          ),
          react.createElement(
            'label',
            { className: 'oneworks-relay__team-share-field oneworks-relay__team-share-field--wide' },
            react.createElement('span', null, '配置 JSON'),
            renderInput(react, view, {
              onChange: value => setShare(current => ({ ...current, text: value })),
              rows: 8,
              type: 'textarea',
              value: share.text
            })
          )
        ),
        react.createElement(
          'div',
          { className: 'oneworks-relay__team-share-actions' },
          renderButton(react, view, {
            disabled: share.previewing,
            icon: 'visibility',
            label: '预览配置',
            onClick: () => {
              void previewShare()
            }
          }),
          renderButton(react, view, {
            disabled: share.loadingTargets,
            icon: 'refresh',
            label: '刷新团队配置',
            onClick: () => {
              void loadTargets()
            }
          }),
          renderButton(react, view, {
            disabled: share.publishing,
            icon: 'check',
            label: '发布配置',
            onClick: () => {
              void publishShare()
            },
            primary: true
          })
        )
      )
    ),
    renderTeamSection(
      react,
      view,
      'fact_check',
      '预览结果',
      share.draft == null ? '待预览' : '已生成',
      react.createElement(
        'div',
        { className: 'oneworks-relay__team-metric-grid oneworks-relay__team-metric-grid--compact' },
        renderTeamMetric(react, view, {
          icon: 'checklist',
          label: '字段',
          value: String(share.draft?.allowedFields?.length ?? 0)
        }),
        renderTeamMetric(react, view, {
          icon: 'key',
          label: '密钥引用',
          value: String(share.draft?.secretItems?.length ?? 0)
        }),
        renderTeamMetric(react, view, {
          icon: 'warning',
          label: '问题',
          tone: (share.draft?.issues?.length ?? 0) > 0 ? 'warning' : 'success',
          value: String(share.draft?.issues?.length ?? 0)
        }),
        renderTeamMetric(react, view, {
          icon: 'block',
          label: '拒绝字段',
          tone: (share.draft?.rejectedFields?.length ?? 0) > 0 ? 'danger' : 'neutral',
          value: String(share.draft?.rejectedFields?.length ?? 0)
        })
      )
    )
  )
}

const renderSectionHead = (
  react: PluginReactHost,
  view: PluginViewContext | undefined,
  icon: string,
  title: string,
  meta?: string
) =>
  react.createElement(
    'div',
    { className: 'oneworks-relay__team-section-head' },
    react.createElement(
      'span',
      { className: 'oneworks-relay__team-section-title' },
      renderIcon(react, view, icon, { size: 16 }),
      react.createElement('strong', null, title)
    ),
    meta == null ? null : react.createElement('span', { className: 'oneworks-relay__team-section-meta' }, meta)
  )

const ProfilePage = (props: {
  accountKey: string
  ctx: PluginClientContext
  onChanged: () => void
  profile: RelayProfileStatus | null
  react: PluginReactHost
  status: RelayStatus | null
  tab: RelayProfileTab
  view?: PluginViewContext
}) => {
  const { accountKey, ctx, onChanged, profile, react, status, tab, view } = props
  const launcherSurface = isLauncherSurface(view)
  const account = getProfileAccount(profile, status, accountKey)
  const panel = tab === 'teams'
    ? react.createElement(TeamsPanel, { accountKey, ctx, profile, react, view })
    : tab === 'documents'
    ? react.createElement(DocumentSyncPanel, { account, accountKey, ctx, onChanged, react, status, view })
    : tab === 'devices'
    ? react.createElement(DevicesPanel, { accountKey, ctx, profile, react, status, view })
    : tab === 'security'
    ? react.createElement(SecurityPanel, { accountKey, ctx, onChanged, profile, react, view })
    : tab === 'tokens'
    ? react.createElement(TokensPanel, { accountKey, ctx, profile, react, view })
    : react.createElement(AccountInfoPanel, { account, profile, react })
  return react.createElement(
    'main',
    { className: tab === 'documents' ? 'oneworks-relay oneworks-relay--documents-tab' : 'oneworks-relay' },
    react.createElement(
      'div',
      { className: 'oneworks-relay__shell' },
      react.createElement(
        'section',
        { className: 'oneworks-relay__surface' },
        react.createElement(
          'section',
          {
            className: [
              'oneworks-relay__profile',
              launcherSurface ? 'oneworks-relay__profile--launcher' : '',
              tab === 'documents' ? 'oneworks-relay__profile--documents-tab' : ''
            ].filter(Boolean).join(' ')
          },
          launcherSurface ? null : react.createElement(ProfileHeader, { account, accountKey, profile, react }),
          react.createElement(ProfileTabs, { account, accountKey, activeTab: tab, ctx, onChanged, react, view }),
          react.createElement(
            'div',
            {
              className: [
                'oneworks-relay__profile-tab-panel native-tabs-panel',
                tab === 'documents' ? 'oneworks-relay__documents-panel' : ''
              ].filter(Boolean).join(' ')
            },
            panel
          )
        )
      )
    )
  )
}

export const RelayHomeView = (props: {
  ctx: PluginClientContext
  onAccountChanged?: () => Promise<void> | void
  view?: PluginViewContext
}) => {
  const { ctx, onAccountChanged, view } = props
  const react = ctx.react
  const signature = useLocationSignature(react, ctx.scope)
  const route = react.useMemo(() => parseRoute(ctx.scope), [ctx.scope, signature])
  const [revision, setRevision] = react.useState(0)
  const refreshData = () => setRevision(current => current + 1)
  const statusState = useAsyncStatus(react, ctx, revision)
  const accountKey = 'accountKey' in route ? route.accountKey : undefined
  const profileState = useAsyncProfile(react, ctx, accountKey, revision)
  const status = statusState.data
  const profile = profileState.data
  const account = getProfileAccount(profile, status, accountKey)
  const accountName = accountDisplayName(account)
  const onLoginComplete = async () => {
    refreshData()
    await onAccountChanged?.()
  }

  react.useEffect(() => {
    const callback = readLoginCallback()
    if (callback == null) return undefined
    clearLoginCallbackFromUrl()
    void completeRelayLoginCallback(ctx, callback, onLoginComplete).then(() => {
      navigateTo(ctx.scope, routePath(ctx.scope, { page: 'accounts' }))
    }).catch(error => ctx.notifications?.show?.({ level: 'error', title: toErrorMessage(error) }))
    return undefined
  }, [ctx])

  react.useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onMessage = (event: MessageEvent) => {
      const url = typeof event.data === 'string'
        ? event.data
        : typeof event.data === 'object' && event.data != null &&
            typeof (event.data as { url?: unknown }).url === 'string'
        ? (event.data as { url: string }).url
        : ''
      const callback: RelayLoginCallback | undefined = url === '' ? undefined : readLoginCallbackFromUrl(url)
      if (callback == null) return
      void completeRelayLoginCallback(ctx, callback, onLoginComplete).then(() => {
        navigateTo(ctx.scope, routePath(ctx.scope, { page: 'accounts' }))
      }).catch(error => ctx.notifications?.show?.({ level: 'error', title: toErrorMessage(error) }))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [ctx])

  react.useEffect(() => {
    const launcherSurface = isLauncherSurface(view)
    const goAccounts = () => navigateTo(ctx.scope, routePath(ctx.scope, { page: 'accounts' }))
    const goAccount = () => {
      if (accountKey != null) {
        navigateTo(ctx.scope, routePath(ctx.scope, { accountKey, page: 'profile', tab: 'account' }))
      }
    }
    const loginAction: PluginViewRouteHeaderAction = {
      icon: 'login',
      key: 'login',
      label: launcherSurface ? '登录' : '登录账号',
      onSelect: () => navigateTo(ctx.scope, routePath(ctx.scope, { page: 'login' }))
    }
    const accountActions: PluginViewRouteHeaderAction[] = launcherSurface
      ? [loginAction]
      : [
        {
          icon: 'add_circle',
          key: 'servers',
          label: '加入服务器',
          onSelect: () => navigateTo(ctx.scope, routePath(ctx.scope, { page: 'servers' }))
        },
        loginAction
      ]
    const actions: PluginViewRouteHeaderAction[] = route.page === 'accounts'
      ? accountActions
      : route.page === 'profile'
      ? [
        {
          icon: account?.enabled === false ? 'toggle_on' : 'toggle_off',
          key: 'toggle',
          label: account?.enabled === false ? '启用账号' : '禁用账号',
          onSelect: () => {
            const key = accountKey ?? ''
            void requestJson(ctx, account?.enabled === false ? 'users/enable' : 'users/disable', { accountKey: key })
              .then(refreshData)
          }
        },
        {
          icon: 'logout',
          key: 'logout',
          label: '退出登录',
          onSelect: () => {
            const key = accountKey ?? ''
            void requestJson(ctx, 'users/logout', { accountKey: key }).then(refreshData)
          }
        }
      ]
      : route.page === 'token' && route.tokenId !== 'new'
      ? [
        {
          danger: true,
          icon: 'block',
          key: 'revoke-token',
          label: '撤销令牌',
          onSelect: () => {
            void requestJson(ctx, `profile/access-tokens/${encodeURIComponent(route.tokenId)}`, {
              accountKey: route.accountKey
            }, 'DELETE').then(() =>
              navigateTo(
                ctx.scope,
                routePath(ctx.scope, {
                  accountKey: route.accountKey,
                  page: 'profile',
                  tab: 'tokens'
                })
              )
            )
          }
        }
      ]
      : []
    view?.route?.setActions?.(actions)
    if (route.page === 'accounts') {
      view?.route?.setTitle?.('账号')
      view?.route?.setLauncherChrome?.({ icon: 'account_circle', searchTitle: '账号', title: '账号' })
      view?.route?.setBreadcrumb?.(undefined)
    } else if (route.page === 'servers') {
      view?.route?.setTitle?.('服务器')
      view?.route?.setLauncherChrome?.({ icon: 'lan', searchTitle: '服务器', title: '服务器' })
      view?.route?.setBreadcrumb?.({
        currentTitle: '服务器',
        onBack: goAccounts,
        parentTitle: '账号'
      })
    } else if (route.page === 'login') {
      view?.route?.setTitle?.('登录')
      view?.route?.setLauncherChrome?.({ icon: 'login', searchTitle: '登录', title: '登录' })
      view?.route?.setBreadcrumb?.({
        currentTitle: '登录',
        onBack: goAccounts,
        parentTitle: '账号'
      })
    } else if (route.page === 'messages') {
      view?.route?.setTitle?.('消息')
      view?.route?.setLauncherChrome?.({ icon: 'mail', searchTitle: '消息', title: '消息' })
      view?.route?.setBreadcrumb?.({
        ancestors: [
          { onSelect: goAccount, title: accountName }
        ],
        currentTitle: '消息',
        onBack: goAccount,
        parentTitle: accountName
      })
    } else if (route.page === 'profile') {
      view?.route?.setTitle?.('账号详情')
      view?.route?.setLauncherChrome?.({
        avatarInitials: getAvatarInitials(accountName),
        avatarUrl: cleanText(account?.avatarUrl ?? profile?.user?.avatarUrl),
        searchTitle: profileTabLabel(route.tab),
        title: accountName
      })
      view?.route?.setBreadcrumb?.({
        currentTitle: accountName,
        onBack: goAccounts,
        parentTitle: '账号'
      })
    } else if (route.page === 'team') {
      const team = profile?.teams?.find(item => cleanText(item.id) === route.teamId)
      const teamTitle = team == null ? cleanText(route.teamId) ?? '团队' : teamDisplayName(team)
      const accountTitle = account == null ? cleanText(route.accountKey) ?? accountName : accountName
      const projectRuleId = cleanText(route.projectRuleId)
      const projectRuleDetail = route.tab === 'projects' && projectRuleId != null
      const projectRuleTitle = projectRuleTitleFromId(projectRuleId)
      const backToTeams = () =>
        navigateTo(
          ctx.scope,
          routePath(ctx.scope, {
            accountKey: route.accountKey,
            page: 'profile',
            tab: 'teams'
          })
        )
      const goTeamOverview = () =>
        navigateTo(
          ctx.scope,
          routePath(ctx.scope, {
            accountKey: route.accountKey,
            page: 'team',
            tab: 'overview',
            teamId: route.teamId
          })
        )
      const backToProjectRules = () =>
        navigateTo(
          ctx.scope,
          routePath(ctx.scope, {
            accountKey: route.accountKey,
            page: 'team',
            tab: 'projects',
            teamId: route.teamId
          })
        )
      view?.route?.setTitle?.(projectRuleDetail ? '项目规则详情' : '团队详情')
      view?.route?.setLauncherChrome?.({
        avatarInitials: getAvatarInitials(teamTitle),
        avatarUrl: cleanText(team?.avatarUrl),
        searchTitle: projectRuleDetail ? '项目规则详情' : teamDetailTabLabel(route.tab, route.configPanel),
        title: projectRuleDetail ? projectRuleTitle : teamTitle
      })
      view?.route?.setBreadcrumb?.(
        projectRuleDetail
          ? {
            ancestors: [
              { onSelect: goAccounts, title: '账号' },
              { onSelect: goAccount, title: accountTitle },
              { onSelect: backToTeams, title: '团队' },
              { onSelect: goTeamOverview, title: teamTitle }
            ],
            currentTitle: projectRuleTitle,
            onBack: backToProjectRules,
            parentTitle: '项目规则'
          }
          : {
            ancestors: [
              { onSelect: goAccounts, title: '账号' },
              { onSelect: goAccount, title: accountTitle }
            ],
            currentTitle: teamTitle,
            onBack: backToTeams,
            parentTitle: '团队'
          }
      )
    } else if (route.page === 'device') {
      const device = profile?.devices?.find(item => cleanText(item.id) === route.deviceId)
      const deviceTitle = device == null ? cleanText(route.deviceId) ?? '设备' : deviceDisplayName(device)
      const accountTitle = account == null ? cleanText(route.accountKey) ?? accountName : accountName
      const isCurrentDevice = device == null ? false : isCurrentClientDevice(ctx, device, status)
      const backToDevices = () =>
        navigateTo(
          ctx.scope,
          routePath(ctx.scope, {
            accountKey: route.accountKey,
            page: 'profile',
            tab: 'devices'
          })
        )
      view?.route?.setTitle?.('设备详情')
      view?.route?.setLauncherChrome?.({
        icon: isCurrentDevice ? 'important_devices' : 'computer',
        searchTitle: deviceDetailTabLabel(route.tab),
        title: deviceTitle
      })
      view?.route?.setBreadcrumb?.({
        ancestors: [
          { onSelect: goAccounts, title: '账号' },
          { onSelect: goAccount, title: accountTitle }
        ],
        currentTitle: deviceTitle,
        onBack: backToDevices,
        parentTitle: '设备'
      })
    } else {
      const token = profile?.security?.accessTokens?.find(item => cleanText(item.id) === route.tokenId)
      view?.route?.setTitle?.(route.tokenId === 'new' ? '新建令牌' : '令牌详情')
      view?.route?.setLauncherChrome?.({
        icon: 'key',
        searchTitle: route.tokenId === 'new' ? '新建令牌' : '令牌详情',
        title: route.tokenId === 'new' ? '新建令牌' : cleanText(token?.name) ?? route.tokenId
      })
      view?.route?.setBreadcrumb?.({
        ancestors: [
          { onSelect: goAccounts, title: '账号' },
          { onSelect: goAccount, title: accountName }
        ],
        currentTitle: route.tokenId === 'new' ? '新建令牌' : cleanText(token?.name) ?? route.tokenId,
        onBack: () =>
          navigateTo(
            ctx.scope,
            routePath(ctx.scope, {
              accountKey: route.accountKey,
              page: 'profile',
              tab: 'tokens'
            })
          ),
        parentTitle: '令牌'
      })
    }
    return () => {
      view?.route?.setActions?.(undefined)
      view?.route?.setBreadcrumb?.(undefined)
      view?.route?.setLauncherChrome?.(undefined)
      view?.route?.setTitle?.(undefined)
    }
  }, [account?.avatarUrl, account?.enabled, accountKey, accountName, ctx.scope, profile, route, status, view])

  const error = statusState.error ?? profileState.error
  if (error != null && route.page !== 'login') {
    return react.createElement(
      'main',
      { className: 'oneworks-relay' },
      react.createElement(
        'div',
        { className: 'oneworks-relay__shell' },
        react.createElement(
          'section',
          { className: 'oneworks-relay__surface' },
          react.createElement('div', { className: 'oneworks-relay__config-error' }, error)
        )
      )
    )
  }

  if (route.page === 'accounts') {
    return react.createElement(AccountsPage, {
      ctx,
      onChanged: refreshData,
      react,
      status,
      view
    })
  }
  if (route.page === 'servers') {
    return react.createElement(ServersPage, {
      ctx,
      onChanged: refreshData,
      react,
      status,
      view
    })
  }
  if (route.page === 'login') {
    return react.createElement(LoginPage, {
      ctx,
      onLoginComplete,
      react,
      route,
      serverName: selectedServerDisplayName(status, route.serverId),
      view
    })
  }
  if (route.page === 'messages') {
    return react.createElement(MessagesPage, { profile, react, view })
  }
  if (route.page === 'team') {
    return react.createElement(TeamDetailView, {
      accountKey: route.accountKey,
      configPanel: route.configPanel,
      configProfileId: route.configProfileId,
      ctx,
      onChanged: refreshData,
      profile,
      profileLoading: profileState.loading,
      projectRuleId: route.projectRuleId,
      react,
      status,
      tab: route.tab,
      teamId: route.teamId,
      view
    })
  }
  if (route.page === 'device') {
    return react.createElement(DeviceDetailView, {
      account,
      accountKey: route.accountKey,
      ctx,
      deviceId: route.deviceId,
      profile,
      react,
      status,
      tab: route.tab,
      view
    })
  }
  if (route.page === 'token') {
    return react.createElement(TokenEditorPage, {
      accountKey: route.accountKey,
      ctx,
      onChanged: refreshData,
      profile,
      react,
      tokenId: route.tokenId,
      view
    })
  }
  return react.createElement(ProfilePage, {
    accountKey: route.accountKey,
    ctx,
    onChanged: refreshData,
    profile,
    react,
    status,
    tab: route.tab,
    view
  })
}

export type RelayHomeViewNode = ReturnType<typeof RelayHomeView>
