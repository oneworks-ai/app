/* eslint-disable max-lines -- profile page keeps current-account security modals and one-time token reveal together. */
import './ProfilePage.css'

import { startRegistration } from '@simplewebauthn/browser'
import { Alert, Avatar, Button, Descriptions, Empty, Form, Input, Modal, Popover, Spin, Tabs, Tag } from 'antd'
import type { DescriptionsProps, TableColumnsType } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import type { RelayAdminCurrentUser, RelayAdminDevice, RelayAdminDeviceStatus } from '../../shared/model/adminTypes'
import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import type { AdminIconName } from '../../shared/ui/AdminIcon'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { AdminSessionAccount } from '../auth/adminSessionStorage'
import { DeviceTable } from '../devices/DeviceTable'
import {
  changeRelayProfilePassword,
  createRelayProfileAccessToken,
  createRelayProfilePasskeyOptions,
  fetchRelayProfileOpenApiAuditEvents,
  fetchRelayProfileSecurity,
  revokeRelayProfileAccessToken,
  verifyRelayProfilePasskey
} from './profileApi'
import type { RelayProfileAccessToken, RelayProfileOpenApiAuditEvent, RelayProfileSecuritySummary } from './profileApi'

export interface ProfilePageProps {
  accounts: AdminSessionAccount[]
  activeToken: string
  currentUser?: RelayAdminCurrentUser
  devices: RelayAdminDevice[]
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
const queryValue = (params: URLSearchParams, key: string) => params.get(key)?.trim() ?? ''

const defaultTokenVisibleColumnKeys = ['name', 'tokenPreview', 'createdAt', 'lastUsedAt', 'status']
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
  { key: 'tokenPreview', label: 'Preview' },
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
  currentUser,
  devices
}: ProfilePageProps) => {
  const location = useLocation()
  const navigate = useNavigate()
  const { profileTab } = useParams()
  const activeProfileTab = isProfileTabKey(profileTab) ? profileTab : defaultProfileTabKey
  const initialProfileQuery = new URLSearchParams(location.search)
  const [accessTokenForm] = Form.useForm<AccessTokenFormValues>()
  const [passwordForm] = Form.useForm<PasswordFormValues>()
  const [security, setSecurity] = useState<RelayProfileSecuritySummary | undefined>()
  const [isLoadingSecurity, setIsLoadingSecurity] = useState(false)
  const [securityError, setSecurityError] = useState<string | undefined>()
  const [isAccessTokenModalOpen, setIsAccessTokenModalOpen] = useState(false)
  const [createdAccessToken, setCreatedAccessToken] = useState<string | undefined>()
  const [isCreatingAccessToken, setIsCreatingAccessToken] = useState(false)
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
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
  const [actionMessage, setActionMessage] = useState<string | undefined>()
  const [actionError, setActionError] = useState<string | undefined>()

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

    const nextPathname = profileTabPath(activeProfileTab)
    const nextSearch = buildProfileTabSearch(activeProfileTab)
    if (location.pathname === nextPathname && location.search === nextSearch) return

    void navigate({
      pathname: nextPathname,
      search: nextSearch
    }, { replace: true })
  }, [activeProfileTab, buildProfileTabSearch, location.pathname, navigate, profileTab])

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
      setSecurityError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoadingSecurity(false)
    }
  }, [activeToken, currentUser])

  useEffect(() => {
    void loadSecurity()
  }, [loadSecurity])

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
      <section className='relay-profile-panel'>
        <Empty className='relay-profile__empty' description='未登录账号' />
      </section>
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
  const normalizedTokenSearch = tokenSearchValue.trim().toLowerCase()
  const filteredTokenRows = securitySummary.accessTokens.filter(token => {
    const status = tokenStatus(token)
    if (tokenStatusFilter !== 'all' && status !== tokenStatusFilter) return false
    if (!isTimestampWithinRange(token.createdAt, tokenCreatedFrom, tokenCreatedTo)) return false
    if (!isTimestampWithinRange(token.lastUsedAt, tokenLastUsedFrom, tokenLastUsedTo)) return false
    if (normalizedTokenSearch === '') return true
    return [
      token.name,
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

  const openAccessTokenModal = () => {
    setActionError(undefined)
    setActionMessage(undefined)
    setCreatedAccessToken(undefined)
    accessTokenForm.resetFields()
    setIsAccessTokenModalOpen(true)
  }

  const closeAccessTokenModal = () => {
    if (isCreatingAccessToken) return
    setIsAccessTokenModalOpen(false)
    setCreatedAccessToken(undefined)
  }

  const handleCreateAccessToken = async (values: AccessTokenFormValues) => {
    setIsCreatingAccessToken(true)
    setActionError(undefined)
    setActionMessage(undefined)
    try {
      const result = await createRelayProfileAccessToken(activeToken, values.name?.trim() ?? '')
      setCreatedAccessToken(result.accessToken)
      setActionMessage('系统访问令牌已生成')
      await loadSecurity()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsCreatingAccessToken(false)
    }
  }

  const handleRevokeAccessToken = async (token: RelayProfileAccessToken) => {
    setActionError(undefined)
    setActionMessage(undefined)
    try {
      await revokeRelayProfileAccessToken(activeToken, token.id)
      setActionMessage('系统访问令牌已撤销')
      await loadSecurity()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleCopyCreatedToken = async () => {
    if (createdAccessToken == null) return
    await navigator.clipboard?.writeText(createdAccessToken)
    setActionMessage('系统访问令牌已复制')
  }

  const handleCopyTokenPreview = async (token: RelayProfileAccessToken) => {
    setActionError(undefined)
    setActionMessage(undefined)
    try {
      await navigator.clipboard.writeText(token.tokenPreview)
      setActionMessage('令牌 Preview 已复制')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const openPasswordModal = () => {
    setActionError(undefined)
    setActionMessage(undefined)
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
    setActionMessage(undefined)
    try {
      await changeRelayProfilePassword(activeToken, {
        currentPassword: values.currentPassword,
        password: values.password
      })
      setActionMessage(securitySummary.password.enabled ? '密码已修改' : '密码已设置')
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
    setActionMessage(undefined)
    try {
      const optionsPayload = await createRelayProfilePasskeyOptions(activeToken)
      const response = await startRegistration({ optionsJSON: optionsPayload.options })
      await verifyRelayProfilePasskey(activeToken, {
        credentialName: `${userDisplayName(currentUser)} Passkey`,
        response
      })
      setActionMessage('Passkey 已注册')
      await loadSecurity()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setPasskeyLoading(false)
    }
  }

  const tokenColumns: TableColumnsType<RelayProfileAccessToken> = [
    {
      dataIndex: 'name',
      ellipsis: true,
      key: 'name',
      render: value => <strong>{value}</strong>,
      title: '名称',
      width: 180
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
          {securitySummary.password.enabled ? '修改密码' : '设置密码'}
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
          注册 Passkey
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
          启用验证
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
        <Button danger disabled icon={<AdminIcon name='delete' />} size='small'>
          删除账号
        </Button>
      ),
      description: '账号删除涉及设备、会话和审计数据归属，当前版本暂不开放',
      icon: <AdminIcon name='delete' />,
      key: 'delete-account',
      title: '删除账号'
    }
  ]

  return (
    <section className='relay-profile-panel'>
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
                  {actionMessage == null ? null : <Alert showIcon message={actionMessage} type='success' />}

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
                  {actionMessage == null ? null : <Alert showIcon message={actionMessage} type='success' />}

                  <AdminListTable<RelayProfileAccessToken>
                    ariaLabel='系统访问令牌列表'
                    className='relay-profile-token-table'
                    columnOptions={tokenColumnOptions}
                    columns={tokenColumns}
                    dataSource={filteredTokenRows}
                    emptyText='暂无系统访问令牌'
                    rowKey='id'
                    searchPlaceholder='搜索令牌名称、Preview、状态'
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
                        onClick={openAccessTokenModal}
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
        confirmLoading={isCreatingAccessToken}
        okText={createdAccessToken == null ? '生成令牌' : '复制令牌'}
        open={isAccessTokenModalOpen}
        title='系统访问令牌'
        onCancel={closeAccessTokenModal}
        onOk={() => {
          if (createdAccessToken == null) {
            accessTokenForm.submit()
            return
          }
          void handleCopyCreatedToken()
        }}
      >
        {createdAccessToken == null
          ? (
            <Form form={accessTokenForm} layout='vertical' onFinish={handleCreateAccessToken}>
              <Form.Item label='令牌名称' name='name'>
                <Input autoFocus placeholder='例如：Codex OpenAPI' />
              </Form.Item>
            </Form>
          )
          : (
            <div className='relay-profile-token-reveal'>
              <Alert
                showIcon
                message='请立即复制令牌。关闭后不会再次显示完整值。'
                type='warning'
              />
              <Input.TextArea autoSize readOnly value={createdAccessToken} />
            </div>
          )}
      </Modal>

      <Modal
        destroyOnHidden
        confirmLoading={isChangingPassword}
        okText={securitySummary.password.enabled ? '修改密码' : '设置密码'}
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
    </section>
  )
}
