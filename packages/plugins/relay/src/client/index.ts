/* eslint-disable max-lines -- relay client entry wires plugin lifecycle, status polling, and account controls. */
import {
  LOCAL_RELAY_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_DEV_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID,
  OFFICIAL_RELAY_VERCEL_DEV_SERVER_ID,
  OFFICIAL_RELAY_VERCEL_SERVER_ID
} from '../shared/official-services.js'
import { createRelayClientI18n, relayClientLauncherStatusTitleI18n } from './i18n.js'
import { openRelayLogin } from './login-action.js'
import { RelayHomeView } from './react-view.js'
import { relayClientCss } from './styles.js'
import type {
  Disposable,
  PluginClientContext,
  PluginViewRegistration,
  RelayAuthAccount,
  RelayServerStatus,
  RelayStatus
} from './types.js'

const ACCOUNT_FOOTER_REFRESH_INTERVAL_MS = 120_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const toCleanString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const slugify = (value: string, fallback = 'item', maxLength = 48) => {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '')
  return (slug === '' ? fallback : slug).slice(0, maxLength)
}

const getAccountDisplayName = (account: RelayAuthAccount) => (
  toCleanString(account.name) ??
    toCleanString(account.loginId) ??
    toCleanString(account.email) ??
    toCleanString(account.userId) ??
    '账号'
)

const getAccountMeta = (account: RelayAuthAccount, name: string) =>
  [
    toCleanString(account.email),
    toCleanString(account.loginId),
    toCleanString(account.userId)
  ].filter((value): value is string => value != null && value !== name)[0]

const getAvatarInitials = (name: string) => {
  const normalized = name.trim()
  if (normalized === '') return 'AC'
  const parts = normalized.split(/\s+/u).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
  return normalized.slice(0, 2).toUpperCase()
}

const getPreferredAccount = (accounts: RelayAuthAccount[]) => (
  accounts.find(account => account.enabled !== false && account.sessionAuthenticated === true) ??
    accounts.find(account => account.sessionAuthenticated === true) ??
    accounts[0]
)

const normalizeComparableUrl = (value?: string) => {
  const text = toCleanString(value)
  if (text == null) return undefined
  try {
    const url = new URL(text)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/u, '')
  } catch {
    return text.replace(/\/$/u, '')
  }
}

const isOfficialServerId = (value?: string) => (
  value === OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID ||
  value === OFFICIAL_RELAY_CLOUDFLARE_DEV_SERVER_ID ||
  value === OFFICIAL_RELAY_VERCEL_SERVER_ID ||
  value === OFFICIAL_RELAY_VERCEL_DEV_SERVER_ID
)

const isOfficialAccountAlias = (value?: string) => {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'cf' ||
    normalized === 'cloudflare' ||
    normalized === 'cf-dev' ||
    normalized === 'cloudflare-dev' ||
    normalized === 'vc' ||
    normalized === 'vercel' ||
    normalized === 'vc-dev' ||
    normalized === 'vercel-dev'
}

const findServerForAccount = (
  account: RelayAuthAccount,
  servers: RelayServerStatus[]
) => {
  const serverId = toCleanString(account.serverId)
  const serverUrl = normalizeComparableUrl(account.serverUrl)
  return servers.find(server =>
    toCleanString(server.id) === serverId ||
    normalizeComparableUrl(server.remoteBaseUrl) === serverUrl
  )
}

const getAccountServerKey = (account: RelayAuthAccount) => (
  toCleanString(account.serverId) ??
    normalizeComparableUrl(account.serverUrl) ??
    toCleanString(account.serverAlias) ??
    ''
)

const getServerGroupLabel = (
  account: RelayAuthAccount,
  servers: RelayServerStatus[],
  t: ReturnType<typeof createRelayClientI18n>
) => {
  const server = findServerForAccount(account, servers)
  const serverId = toCleanString(server?.id ?? account.serverId)
  if (server?.official === true || isOfficialServerId(serverId) || isOfficialAccountAlias(account.serverAlias)) {
    return t.accounts.defaultServer
  }
  if (serverId === LOCAL_RELAY_SERVER_ID || toCleanString(account.serverAlias)?.toLowerCase() === 'local') {
    return t.accounts.localServer
  }
  const name = toCleanString(server?.name)
  if (name == null || /^https?:\/\//iu.test(name) || name === toCleanString(server?.remoteBaseUrl)) {
    return t.accounts.serverFallback
  }
  return name
}

const getAccountProfileRoute = (ctx: PluginClientContext, account?: RelayAuthAccount, tab = 'account') => {
  const accountKey = toCleanString(account?.accountKey)
  const route = `/plugins/${encodeURIComponent(ctx.scope)}/home/accounts`
  if (accountKey == null) return route
  return `${route}/${encodeURIComponent(accountKey)}/${encodeURIComponent(tab)}`
}

const getAccountMessagesRoute = (ctx: PluginClientContext, account?: RelayAuthAccount) => {
  const accountKey = toCleanString(account?.accountKey)
  const route = `/plugins/${encodeURIComponent(ctx.scope)}/home/accounts`
  if (accountKey == null) return route
  return `${route}/${encodeURIComponent(accountKey)}/messages`
}

const buildAccountPopoverAccount = (
  ctx: PluginClientContext,
  account: RelayAuthAccount,
  index: number
) => {
  const accountKey = toCleanString(account.accountKey) ?? `account-${index + 1}`
  const name = getAccountDisplayName(account)
  const meta = getAccountMeta(account, name)
  return {
    actions: [
      {
        icon: 'notifications',
        id: 'notifications',
        route: getAccountMessagesRoute(ctx, account),
        title: '通知'
      },
      {
        command: 'logout-account',
        danger: true,
        disabled: toCleanString(account.accountKey) == null,
        icon: 'logout',
        id: 'logout',
        payload: { accountKey: toCleanString(account.accountKey) },
        title: '退出'
      }
    ],
    avatarUrl: toCleanString(account.avatarUrl),
    description: meta,
    id: `account-${slugify(accountKey, 'account')}`,
    initials: getAvatarInitials(name),
    name,
    route: getAccountProfileRoute(ctx, account)
  }
}

const buildAccountPopoverGroups = (
  ctx: PluginClientContext,
  accounts: RelayAuthAccount[],
  servers: RelayServerStatus[],
  t: ReturnType<typeof createRelayClientI18n>
) => {
  if (accounts.length === 0) {
    return {
      accounts: [{
        actions: [],
        id: 'account-empty',
        initials: 'AC',
        name: t.emptyAccounts
      }]
    }
  }

  const serverKeys = new Set(accounts.map(getAccountServerKey))
  if (serverKeys.size <= 1) {
    return { accounts: accounts.map((account, index) => buildAccountPopoverAccount(ctx, account, index)) }
  }

  const groups = new Map<string, RelayAuthAccount[]>()
  accounts.forEach((account) => {
    const key = getAccountServerKey(account)
    groups.set(key, [...(groups.get(key) ?? []), account])
  })

  return {
    groups: [...groups.entries()].map(([key, groupAccounts]) => ({
      accounts: groupAccounts.map((account, index) => buildAccountPopoverAccount(ctx, account, index)),
      collapsed: true,
      id: `server-${slugify(key, 'server')}`,
      initials: getAvatarInitials(getServerGroupLabel(groupAccounts[0] ?? {}, servers, t)),
      title: getServerGroupLabel(groupAccounts[0] ?? {}, servers, t)
    }))
  }
}

const buildRelayAccountFooterContribution = (ctx: PluginClientContext, status: RelayStatus | null) => {
  const t = createRelayClientI18n(ctx.i18n)
  const accounts = Array.isArray(status?.accounts) ? status.accounts : []
  const servers = Array.isArray(status?.servers) ? status.servers : []
  const manageAccount = accounts.length === 1 ? accounts[0] : undefined

  return {
    accountPopover: {
      ...buildAccountPopoverGroups(ctx, accounts, servers, t),
      actions: [
        {
          command: 'login',
          icon: 'login',
          id: 'login',
          title: '登录账号'
        },
        {
          icon: 'manage_accounts',
          id: 'manage',
          route: getAccountProfileRoute(ctx, manageAccount),
          title: '管理账号'
        }
      ]
    },
    id: 'account-popover',
    title: t.accounts.title,
    icon: 'account_circle'
  }
}

const fetchRelayStatus = async (ctx: PluginClientContext): Promise<RelayStatus | null> => {
  try {
    const response = await ctx.api.fetch('relay/status')
    if (!response.ok) return null
    const value = await response.json()
    return isRecord(value) ? value as RelayStatus : null
  } catch {
    return null
  }
}

export async function activatePlugin(ctx: PluginClientContext) {
  const style = document.createElement('style')
  style.textContent = relayClientCss
  document.head.appendChild(style)

  let disposed = false
  let accountFooterDisposable: Disposable | null = null
  let accountFooterSignature = ''
  const refreshAccountFooter = async () => {
    const registerSlot = ctx.slots?.register
    if (registerSlot == null) return
    // Mirrors Relay Admin's lower-left account popover; keep menu semantics in sync with AdminNavRail.
    const contribution = buildRelayAccountFooterContribution(ctx, await fetchRelayStatus(ctx))
    const signature = JSON.stringify(contribution)
    if (signature === accountFooterSignature) return
    accountFooterDisposable?.dispose()
    accountFooterDisposable = null
    accountFooterSignature = signature
    const nextDisposable = registerSlot('nav.footer.before', contribution)
    if (disposed) {
      nextDisposable.dispose()
      return
    }
    accountFooterDisposable = nextDisposable
  }
  const logoutAccount = async (accountKey: string) => {
    const response = await ctx.api.fetch('relay/users/logout', {
      body: JSON.stringify({ accountKey }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    if (!response.ok) {
      throw new Error(await response.text())
    }
    const result = await response.json()
    ctx.notifications?.show?.({
      level: 'success',
      title: '已退出登录'
    })
    await refreshAccountFooter()
    return result
  }
  const logoutActiveAccount = async () => {
    const status = await fetchRelayStatus(ctx)
    const account = getPreferredAccount(Array.isArray(status?.accounts) ? status.accounts : [])
    const accountKey = toCleanString(account?.accountKey)
    if (accountKey == null) {
      throw new Error(createRelayClientI18n(ctx.i18n).emptyAccounts)
    }
    return await logoutAccount(accountKey)
  }
  const logoutAccountFromPayload = async (payload?: unknown) => {
    const accountKey = isRecord(payload) ? toCleanString(payload.accountKey) : undefined
    if (accountKey == null) {
      throw new Error(createRelayClientI18n(ctx.i18n).emptyAccounts)
    }
    return await logoutAccount(accountKey)
  }
  const setIntervalFn = typeof window.setInterval === 'function'
    ? window.setInterval.bind(window)
    : globalThis.setInterval.bind(globalThis)
  const clearIntervalFn = typeof window.clearInterval === 'function'
    ? window.clearInterval.bind(window)
    : globalThis.clearInterval.bind(globalThis)
  const documentRef = typeof document === 'undefined' ? undefined : document
  const shouldRefreshAccountFooter = () => documentRef?.visibilityState !== 'hidden'
  const refreshAccountFooterIfVisible = () => {
    if (!shouldRefreshAccountFooter()) return
    void refreshAccountFooter().catch((error) => {
      console.warn('[relay] failed to refresh account footer', error)
    })
  }
  const handleVisibilityChange = () => {
    if (shouldRefreshAccountFooter()) {
      refreshAccountFooterIfVisible()
    }
  }
  if (typeof documentRef?.addEventListener === 'function') {
    documentRef.addEventListener('visibilitychange', handleVisibilityChange)
  }
  const accountFooterRefreshTimer = setIntervalFn(
    refreshAccountFooterIfVisible,
    ACCOUNT_FOOTER_REFRESH_INTERVAL_MS
  )
  const renderHome: PluginViewRegistration = {
    renderNode: view => ctx.react.createElement(RelayHomeView, { ctx, view })
  }

  const disposables: Disposable[] = [
    ctx.views.register('home', renderHome),
    ctx.commands.register('connect', async () => {
      const response = await ctx.api.fetch('relay/connect', { method: 'POST' })
      return await response.json()
    }),
    ctx.commands.register('disconnect', async () => {
      const response = await ctx.api.fetch('relay/disconnect', { method: 'POST' })
      return await response.json()
    }),
    ctx.commands.register('config-refresh', async (payload?: unknown) => {
      const body = isRecord(payload) ? payload : undefined
      const response = await ctx.api.fetch('relay/config-refresh', {
        body: body == null ? undefined : JSON.stringify(body),
        headers: body == null ? undefined : { 'content-type': 'application/json' },
        method: 'POST'
      })
      if (response.ok) return await response.json()
      if (response.status === 404 || response.status === 405) {
        const statusResponse = await ctx.api.fetch('relay/status')
        return await statusResponse.json()
      }
      const text = await response.text()
      throw new Error(
        text || createRelayClientI18n(ctx.i18n).errors.relayActionFailed('config-refresh', response.status)
      )
    }),
    ctx.commands.register('login', async () => {
      try {
        const result = await openRelayLogin(ctx, { forcePluginHomeRedirect: true })
        await refreshAccountFooter()
        return result
      } catch (error) {
        ctx.notifications?.show?.({
          description: error instanceof Error ? error.message : String(error),
          level: 'error',
          title: createRelayClientI18n(ctx.i18n).errors.loginUrlMissing
        })
        throw error
      }
    }),
    ctx.commands.register('logout-active', logoutActiveAccount),
    ctx.commands.register('logout-account', logoutAccountFromPayload),
    ctx.commands.register('search', () => [{
      id: 'status',
      title: createRelayClientI18n(ctx.i18n).launcher.statusTitle,
      titleI18n: relayClientLauncherStatusTitleI18n,
      icon: 'account_circle'
    }])
  ]

  void refreshAccountFooter().catch((error) => {
    console.warn('[relay] failed to register account footer', error)
  })

  return {
    dispose() {
      disposed = true
      if (typeof documentRef?.removeEventListener === 'function') {
        documentRef.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      clearIntervalFn(accountFooterRefreshTimer)
      accountFooterDisposable?.dispose()
      disposables.forEach(disposable => disposable.dispose())
      style.remove()
    }
  }
}
