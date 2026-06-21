/* eslint-disable max-lines -- profile page keeps current-account security modals and one-time token reveal together. */
import './ProfilePage.css'

import { startRegistration } from '@simplewebauthn/browser'
import {
  Alert,
  Avatar,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Popover,
  Select,
  Spin,
  Tabs,
  Tag,
  notification
} from 'antd'
import type { DescriptionsProps, TableColumnsType } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { RequestJsonError } from '../../shared/api/requestJson'
import type {
  RelayAdminAccessGroup,
  RelayAdminCurrentUser,
  RelayAdminDevice,
  RelayAdminDeviceStatus
} from '../../shared/model/adminTypes'
import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import type { AdminIconName } from '../../shared/ui/AdminIcon'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { AdminSessionAccount } from '../auth/adminSessionStorage'
import { DeviceTable } from '../devices/DeviceTable'
import type { RelayAdminTeam } from '../teams/teamTypes'
import {
  changeRelayProfilePassword,
  createRelayProfileAccessToken,
  createRelayProfilePasskeyOptions,
  deleteRelayProfileAccount,
  fetchRelayProfileOpenApiAuditEvents,
  fetchRelayProfileSecurity,
  revokeRelayProfileAccessToken,
  updateRelayProfileAccessToken,
  verifyRelayProfilePasskey
} from './profileApi'
import type {
  RelayProfileAccessToken,
  RelayProfileAccessTokenScope,
  RelayProfileOpenApiAuditEvent,
  RelayProfileSecuritySummary
} from './profileApi'

export interface ProfilePageProps {
  accounts: AdminSessionAccount[]
  activeToken: string
  accessGroups: RelayAdminAccessGroup[]
  currentUser?: RelayAdminCurrentUser
  devices: RelayAdminDevice[]
  teams: RelayAdminTeam[]
  onAccountDeleted?: () => void
}

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

const userDisplayName = (user: RelayAdminCurrentUser) => user.name.trim() || user.email

const normalizeAuditStatus = (status: number) => {
  if (status >= 200 && status < 400) return 'success'
  if (status === 429) return 'warning'
  if (status >= 400) return 'danger'
  return 'muted'
}

const methodTone = (method: string) => {
  if (method === 'GET') return 'blue'
  if (method === 'POST') return 'green'
  if (method === 'PATCH' || method === 'PUT') return 'orange'
  if (method === 'DELETE') return 'red'
  return 'default'
}

const profileTabKeys = ['account', 'devices', 'security', 'tokens', 'audit'] as const
type ProfileTabKey = typeof profileTabKeys[number]
type DeviceStatusFilter = RelayAdminDeviceStatus | 'all'

const defaultProfileTabKey: ProfileTabKey = 'account'
const profileTabKeySet = new Set<string>(profileTabKeys)
const isProfileTabKey = (value: string | undefined): value is ProfileTabKey =>
  value != null && profileTabKeySet.has(value)
const profileTabPath = (tabKey: ProfileTabKey) => `/profile/${tabKey}`
const isMissingProfileSecurityEndpoint = (error: unknown) => (
  error instanceof RequestJsonError
    ? error.status === 404
    : error instanceof Error && error.message === 'Not found.'
)
const queryValue = (params: URLSearchParams, key: string) => params.get(key)?.trim() ?? ''

const defaultTokenVisibleColumnKeys = [
  'name',
  'scope',
  'tokenPreview',
  'permissionGroups',
  'createdAt',
  'lastUsedAt',
  'status'
]
const defaultAuditVisibleColumnKeys = [
  'createdAt',
  'tokenPreview',
  'method',
  'path',
  'status',
  'permission',
  'ip'
]

const tokenColumnOptions: AdminListColumnOption[] = [
  { key: 'name', label: '名称', required: true },
  { key: 'scope', label: '类型' },
  { key: 'tokenPreview', label: 'Preview' },
  { key: 'permissionGroups', label: '权限范围' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'lastUsedAt', label: '最后使用' },
  { key: 'status', label: '状态', required: true }
]

type TokenStatusFilter = 'active' | 'all' | 'revoked'

const tokenStatusOptions = [
  { label: '全部状态', value: 'all' },
  { label: 'active', value: 'active' },
  { label: 'revoked', value: 'revoked' }
] satisfies Array<{ label: string; value: TokenStatusFilter }>

const tokenStatusFilterValues = new Set<string>(tokenStatusOptions.map(option => option.value))
const readTokenStatusFilter = (params: URLSearchParams): TokenStatusFilter => {
  const value = params.get('status')
  return tokenStatusFilterValues.has(value ?? '') ? value as TokenStatusFilter : 'active'
}

const tokenStatus = (token: RelayProfileAccessToken) => token.revokedAt == null ? 'active' : 'revoked'

const accessTokenScopeLabel = (scope: RelayProfileAccessTokenScope) => {
  if (scope === 'team') return '团队级'
  if (scope === 'user') return '用户级'
  return '平台级'
}

const normalizeAccessTokenScope = (scope: RelayProfileAccessToken['scope'] | undefined): RelayProfileAccessTokenScope =>
  scope === 'team' || scope === 'user' ? scope : 'platform'

const timestampValue = (value: string | null | undefined) => {
  if (value == null || value === '') return 0
  const time = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(time) ? time : 0
}

const compareTimestamp = (left: string | null | undefined, right: string | null | undefined) =>
  timestampValue(left) - timestampValue(right)

const isTimestampWithinRange = (value: string | null | undefined, from: string, to: string) => {
  if (from === '' && to === '') return true
  const time = timestampValue(value)
  if (time === 0) return false
  const fromTime = from === '' ? undefined : timestampValue(from)
  const toTime = to === '' ? undefined : timestampValue(to)
  if (fromTime != null && time < fromTime) return false
  if (toTime != null && time > toTime) return false
  return true
}

interface ProfileTimeRangeColumnFilterProps {
  ariaLabel: string
  from: string
  label: string
  to: string
  onChange: (from: string, to: string) => void
}

const ProfileTimeRangeColumnFilter = ({
  ariaLabel,
  from,
  label,
  to,
  onChange
}: ProfileTimeRangeColumnFilterProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const isFiltered = from !== '' || to !== ''
  const stopHeaderSort = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
  }

  return (
    <span className='relay-admin-column-filter relay-profile-time-column-filter'>
      <span className='relay-admin-column-filter__label'>{label}</span>
      <span onClick={stopHeaderSort} onMouseDown={stopHeaderSort}>
        <Popover
          content={
            <div className='relay-profile-time-filter-menu'>
              <Input
                aria-label={`${ariaLabel}开始时间`}
                className='relay-profile-time-filter-input'
                placeholder='开始时间'
                size='small'
                type='datetime-local'
                value={from}
                onChange={event => onChange(event.target.value, to)}
              />
              <Input
                aria-label={`${ariaLabel}结束时间`}
                className='relay-profile-time-filter-input'
                placeholder='结束时间'
                size='small'
                type='datetime-local'
                value={to}
                onChange={event => onChange(from, event.target.value)}
              />
            </div>
          }
          open={isOpen}
          overlayClassName='relay-admin-column-filter__popover relay-profile-time-filter-popover'
          placement='bottomLeft'
          trigger='click'
          onOpenChange={setIsOpen}
        >
          <AdminActionButton
            aria-label={ariaLabel}
            className={[
              'relay-admin-column-filter__trigger',
              isFiltered || isOpen ? 'is-active' : ''
            ].filter(Boolean).join(' ')}
            iconName='filter_list'
            title={ariaLabel}
            type='text'
          />
        </Popover>
      </span>
    </span>
  )
}

const profileTabLabel = (iconName: AdminIconName, label: string) => (
  <span className='relay-profile-tab-label'>
    <AdminIcon name={iconName} />
    <span>{label}</span>
  </span>
)

const auditColumnOptions: AdminListColumnOption[] = [
  { key: 'createdAt', label: '时间', required: true },
  { key: 'tokenPreview', label: 'Key Preview', required: true },
  { key: 'tokenId', label: 'Token ID' },
  { key: 'userId', label: 'User ID' },
  { key: 'method', label: '方法' },
  { key: 'path', label: '接口' },
  { key: 'status', label: '状态' },
  { key: 'permission', label: 'Permission' },
  { key: 'ip', label: 'IP' },
  { key: 'userAgent', label: 'User Agent' },
  { key: 'error', label: '失败原因' }
]

const auditStatusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failure' },
  { label: '200', value: '200' },
  { label: '400', value: '400' },
  { label: '401', value: '401' },
  { label: '403', value: '403' },
  { label: '404', value: '404' },
  { label: '500', value: '500' }
]

const deviceStatusFilterValues = new Set<string>(['all', 'online', 'stale', 'offline'])
const readDeviceStatusFilter = (params: URLSearchParams): DeviceStatusFilter => {
  const value = params.get('status')
  return deviceStatusFilterValues.has(value ?? '') ? value as DeviceStatusFilter : 'all'
}

const auditStatusFilterValues = new Set<string>(auditStatusOptions.map(option => option.value))
const readAuditStatusFilter = (params: URLSearchParams) => {
  const value = params.get('status')
  return auditStatusFilterValues.has(value ?? '') ? value ?? 'all' : 'all'
}

interface AccessTokenFormValues {
  name?: string
  permissionGroupIds?: string[]
  permissionGroupMode: 'all' | 'custom'
  scope: RelayProfileAccessTokenScope
  teamId?: string
}

interface PasswordFormValues {
  currentPassword?: string
  password: string
}

const defaultSecuritySummary = (currentUser: RelayAdminCurrentUser): RelayProfileSecuritySummary => ({
  accessTokens: [],
  accountDeletion: {
    available: false
  },
  password: {
    enabled: false
  },
  passkeys: {
    count: currentUser.provider === 'passkey' ? 1 : 0,
    enabled: true,
    lastUsedAt: null
  },
  twoFactor: {
    available: false,
    enabled: false
  }
})

export const ProfilePage = ({
  accounts,
  activeToken,
  accessGroups,
  currentUser,
  devices,
  teams,
  onAccountDeleted
}: ProfilePageProps) => {
  const location = useLocation()
  const navigate = useNavigate()
  const { profileItemId, profileTab } = useParams()
  const activeProfileTab = isProfileTabKey(profileTab) ? profileTab : defaultProfileTabKey
  const initialProfileQuery = new URLSearchParams(location.search)
  const [accessTokenForm] = Form.useForm<AccessTokenFormValues>()
  const [passwordForm] = Form.useForm<PasswordFormValues>()
  const [security, setSecurity] = useState<RelayProfileSecuritySummary | undefined>()
  const [isLoadingSecurity, setIsLoadingSecurity] = useState(false)
  const [securityError, setSecurityError] = useState<string | undefined>()
  const [createdAccessToken, setCreatedAccessToken] = useState<string | undefined>()
  const [isSavingAccessToken, setIsSavingAccessToken] = useState(false)
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [deleteAccountConfirmValue, setDeleteAccountConfirmValue] = useState('')
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [deviceSearchValue, setDeviceSearchValue] = useState(() =>
    activeProfileTab === 'devices' ? queryValue(initialProfileQuery, 'q') : ''
  )
  const [deviceStatusFilter, setDeviceStatusFilter] = useState<DeviceStatusFilter>(() =>
    activeProfileTab === 'devices' ? readDeviceStatusFilter(initialProfileQuery) : 'all'
  )
  const [tokenSearchValue, setTokenSearchValue] = useState(() =>
    activeProfileTab === 'tokens' ? queryValue(initialProfileQuery, 'q') : ''
  )
  const [tokenStatusFilter, setTokenStatusFilter] = useState<TokenStatusFilter>(() =>
    activeProfileTab === 'tokens' ? readTokenStatusFilter(initialProfileQuery) : 'active'
  )
  const [tokenCreatedFrom, setTokenCreatedFrom] = useState(() =>
    activeProfileTab === 'tokens' ? queryValue(initialProfileQuery, 'createdFrom') : ''
  )
  const [tokenCreatedTo, setTokenCreatedTo] = useState(() =>
    activeProfileTab === 'tokens' ? queryValue(initialProfileQuery, 'createdTo') : ''
  )
  const [tokenLastUsedFrom, setTokenLastUsedFrom] = useState(() =>
    activeProfileTab === 'tokens' ? queryValue(initialProfileQuery, 'lastUsedFrom') : ''
  )
  const [tokenLastUsedTo, setTokenLastUsedTo] = useState(() =>
    activeProfileTab === 'tokens' ? queryValue(initialProfileQuery, 'lastUsedTo') : ''
  )
  const [tokenVisibleColumnKeys, setTokenVisibleColumnKeys] = useState(defaultTokenVisibleColumnKeys)
  const [auditEvents, setAuditEvents] = useState<RelayProfileOpenApiAuditEvent[]>([])
  const [auditSearchValue, setAuditSearchValue] = useState(() =>
    activeProfileTab === 'audit' ? queryValue(initialProfileQuery, 'q') : ''
  )
  const [auditStatusFilter, setAuditStatusFilter] = useState(() =>
    activeProfileTab === 'audit' ? readAuditStatusFilter(initialProfileQuery) : 'all'
  )
  const [auditFrom, setAuditFrom] = useState(() =>
    activeProfileTab === 'audit' ? queryValue(initialProfileQuery, 'from') : ''
  )
  const [auditTo, setAuditTo] = useState(() =>
    activeProfileTab === 'audit' ? queryValue(initialProfileQuery, 'to') : ''
  )
  const [auditVisibleColumnKeys, setAuditVisibleColumnKeys] = useState(defaultAuditVisibleColumnKeys)
  const [isLoadingAudit, setIsLoadingAudit] = useState(false)
  const [auditError, setAuditError] = useState<string | undefined>()
  const [auditRevision, setAuditRevision] = useState(0)
  const [actionError, setActionError] = useState<string | undefined>()
  const [notificationApi, notificationContextHolder] = notification.useNotification()
  const accessTokenPermissionMode = Form.useWatch('permissionGroupMode', accessTokenForm)
  const accessTokenScope = Form.useWatch('scope', accessTokenForm)
  const accessTokenTeamId = Form.useWatch('teamId', accessTokenForm)
  const showActionMessage = useCallback((message: string) => {
    notificationApi.success({
      duration: 3,
      message,
      placement: 'bottomRight'
    })
  }, [notificationApi])

  const buildProfileTabSearch = useCallback((tabKey: ProfileTabKey) => {
    const params = new URLSearchParams()

    if (tabKey === 'devices') {
      if (deviceSearchValue.trim() !== '') params.set('q', deviceSearchValue.trim())
      if (deviceStatusFilter !== 'all') params.set('status', deviceStatusFilter)
    }

    if (tabKey === 'tokens') {
      if (tokenSearchValue.trim() !== '') params.set('q', tokenSearchValue.trim())
      params.set('status', tokenStatusFilter)
      if (tokenCreatedFrom !== '') params.set('createdFrom', tokenCreatedFrom)
      if (tokenCreatedTo !== '') params.set('createdTo', tokenCreatedTo)
      if (tokenLastUsedFrom !== '') params.set('lastUsedFrom', tokenLastUsedFrom)
      if (tokenLastUsedTo !== '') params.set('lastUsedTo', tokenLastUsedTo)
    }

    if (tabKey === 'audit') {
      if (auditSearchValue.trim() !== '') params.set('q', auditSearchValue.trim())
      if (auditStatusFilter !== 'all') params.set('status', auditStatusFilter)
      if (auditFrom !== '') params.set('from', auditFrom)
      if (auditTo !== '') params.set('to', auditTo)
    }

    const query = params.toString()
    return query === '' ? '' : `?${query}`
  }, [
    auditFrom,
    auditSearchValue,
    auditStatusFilter,
    auditTo,
    deviceSearchValue,
    deviceStatusFilter,
    tokenCreatedFrom,
    tokenCreatedTo,
    tokenLastUsedFrom,
    tokenLastUsedTo,
    tokenSearchValue,
    tokenStatusFilter
  ])

  useEffect(() => {
    if (profileTab === activeProfileTab) return
    void navigate({
      pathname: profileTabPath(activeProfileTab),
      search: buildProfileTabSearch(activeProfileTab)
    }, { replace: true })
  }, [activeProfileTab, buildProfileTabSearch, navigate, profileTab])

  useEffect(() => {
    const params = new URLSearchParams(location.search)

    if (activeProfileTab === 'devices') {
      setDeviceSearchValue(queryValue(params, 'q'))
      setDeviceStatusFilter(readDeviceStatusFilter(params))
    }

    if (activeProfileTab === 'tokens') {
      setTokenSearchValue(queryValue(params, 'q'))
      setTokenStatusFilter(readTokenStatusFilter(params))
      setTokenCreatedFrom(queryValue(params, 'createdFrom'))
      setTokenCreatedTo(queryValue(params, 'createdTo'))
      setTokenLastUsedFrom(queryValue(params, 'lastUsedFrom'))
      setTokenLastUsedTo(queryValue(params, 'lastUsedTo'))
    }

    if (activeProfileTab === 'audit') {
      setAuditSearchValue(queryValue(params, 'q'))
      setAuditStatusFilter(readAuditStatusFilter(params))
      setAuditFrom(queryValue(params, 'from'))
      setAuditTo(queryValue(params, 'to'))
    }
  }, [activeProfileTab, location.search])

  useEffect(() => {
    if (profileTab !== activeProfileTab) return
    if (profileItemId != null) return

    const nextPathname = profileTabPath(activeProfileTab)
    const nextSearch = buildProfileTabSearch(activeProfileTab)
    if (location.pathname === nextPathname && location.search === nextSearch) return

    void navigate({
      pathname: nextPathname,
      search: nextSearch
    }, { replace: true })
  }, [activeProfileTab, buildProfileTabSearch, location.pathname, navigate, profileItemId, profileTab])

  const handleProfileTabChange = (key: string) => {
    if (!isProfileTabKey(key)) return
    void navigate({
      pathname: profileTabPath(key),
      search: buildProfileTabSearch(key)
    })
  }

  const loadSecurity = useCallback(async () => {
    if (activeToken === '' || currentUser == null) {
      setSecurity(undefined)
      return
    }
    setIsLoadingSecurity(true)
    setSecurityError(undefined)
    try {
      setSecurity(await fetchRelayProfileSecurity(activeToken))
    } catch (error) {
      setSecurity(defaultSecuritySummary(currentUser))
      setSecurityError(
        isMissingProfileSecurityEndpoint(error)
          ? undefined
          : error instanceof Error
          ? error.message
          : String(error)
      )
    } finally {
      setIsLoadingSecurity(false)
    }
  }, [activeToken, currentUser])

  useEffect(() => {
    void loadSecurity()
  }, [loadSecurity])

  useEffect(() => {
    if (activeProfileTab !== 'tokens' || profileItemId !== 'new') return
    setActionError(undefined)
    setCreatedAccessToken(undefined)
    accessTokenForm.setFieldsValue({
      name: '',
      permissionGroupIds: [],
      permissionGroupMode: 'all',
      scope: 'user',
      teamId: undefined
    })
  }, [accessTokenForm, activeProfileTab, profileItemId])

  useEffect(() => {
    if (activeProfileTab !== 'tokens' || profileItemId == null || profileItemId === 'new') return
    const token = security?.accessTokens.find(item => item.id === profileItemId)
    if (token == null) return
    setCreatedAccessToken(undefined)
    accessTokenForm.setFieldsValue({
      name: token.name,
      permissionGroupIds: token.permissionGroupIds,
      permissionGroupMode: token.permissionGroupMode,
      scope: normalizeAccessTokenScope(token.scope),
      teamId: token.teamId ?? undefined
    })
  }, [accessTokenForm, activeProfileTab, profileItemId, security?.accessTokens])

  const loadOpenApiAudit = useCallback(async () => {
    if (activeToken === '' || currentUser == null) {
      setAuditEvents([])
      return
    }
    setIsLoadingAudit(true)
    setAuditError(undefined)
    try {
      const result = await fetchRelayProfileOpenApiAuditEvents(activeToken, {
        from: auditFrom,
        status: auditStatusFilter === 'all' ? undefined : auditStatusFilter,
        to: auditTo
      })
      setAuditEvents(result.events)
    } catch (error) {
      setAuditEvents([])
      setAuditError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoadingAudit(false)
    }
  }, [activeToken, auditFrom, auditStatusFilter, auditTo, currentUser])

  useEffect(() => {
    void loadOpenApiAudit()
  }, [auditRevision, loadOpenApiAudit])

  if (currentUser == null) {
    return (
      <>
        {notificationContextHolder}
        <section className='relay-profile-panel'>
          <Empty className='relay-profile__empty' description='未登录账号' />
        </section>
      </>
    )
  }

  const rememberedAccount = accounts.find(account => account.token === activeToken)
  const securitySummary = security ?? defaultSecuritySummary(currentUser)
  const avatarUrl = currentUser.avatarUrl == null || currentUser.avatarUrl === ''
    ? rememberedAccount?.user.avatarUrl ?? undefined
    : currentUser.avatarUrl
  const provider = currentUser.provider == null || currentUser.provider === '' ? 'local' : currentUser.provider
  const descriptionItems: DescriptionsProps['items'] = [
    {
      children: currentUser.email,
      key: 'email',
      label: '邮箱'
    },
    {
      children: currentUser.name === '' ? '-' : currentUser.name,
      key: 'name',
      label: '名称'
    },
    {
      children: currentUser.loginId == null || currentUser.loginId === '' ? currentUser.email : currentUser.loginId,
      key: 'loginId',
      label: '登录 ID'
    },
    {
      children: currentUser.disabledAt == null ? 'active' : 'disabled',
      key: 'status',
      label: '状态'
    },
    {
      children: currentUser.role,
      key: 'role',
      label: '权限'
    },
    {
      children: provider,
      key: 'provider',
      label: '登录方式'
    },
    {
      children: currentUser.id,
      key: 'id',
      label: '账号 ID'
    },
    {
      children: formatTimestamp(rememberedAccount?.savedAt),
      key: 'savedAt',
      label: '本机记住时间'
    }
  ]
  const passkeyStatus = securitySummary.passkeys.count > 0
    ? `已注册 ${securitySummary.passkeys.count} 个`
    : '尚未注册'
  const passkeyLastUsed = formatTimestamp(securitySummary.passkeys.lastUsedAt)
  const isDeleteAccountConfirmValid = deleteAccountConfirmValue.trim() === currentUser.id
  const isAccessTokenEditorRoute = activeProfileTab === 'tokens' && profileItemId != null
  const isAccessTokenCreateRoute = isAccessTokenEditorRoute && profileItemId === 'new'
  const editingAccessToken = !isAccessTokenCreateRoute && profileItemId != null
    ? securitySummary.accessTokens.find(token => token.id === profileItemId)
    : undefined
  const currentUserGroupIds = currentUser.groupIds ?? []
  const currentUserAccessSources = currentUser.effectiveAccess?.sources ?? []
  const userPlatformGroupIdsFromSources = currentUserAccessSources
    .filter(source => source.scope === 'platform')
    .map(source => source.groupId)
  const userPlatformGroupIds = currentUserGroupIds.length > 0
    ? currentUserGroupIds
    : userPlatformGroupIdsFromSources.length > 0
    ? userPlatformGroupIdsFromSources
    : [`platform:${currentUser.role}`]
  const userPlatformGroupIdSet = new Set(userPlatformGroupIds)
  const platformAccessGroups = accessGroups.filter(group =>
    group.scope === 'platform' && !group.disabled && userPlatformGroupIdSet.has(group.id)
  )
  const userTeams = teams.filter(team => team.archivedAt == null && team.membership != null)
  const teamById = new Map(teams.map(team => [team.id, team]))
  const tokenEditorScope = accessTokenScope ??
    (isAccessTokenCreateRoute ? 'user' : normalizeAccessTokenScope(editingAccessToken?.scope))
  const tokenEditorTeamId = accessTokenTeamId ?? editingAccessToken?.teamId ?? userTeams[0]?.id
  const selectedAccessTokenTeam = userTeams.find(team => team.id === tokenEditorTeamId)
  const selectedAccessTokenTeamGroupIds = selectedAccessTokenTeam?.membership?.groupIds ?? []
  const selectedAccessTokenTeamGroupIdSet = new Set(selectedAccessTokenTeamGroupIds)
  const platformAccessTokenGroupOptions = platformAccessGroups.map(group => ({
    label: group.name,
    value: group.id
  }))
  const teamAccessTokenGroupOptions = (selectedAccessTokenTeam?.accessGroups ?? [])
    .filter(group => group.scope === 'team' && !group.disabled && selectedAccessTokenTeamGroupIdSet.has(group.id))
    .map(group => ({
      label: group.name,
      value: group.id
    }))
  const accessTokenGroupOptions = tokenEditorScope === 'team'
    ? teamAccessTokenGroupOptions
    : tokenEditorScope === 'platform'
    ? platformAccessTokenGroupOptions
    : []
  const accessTokenTeamOptions = userTeams.map(team => ({
    label: team.name,
    value: team.id
  }))
  const accessTokenPermissionGroupLabel = (token: RelayProfileAccessToken) => {
    const scope = normalizeAccessTokenScope(token.scope)
    if (scope === 'user') return '个人 API'
    const team = token.teamId == null ? undefined : teamById.get(token.teamId)
    if ((token.permissionGroupMode ?? 'all') === 'all') {
      return scope === 'team'
        ? `${team?.name ?? '团队'} · 全部成员组`
        : '全部当前用户组'
    }
    const groupSource = scope === 'team' ? team?.accessGroups ?? [] : accessGroups
    const groupById = new Map(groupSource.map(group => [group.id, group]))
    const groupNames = (token.permissionGroupIds ?? [])
      .map(groupId => groupById.get(groupId)?.name ?? groupId)
      .filter(name => name !== '')
    return groupNames.length === 0 ? '未授权' : groupNames.join('、')
  }
  const accessTokenModeDescription = tokenEditorScope === 'team'
    ? '全部表示跟随你在所选团队内拥有的全部成员组；指定表示只授予选中的团队成员组。'
    : '全部表示跟随当前账号拥有的所有平台用户组；指定表示只授予选中的平台用户组。'
  const accessTokenGroupFieldLabel = tokenEditorScope === 'team' ? '授权成员组' : '授权用户组'
  const accessTokenGroupDescription = tokenEditorScope === 'team'
    ? '只能选择你在该团队内已经拥有的成员组，token 不会获得额外权限。'
    : '只能选择当前账号已经拥有的平台用户组，token 不会获得额外权限。'
  const normalizedTokenSearch = tokenSearchValue.trim().toLowerCase()
  const filteredTokenRows = securitySummary.accessTokens.filter(token => {
    const status = tokenStatus(token)
    const scope = normalizeAccessTokenScope(token.scope)
    const teamName = token.teamId == null ? '' : teamById.get(token.teamId)?.name ?? ''
    if (tokenStatusFilter !== 'all' && status !== tokenStatusFilter) return false
    if (!isTimestampWithinRange(token.createdAt, tokenCreatedFrom, tokenCreatedTo)) return false
    if (!isTimestampWithinRange(token.lastUsedAt, tokenLastUsedFrom, tokenLastUsedTo)) return false
    if (normalizedTokenSearch === '') return true
    return [
      token.name,
      accessTokenScopeLabel(scope),
      teamName,
      accessTokenPermissionGroupLabel(token),
      token.tokenPreview,
      token.createdAt,
      token.lastUsedAt ?? '',
      token.revokedAt ?? '',
      status
    ].some(value => value.toLowerCase().includes(normalizedTokenSearch))
  })
  const normalizedAuditSearch = auditSearchValue.trim().toLowerCase()
  const filteredAuditRows = normalizedAuditSearch === ''
    ? auditEvents
    : auditEvents.filter(event =>
      [
        event.tokenId,
        event.tokenPreview,
        event.userId,
        event.method,
        event.path,
        String(event.status),
        event.ip ?? '',
        event.userAgent ?? '',
        event.permission ?? '',
        event.error ?? '',
        event.createdAt
      ].some(value => value.toLowerCase().includes(normalizedAuditSearch))
    )
  const navigateToAccessTokenList = () => {
    void navigate({
      pathname: profileTabPath('tokens'),
      search: buildProfileTabSearch('tokens')
    })
  }

  const navigateToAccessTokenCreate = () => {
    void navigate('/profile/tokens/new')
  }

  const accessTokenGrantInput = (values: AccessTokenFormValues) => {
    const scope = values.scope ?? 'platform'
    return {
      name: values.name?.trim() ?? '',
      permissionGroupIds: scope === 'user' || values.permissionGroupMode !== 'custom'
        ? []
        : values.permissionGroupIds ?? [],
      permissionGroupMode: scope === 'user' ? 'all' as const : values.permissionGroupMode ?? 'all',
      scope,
      teamId: scope === 'team' ? values.teamId : undefined
    }
  }

  const handleSaveAccessToken = async (values: AccessTokenFormValues) => {
    setIsSavingAccessToken(true)
    setActionError(undefined)
    try {
      if (profileItemId == null || profileItemId === 'new') {
        const result = await createRelayProfileAccessToken(activeToken, accessTokenGrantInput(values))
        setCreatedAccessToken(result.accessToken)
        showActionMessage('API 令牌已生成')
      } else {
        await updateRelayProfileAccessToken(activeToken, profileItemId, accessTokenGrantInput(values))
        showActionMessage('API 令牌权限已保存')
      }
      await loadSecurity()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSavingAccessToken(false)
    }
  }

  const handleRevokeAccessToken = async (token: RelayProfileAccessToken) => {
    setActionError(undefined)
    try {
      await revokeRelayProfileAccessToken(activeToken, token.id)
      showActionMessage('API 令牌已撤销')
      await loadSecurity()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleCopyCreatedToken = async () => {
    if (createdAccessToken == null) return
    await navigator.clipboard?.writeText(createdAccessToken)
    showActionMessage('API 令牌已复制')
  }

  const handleCopyTokenPreview = async (token: RelayProfileAccessToken) => {
    setActionError(undefined)
    try {
      await navigator.clipboard.writeText(token.tokenPreview)
      showActionMessage('令牌 Preview 已复制')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const openPasswordModal = () => {
    setActionError(undefined)
    passwordForm.resetFields()
    setIsPasswordModalOpen(true)
  }

  const closePasswordModal = () => {
    if (isChangingPassword) return
    setIsPasswordModalOpen(false)
  }

  const handleChangePassword = async (values: PasswordFormValues) => {
    setIsChangingPassword(true)
    setActionError(undefined)
    try {
      await changeRelayProfilePassword(activeToken, {
        currentPassword: values.currentPassword,
        password: values.password
      })
      showActionMessage(securitySummary.password.enabled ? '密码已修改' : '密码已设置')
      setIsPasswordModalOpen(false)
      await loadSecurity()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleRegisterPasskey = async () => {
    setPasskeyLoading(true)
    setActionError(undefined)
    try {
      const optionsPayload = await createRelayProfilePasskeyOptions(activeToken)
      const response = await startRegistration({ optionsJSON: optionsPayload.options })
      await verifyRelayProfilePasskey(activeToken, {
        credentialName: `${userDisplayName(currentUser)} Passkey`,
        response
      })
      showActionMessage('Passkey 已注册')
      await loadSecurity()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setPasskeyLoading(false)
    }
  }

  const openDeleteAccountModal = () => {
    setActionError(undefined)
    setDeleteAccountConfirmValue('')
    setIsDeleteAccountModalOpen(true)
  }

  const closeDeleteAccountModal = () => {
    if (isDeletingAccount) return
    setIsDeleteAccountModalOpen(false)
  }

  const handleDeleteAccount = async () => {
    if (!isDeleteAccountConfirmValid) return
    setIsDeletingAccount(true)
    setActionError(undefined)
    try {
      await deleteRelayProfileAccount(activeToken)
      showActionMessage('账号已删除')
      setIsDeleteAccountModalOpen(false)
      window.setTimeout(() => onAccountDeleted?.(), 300)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsDeletingAccount(false)
    }
  }

  const tokenColumns: TableColumnsType<RelayProfileAccessToken> = [
    {
      dataIndex: 'name',
      ellipsis: true,
      key: 'name',
      render: (_, token) => (
        <button
          className='relay-profile-token-name-button'
          type='button'
          onClick={() => void navigate(`/profile/tokens/${encodeURIComponent(token.id)}`)}
        >
          {token.name}
        </button>
      ),
      title: '名称',
      width: 180
    },
    {
      dataIndex: 'scope',
      key: 'scope',
      render: (_, token) => {
        const scope = normalizeAccessTokenScope(token.scope)
        return (
          <StatusBadge tone={scope === 'user' ? 'success' : scope === 'team' ? 'warning' : 'muted'}>
            {accessTokenScopeLabel(scope)}
          </StatusBadge>
        )
      },
      title: '类型',
      width: 110
    },
    {
      dataIndex: 'tokenPreview',
      ellipsis: true,
      key: 'tokenPreview',
      render: (_, token) => (
        <span className='relay-profile-token-preview-cell'>
          <code className='relay-profile-token-preview'>{token.tokenPreview}</code>
          <AdminActionButton
            aria-label={`复制令牌 Preview ${token.name}`}
            iconName='content_copy'
            size='small'
            title='复制 Preview'
            tooltip='复制 Preview'
            type='text'
            onClick={() => void handleCopyTokenPreview(token)}
          />
        </span>
      ),
      title: 'Preview',
      width: 260
    },
    {
      key: 'permissionGroups',
      render: (_, token) => (
        <span className='relay-profile-token-permission'>
          {accessTokenPermissionGroupLabel(token)}
        </span>
      ),
      title: '权限范围',
      width: 220
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: value => formatTimestamp(value),
      sorter: (left, right) => compareTimestamp(left.createdAt, right.createdAt),
      title: (
        <ProfileTimeRangeColumnFilter
          ariaLabel='按创建时间筛选'
          from={tokenCreatedFrom}
          label='创建时间'
          to={tokenCreatedTo}
          onChange={(from, to) => {
            setTokenCreatedFrom(from)
            setTokenCreatedTo(to)
          }}
        />
      ),
      width: 160
    },
    {
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      render: value => formatTimestamp(value),
      sorter: (left, right) => compareTimestamp(left.lastUsedAt, right.lastUsedAt),
      title: (
        <ProfileTimeRangeColumnFilter
          ariaLabel='按最后使用时间筛选'
          from={tokenLastUsedFrom}
          label='最后使用'
          to={tokenLastUsedTo}
          onChange={(from, to) => {
            setTokenLastUsedFrom(from)
            setTokenLastUsedTo(to)
          }}
        />
      ),
      width: 160
    },
    {
      key: 'status',
      render: (_, token) =>
        tokenStatus(token) === 'active'
          ? <Tag color='green'>active</Tag>
          : <Tag>revoked</Tag>,
      title: (
        <AdminColumnFilter<TokenStatusFilter>
          allValue='all'
          ariaLabel='按令牌状态过滤'
          label='状态'
          options={tokenStatusOptions}
          value={tokenStatusFilter}
          onChange={setTokenStatusFilter}
        />
      ),
      width: 100
    },
    {
      key: 'actions',
      render: (_, token) => (
        <span className='relay-profile-token-actions'>
          <AdminActionButton
            aria-label={`配置令牌 ${token.name}`}
            disabled={token.revokedAt != null}
            iconName='edit'
            size='small'
            title='配置令牌'
            tooltip='配置令牌'
            type='text'
            onClick={() => void navigate(`/profile/tokens/${encodeURIComponent(token.id)}`)}
          />
          <AdminActionButton
            aria-label={`撤销令牌 ${token.name}`}
            danger
            disabled={token.revokedAt != null}
            iconName='disabled_by_default'
            size='small'
            title='撤销令牌'
            tooltip='撤销令牌'
            type='text'
            onClick={() => void handleRevokeAccessToken(token)}
          />
        </span>
      ),
      title: '操作',
      width: 90
    }
  ]

  const auditColumns: TableColumnsType<RelayProfileOpenApiAuditEvent> = [
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: value => formatTimestamp(value),
      title: (
        <ProfileTimeRangeColumnFilter
          ariaLabel='按调用时间筛选'
          from={auditFrom}
          label='时间'
          to={auditTo}
          onChange={(from, to) => {
            setAuditFrom(from)
            setAuditTo(to)
          }}
        />
      ),
      width: 170
    },
    {
      dataIndex: 'tokenPreview',
      ellipsis: true,
      key: 'tokenPreview',
      render: value => <code className='relay-profile-token-preview'>{String(value)}</code>,
      title: 'Key Preview',
      width: 210
    },
    {
      dataIndex: 'tokenId',
      ellipsis: true,
      key: 'tokenId',
      render: value => <span className='relay-profile-audit-secondary'>{String(value)}</span>,
      title: 'Token ID',
      width: 220
    },
    {
      dataIndex: 'userId',
      ellipsis: true,
      key: 'userId',
      render: value => <span className='relay-profile-audit-secondary'>{String(value)}</span>,
      title: 'User ID',
      width: 220
    },
    {
      dataIndex: 'method',
      key: 'method',
      render: value => <Tag color={methodTone(String(value).toUpperCase())}>{String(value).toUpperCase()}</Tag>,
      title: '方法',
      width: 94
    },
    {
      dataIndex: 'path',
      ellipsis: true,
      key: 'path',
      render: value => <code className='relay-profile-audit-path'>{String(value)}</code>,
      title: '接口',
      width: 300
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: value => (
        <StatusBadge tone={normalizeAuditStatus(Number(value))}>
          {String(value)}
        </StatusBadge>
      ),
      title: (
        <AdminColumnFilter<string>
          allValue='all'
          ariaLabel='按调用状态筛选'
          label='状态'
          options={auditStatusOptions}
          value={auditStatusFilter}
          onChange={setAuditStatusFilter}
        />
      ),
      width: 90
    },
    {
      dataIndex: 'permission',
      ellipsis: true,
      key: 'permission',
      render: value => value == null ? '-' : <code className='relay-profile-audit-secondary'>{String(value)}</code>,
      title: 'Permission',
      width: 220
    },
    {
      dataIndex: 'ip',
      key: 'ip',
      render: value => value ?? '-',
      title: 'IP',
      width: 140
    },
    {
      dataIndex: 'userAgent',
      ellipsis: true,
      key: 'userAgent',
      render: value => value ?? '-',
      title: 'User Agent',
      width: 260
    },
    {
      dataIndex: 'error',
      ellipsis: true,
      key: 'error',
      render: value => value == null ? '-' : <span className='relay-profile-audit-error'>{String(value)}</span>,
      title: '失败原因',
      width: 240
    }
  ]

  const securityRows = [
    {
      action: (
        <Button
          icon={<AdminIcon name='key' />}
          size='small'
          onClick={openPasswordModal}
        >
          {securitySummary.password.enabled ? '修改' : '设置密码'}
        </Button>
      ),
      description: securitySummary.password.enabled ? '密码登录已启用' : '当前账号尚未设置密码登录',
      icon: <AdminIcon name='key' />,
      key: 'password',
      title: '密码管理'
    },
    {
      action: (
        <Button
          disabled={!securitySummary.passkeys.enabled}
          icon={<AdminIcon name='key' />}
          loading={passkeyLoading}
          size='small'
          onClick={() => void handleRegisterPasskey()}
        >
          注册
        </Button>
      ),
      description: `${passkeyStatus} · 最后使用时间：${passkeyLastUsed}`,
      icon: <AdminIcon name='key' />,
      key: 'passkey',
      title: 'Passkey 登录'
    },
    {
      action: (
        <Button disabled icon={<AdminIcon name='admin_panel_settings' />} size='small'>
          启用
        </Button>
      ),
      description: 'TOTP 与恢复码后端尚未启用',
      extra: <Tag color='default'>未启用</Tag>,
      icon: <AdminIcon name='admin_panel_settings' />,
      key: 'two-factor',
      title: '两步验证设置'
    },
    {
      action: (
        <Button
          danger
          disabled={!securitySummary.accountDeletion.available}
          icon={<AdminIcon name='delete' />}
          loading={isDeletingAccount}
          size='small'
          onClick={openDeleteAccountModal}
        >
          删除
        </Button>
      ),
      description: securitySummary.accountDeletion.available
        ? '删除后会退出当前账号，并移除会话、设备和令牌。'
        : '当前账号暂不支持删除',
      icon: <AdminIcon name='delete' />,
      key: 'delete-account',
      title: '删除账号'
    }
  ]
  const tokenEditorPermissionMode = tokenEditorScope === 'user'
    ? 'all'
    : accessTokenPermissionMode ?? editingAccessToken?.permissionGroupMode ?? 'all'
  const isAccessTokenEditorDisabled = editingAccessToken?.revokedAt != null

  if (isAccessTokenEditorRoute) {
    const isMissingAccessToken = !isAccessTokenCreateRoute && editingAccessToken == null

    return (
      <section className='relay-profile-panel'>
        {notificationContextHolder}
        <div className='relay-profile-token-editor'>
          {securityError == null ? null : (
            <Alert
              showIcon
              message='令牌信息加载失败'
              description={securityError}
              type='warning'
            />
          )}
          {actionError == null ? null : <Alert showIcon message={actionError} type='error' />}

          {isMissingAccessToken && isLoadingSecurity ? <Spin size='small' /> : null}
          {isMissingAccessToken && !isLoadingSecurity
            ? <Empty className='relay-profile__empty' description='未找到 API 令牌' />
            : (
              <Form
                className='relay-profile-token-editor__form'
                form={accessTokenForm}
                initialValues={{
                  name: editingAccessToken?.name ?? '',
                  permissionGroupIds: editingAccessToken?.permissionGroupIds ?? [],
                  permissionGroupMode: editingAccessToken?.permissionGroupMode ?? 'all',
                  scope: isAccessTokenCreateRoute ? 'user' : normalizeAccessTokenScope(editingAccessToken?.scope),
                  teamId: editingAccessToken?.teamId ?? undefined
                }}
                onFinish={handleSaveAccessToken}
              >
                {isAccessTokenEditorDisabled
                  ? <Alert showIcon message='该令牌已撤销，不能继续修改权限范围。' type='warning' />
                  : null}

                <div className='relay-profile-token-editor__row'>
                  <div className='relay-profile-token-editor__label'>
                    <strong>令牌类型</strong>
                    <span>用户级操作当前账号数据，团队级绑定一个团队，平台级使用平台用户组授权。</span>
                  </div>
                  <Form.Item
                    className='relay-profile-token-editor__control'
                    name='scope'
                    rules={[{ required: true }]}
                  >
                    <Select
                      disabled={isSavingAccessToken || isAccessTokenEditorDisabled}
                      options={[
                        { label: '用户级', value: 'user' },
                        { label: '团队级', value: 'team' },
                        { label: '平台级', value: 'platform' }
                      ]}
                      onChange={(scope: RelayProfileAccessTokenScope) => {
                        accessTokenForm.setFieldsValue({
                          permissionGroupIds: [],
                          permissionGroupMode: 'all',
                          teamId: scope === 'team' ? tokenEditorTeamId : undefined
                        })
                      }}
                    />
                  </Form.Item>
                </div>

                <div className='relay-profile-token-editor__row'>
                  <div className='relay-profile-token-editor__label'>
                    <strong>令牌名称</strong>
                    <span>用于区分 OpenAPI 调用来源。</span>
                  </div>
                  <Form.Item
                    className='relay-profile-token-editor__control'
                    name='name'
                    rules={[{ max: 80, required: true }]}
                  >
                    <Input autoFocus disabled={isSavingAccessToken || isAccessTokenEditorDisabled} />
                  </Form.Item>
                </div>

                {tokenEditorScope === 'team'
                  ? (
                    <div className='relay-profile-token-editor__row'>
                      <div className='relay-profile-token-editor__label'>
                        <strong>所属团队</strong>
                        <span>团队级令牌只能访问绑定团队，不能跨团队读取或写入。</span>
                      </div>
                      <Form.Item
                        className='relay-profile-token-editor__control'
                        name='teamId'
                        rules={[{ message: '请选择团队', required: true }]}
                      >
                        <Select
                          disabled={isSavingAccessToken || isAccessTokenEditorDisabled}
                          options={accessTokenTeamOptions}
                          placeholder='选择团队'
                          onChange={() => accessTokenForm.setFieldsValue({ permissionGroupIds: [] })}
                        />
                      </Form.Item>
                    </div>
                  )
                  : null}

                {tokenEditorScope === 'user'
                  ? (
                    <div className='relay-profile-token-editor__row'>
                      <div className='relay-profile-token-editor__label'>
                        <strong>权限范围</strong>
                        <span>仅可调用当前账号的个人数据和自助 API，不使用平台或团队用户组。</span>
                      </div>
                      <div className='relay-profile-token-editor__control relay-profile-token-editor__scope-summary'>
                        <StatusBadge tone='success'>个人 API</StatusBadge>
                      </div>
                    </div>
                  )
                  : (
                    <div className='relay-profile-token-editor__row'>
                      <div className='relay-profile-token-editor__label'>
                        <strong>授权模式</strong>
                        <span>{accessTokenModeDescription}</span>
                      </div>
                      <Form.Item className='relay-profile-token-editor__control' name='permissionGroupMode'>
                        <Select
                          disabled={isSavingAccessToken || isAccessTokenEditorDisabled}
                          options={[
                            {
                              label: tokenEditorScope === 'team' ? '全部当前团队成员组' : '全部当前用户组',
                              value: 'all'
                            },
                            {
                              label: tokenEditorScope === 'team' ? '指定成员组' : '指定用户组',
                              value: 'custom'
                            }
                          ]}
                        />
                      </Form.Item>
                    </div>
                  )}

                {tokenEditorScope !== 'user' && tokenEditorPermissionMode === 'custom'
                  ? (
                    <div className='relay-profile-token-editor__row'>
                      <div className='relay-profile-token-editor__label'>
                        <strong>{accessTokenGroupFieldLabel}</strong>
                        <span>{accessTokenGroupDescription}</span>
                      </div>
                      <Form.Item
                        className='relay-profile-token-editor__control'
                        name='permissionGroupIds'
                        rules={[
                          {
                            validator: (_, value: unknown) => (
                              Array.isArray(value) && value.length > 0
                                ? Promise.resolve()
                                : Promise.reject(new Error('请选择授权范围'))
                            )
                          }
                        ]}
                      >
                        <Select
                          disabled={isSavingAccessToken || isAccessTokenEditorDisabled}
                          mode='multiple'
                          options={accessTokenGroupOptions}
                          placeholder={tokenEditorScope === 'team' ? '选择授权成员组' : '选择授权用户组'}
                        />
                      </Form.Item>
                    </div>
                  )
                  : null}

                {createdAccessToken == null
                  ? null
                  : (
                    <div className='relay-profile-token-editor__row relay-profile-token-editor__row--token'>
                      <div className='relay-profile-token-editor__label'>
                        <strong>完整令牌</strong>
                        <span>只展示一次，离开页面后无法再次查看。</span>
                      </div>
                      <div className='relay-profile-token-editor__control'>
                        <Input.TextArea autoSize readOnly value={createdAccessToken} />
                      </div>
                    </div>
                  )}

                <div className='relay-profile-token-editor__actions'>
                  <Button disabled={isSavingAccessToken} onClick={navigateToAccessTokenList}>
                    {createdAccessToken == null ? '取消' : '返回列表'}
                  </Button>
                  {createdAccessToken == null
                    ? (
                      <Button
                        htmlType='submit'
                        loading={isSavingAccessToken}
                        type='primary'
                        disabled={isAccessTokenEditorDisabled}
                      >
                        {isAccessTokenCreateRoute ? '生成令牌' : '保存令牌配置'}
                      </Button>
                    )
                    : (
                      <Button type='primary' onClick={() => void handleCopyCreatedToken()}>
                        复制令牌
                      </Button>
                    )}
                </div>
              </Form>
            )}
        </div>
      </section>
    )
  }

  return (
    <section className='relay-profile-panel'>
      {notificationContextHolder}
      <div className='relay-profile'>
        <div className='relay-profile__hero'>
          <Avatar
            className='relay-profile__avatar'
            icon={<AdminIcon name='person' />}
            size={60}
            src={avatarUrl}
          />
          <div className='relay-profile__identity'>
            <span className='relay-profile__eyebrow'>当前账号</span>
            <h2>{userDisplayName(currentUser)}</h2>
            <p>{currentUser.email}</p>
          </div>
        </div>

        <Tabs
          activeKey={activeProfileTab}
          className='relay-profile-tabs'
          items={[
            {
              key: 'account',
              label: profileTabLabel('account_circle', '账号信息'),
              children: (
                <section className='relay-profile-tab-panel'>
                  <Descriptions
                    bordered
                    className='relay-profile__descriptions'
                    column={{ lg: 2, md: 1, sm: 1, xl: 2, xs: 1, xxl: 2 }}
                    items={descriptionItems}
                    size='small'
                  />
                </section>
              )
            },
            {
              key: 'devices',
              label: profileTabLabel('desktop_windows', '设备管理'),
              children: (
                <section className='relay-profile-tab-panel'>
                  <DeviceTable
                    devices={devices}
                    initialVisibleColumnKeys={['name', 'status', 'lastSeenAt', 'capabilities', 'workspaceFolder']}
                    searchPlaceholder='搜索我的设备、工作区、支持功能'
                    searchValue={deviceSearchValue}
                    statusFilter={deviceStatusFilter}
                    onSearchChange={setDeviceSearchValue}
                    onStatusFilterChange={setDeviceStatusFilter}
                  />
                </section>
              )
            },
            {
              key: 'security',
              label: profileTabLabel('admin_panel_settings', '账号安全'),
              children: (
                <section className='relay-profile-tab-panel'>
                  {isLoadingSecurity ? <Spin size='small' /> : null}

                  {securityError == null ? null : (
                    <Alert
                      showIcon
                      message='安全设置加载失败'
                      description={securityError}
                      type='warning'
                    />
                  )}
                  {actionError == null ? null : <Alert showIcon message={actionError} type='error' />}

                  <div className='relay-profile-security__rows'>
                    {securityRows.map(row => (
                      <div className='relay-profile-security-row' key={row.key}>
                        <span className='relay-profile-security-row__icon'>{row.icon}</span>
                        <div className='relay-profile-security-row__body'>
                          <div className='relay-profile-security-row__title'>
                            <strong>{row.title}</strong>
                            {'extra' in row ? row.extra : null}
                          </div>
                          <p>{row.description}</p>
                        </div>
                        <div className='relay-profile-security-row__action'>{row.action}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )
            },
            {
              key: 'tokens',
              label: profileTabLabel('key', '令牌管理'),
              children: (
                <section className='relay-profile-tab-panel'>
                  {securityError == null ? null : (
                    <Alert
                      showIcon
                      message='令牌列表加载失败'
                      description={securityError}
                      type='warning'
                    />
                  )}
                  {actionError == null ? null : <Alert showIcon message={actionError} type='error' />}

                  <AdminListTable<RelayProfileAccessToken>
                    ariaLabel='API 令牌列表'
                    className='relay-profile-token-table'
                    columnOptions={tokenColumnOptions}
                    columns={tokenColumns}
                    dataSource={filteredTokenRows}
                    emptyText='暂无 API 令牌'
                    rowKey='id'
                    searchPlaceholder='搜索令牌名称、类型、团队、Preview、状态'
                    searchValue={tokenSearchValue}
                    toolbarActions={
                      <AdminActionButton
                        aria-label='生成令牌'
                        className={[
                          'route-container-header__action-button',
                          'relay-admin-list-table__toolbar-action-button'
                        ].join(' ')}
                        iconName='key'
                        size='small'
                        title='生成令牌'
                        type='text'
                        onClick={navigateToAccessTokenCreate}
                      />
                    }
                    visibleColumnKeys={tokenVisibleColumnKeys}
                    onSearchChange={setTokenSearchValue}
                    onVisibleColumnKeysChange={setTokenVisibleColumnKeys}
                  />
                </section>
              )
            },
            {
              key: 'audit',
              label: profileTabLabel('fact_check', '调用审计'),
              children: (
                <section className='relay-profile-tab-panel'>
                  {auditError == null ? null : <Alert showIcon message={auditError} type='error' />}

                  <AdminListTable<RelayProfileOpenApiAuditEvent>
                    ariaLabel='OpenAPI 调用审计'
                    className='relay-profile-audit-table'
                    columnOptions={auditColumnOptions}
                    columns={auditColumns}
                    dataSource={filteredAuditRows}
                    emptyText={isLoadingAudit ? '正在加载调用审计' : '暂无调用审计'}
                    rowKey='id'
                    searchPlaceholder='搜索 key、接口、状态、权限、失败原因'
                    searchValue={auditSearchValue}
                    toolbarActions={
                      <AdminActionButton
                        aria-label='刷新调用审计'
                        className={[
                          'route-container-header__action-button',
                          'relay-admin-list-table__toolbar-action-button'
                        ].join(' ')}
                        disabled={isLoadingAudit}
                        iconName='refresh'
                        size='small'
                        title='刷新调用审计'
                        tooltip='刷新调用审计'
                        type='text'
                        onClick={() => setAuditRevision(value => value + 1)}
                      />
                    }
                    visibleColumnKeys={auditVisibleColumnKeys}
                    onSearchChange={setAuditSearchValue}
                    onVisibleColumnKeysChange={setAuditVisibleColumnKeys}
                  />
                </section>
              )
            }
          ]}
          onChange={handleProfileTabChange}
        />
      </div>

      <Modal
        destroyOnHidden
        confirmLoading={isChangingPassword}
        okText={securitySummary.password.enabled ? '修改' : '设置密码'}
        open={isPasswordModalOpen}
        title='密码管理'
        onCancel={closePasswordModal}
        onOk={() => passwordForm.submit()}
      >
        <Form form={passwordForm} layout='vertical' onFinish={handleChangePassword}>
          {securitySummary.password.enabled
            ? (
              <Form.Item label='当前密码' name='currentPassword' rules={[{ required: true }]}>
                <Input.Password autoComplete='current-password' disabled={isChangingPassword} />
              </Form.Item>
            )
            : null}
          <Form.Item label='新密码' name='password' rules={[{ min: 8, required: true }]}>
            <Input.Password autoComplete='new-password' disabled={isChangingPassword} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        cancelText='取消'
        destroyOnHidden
        confirmLoading={isDeletingAccount}
        okButtonProps={{ danger: true, disabled: !isDeleteAccountConfirmValid }}
        okText='删除账号'
        open={isDeleteAccountModalOpen}
        title='删除账号'
        onCancel={closeDeleteAccountModal}
        onOk={() => void handleDeleteAccount()}
      >
        <div className='relay-profile-security__delete-confirm'>
          <p>删除后会移除当前账号、登录会话、API 令牌、Passkey、设备和团队成员关系。</p>
          <p>
            请输入账号 ID <Tag>{currentUser.id}</Tag> 确认删除。
          </p>
          {actionError == null ? null : <Alert showIcon message={actionError} type='error' />}
          <Input
            autoComplete='off'
            disabled={isDeletingAccount}
            placeholder='输入账号 ID'
            value={deleteAccountConfirmValue}
            onChange={event => setDeleteAccountConfirmValue(event.target.value)}
          />
        </div>
      </Modal>
    </section>
  )
}
