/* eslint-disable max-lines -- Message center keeps list, detail, and composer behavior together. */
import './MessageCenterPage.css'

import { Avatar, Button, Drawer, Empty, Form, Input, Segmented, Select, Space } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useNavigate } from 'react-router-dom'
import remarkGfm from 'remark-gfm'

import type { RelayAdminCurrentUser, RelayAdminUser } from '../../shared/model/adminTypes'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { AdminSessionAccount } from '../auth/adminSessionStorage'
import type {
  CreateRelayAdminMessageInput,
  RelayAdminMessage,
  RelayAdminMessageAudienceScope,
  RelayAdminMessageKind,
  RelayAdminMessageUser,
  RelayAdminTeam,
  RelayAdminTeamInvitation
} from '../teams/teamTypes'
import {
  acceptRelayAdminTeamInvitation,
  createRelayAdminMessage,
  declineRelayAdminTeamInvitation,
  fetchRelayAdminMessages
} from '../teams/teamsApi'

export interface MessageCenterPageProps {
  accounts: AdminSessionAccount[]
  activeToken: string
  currentUser?: RelayAdminCurrentUser
  messageId?: string
  openComposerSignal?: number
  teams: RelayAdminTeam[]
  token: string
  users: RelayAdminUser[]
  onTeamInvitationChanged?: () => void
}

type MessageKind = RelayAdminMessageKind | 'team_invitation'
type MessageCategoryFilter = MessageKind | 'all'

interface MessageCenterItem {
  badge: string
  body: string
  createdAt: string
  detailBody: string
  detailRows: Array<[string, string]>
  id: string
  invitation?: RelayAdminTeamInvitation
  kind: MessageKind
  meta: string
  rawMessage?: RelayAdminMessage
  searchableText: string
  status: string
  title: string
}

interface MessageComposerValues {
  body?: string
  kind?: RelayAdminMessageKind
  scope?: RelayAdminMessageAudienceScope
  teamId?: string
  title?: string
  userIds?: string[]
}

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const invitationTeamName = (invitation: RelayAdminTeamInvitation) => (
  invitation.teamName ?? invitation.teamSlug ?? invitation.teamId
)

const invitationTarget = (invitation: RelayAdminTeamInvitation) => (
  invitation.user?.name.trim() || invitation.user?.email || invitation.email || invitation.userId || '待确认用户'
)

const invitationInviter = (invitation: RelayAdminTeamInvitation) => (
  invitation.inviter?.name.trim() || invitation.inviter?.email || invitation.createdByUserId
)

const messageKindIconName: Record<MessageKind, 'admin_panel_settings' | 'group' | 'notifications' | 'person'> = {
  announcement: 'notifications',
  personal: 'person',
  system: 'admin_panel_settings',
  team_invitation: 'group'
}

const messageKindLabel: Record<MessageKind, string> = {
  announcement: '站内公告',
  personal: '个人通知',
  system: '系统消息',
  team_invitation: '团队邀请'
}

const messageKindBadge: Record<RelayAdminMessageKind, string> = {
  announcement: '公告',
  personal: '个人',
  system: '系统'
}

const messageCategoryOptions: Array<{ label: string, value: MessageCategoryFilter }> = [
  { label: '全部', value: 'all' },
  { label: '公告', value: 'announcement' },
  { label: '邀请', value: 'team_invitation' },
  { label: '个人', value: 'personal' },
  { label: '系统', value: 'system' }
]

const buildSearchableText = (values: Array<string | null | undefined>) => (
  values.filter((value): value is string => value != null && value.trim() !== '').join(' ').toLowerCase()
)

const markdownToSummary = (value: string) => (
  value
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/[*_~>#|-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
)

const displayUser = (user: RelayAdminMessageUser | RelayAdminCurrentUser | null | undefined) => (
  user == null ? '系统' : user.name.trim() || user.email || user.id
)

const messageAudienceLabel = (message: RelayAdminMessage) => {
  if (message.audience.scope === 'all') return '全体用户'
  if (message.audience.scope === 'team') {
    return message.audience.team?.name ?? message.audience.teamId ?? '团队'
  }
  const users = message.audience.users.filter((user): user is RelayAdminMessageUser => user != null)
  if (users.length === 1) return displayUser(users[0])
  return `${message.audience.userIds.length} 个指定用户`
}

const relayMessageToItem = (message: RelayAdminMessage): MessageCenterItem => {
  const audience = messageAudienceLabel(message)
  const sender = displayUser(message.createdBy)
  const createdAt = formatTimestamp(message.createdAt)
  return {
    id: `message:${message.id}`,
    kind: message.kind,
    title: message.title,
    body: markdownToSummary(message.body) || message.body,
    detailBody: message.body,
    meta: [messageKindLabel[message.kind], audience, sender].filter(Boolean).join(' · '),
    badge: messageKindBadge[message.kind],
    status: 'sent',
    createdAt: message.createdAt,
    rawMessage: message,
    detailRows: [
      ['类型', messageKindLabel[message.kind]],
      ['时间', createdAt],
      ['发送人', sender],
      ['目标', audience]
    ],
    searchableText: buildSearchableText([
      message.title,
      message.body,
      messageKindLabel[message.kind],
      audience,
      sender,
      message.createdByUserId,
      ...(message.audience.users.map(user => user?.name ?? user?.email ?? user?.id)),
      message.audience.team?.name,
      message.audience.team?.slug
    ])
  }
}

const invitationToMessage = (invitation: RelayAdminTeamInvitation): MessageCenterItem => {
  const teamName = invitationTeamName(invitation)
  const target = invitationTarget(invitation)
  const inviter = invitationInviter(invitation)
  const createdAt = formatTimestamp(invitation.createdAt)
  const body = `${inviter} 邀请 ${target} 以 ${invitation.role} 身份加入团队。接受后才会加入团队并继承对应团队配置。`
  return {
    id: `team-invitation:${invitation.id}`,
    kind: 'team_invitation',
    title: `${teamName} 邀请`,
    body,
    detailBody: `**${inviter}** 邀请 **${target}** 以 \`${invitation.role}\` 身份加入团队。\n\n接受后才会加入团队并继承对应团队配置。`,
    meta: [
      messageKindLabel.team_invitation,
      invitation.configEnabled ? '启用团队配置' : '不启用团队配置',
      invitation.defaultForPublishing ? '默认发布团队' : ''
    ].filter(Boolean).join(' · '),
    badge: invitation.status === 'pending' ? '待处理' : invitation.status,
    status: invitation.status,
    createdAt: invitation.createdAt,
    invitation,
    detailRows: [
      ['类型', messageKindLabel.team_invitation],
      ['时间', createdAt],
      ['邀请人', inviter],
      ['目标账号', target],
      ['团队', teamName],
      ['团队角色', invitation.role],
      ['团队配置', invitation.configEnabled ? '启用' : '不启用']
    ],
    searchableText: buildSearchableText([
      teamName,
      invitation.teamSlug,
      invitation.email,
      invitation.userId,
      invitation.user?.name,
      invitation.user?.email,
      invitation.inviter?.name,
      invitation.inviter?.email,
      invitation.role,
      invitation.status,
      '团队邀请'
    ])
  }
}

const currentUserToMessageUser = (currentUser: RelayAdminCurrentUser | undefined): RelayAdminMessageUser | null => (
  currentUser == null
    ? null
    : {
      avatarUrl: currentUser.avatarUrl ?? null,
      email: currentUser.email,
      id: currentUser.id,
      name: currentUser.name,
      provider: currentUser.provider ?? null,
      role: currentUser.role
    }
)

const userToMessageUser = (user: RelayAdminUser): RelayAdminMessageUser => ({
  avatarUrl: user.avatarUrl,
  email: user.email,
  id: user.id,
  name: user.name,
  provider: user.provider,
  role: user.role
})

const demoRelayMessages = (currentUser: RelayAdminCurrentUser | undefined): RelayAdminMessage[] => {
  const accountName = currentUser?.name.trim() || currentUser?.email || '当前账号'
  return [
    {
      id: 'demo-announcement-relay-maintenance',
      kind: 'announcement',
      title: 'Relay 控制台消息能力灰度中',
      body: '消息中心将承载团队邀请、站内公告、账号通知和系统消息。较长内容会进入消息详情页完整展示，列表只保留摘要。',
      audience: { scope: 'all', team: null, teamId: null, userIds: [], users: [] },
      createdBy: null,
      createdByUserId: 'system',
      createdAt: '2026-06-17T09:30:00.000Z',
      updatedAt: null
    },
    {
      id: 'demo-personal-login',
      kind: 'personal',
      title: '新设备登录提醒',
      body: `${accountName} 的账号刚刚从 IP 203.0.113.42 在 CN Shanghai 完成登录。设备信息：Chrome / macOS。若不是本人操作，请及时修改密码或联系管理员。`,
      audience: {
        scope: 'users',
        team: null,
        teamId: null,
        userIds: [currentUser?.id ?? 'relay-demo-owner'],
        users: [currentUserToMessageUser(currentUser)]
      },
      createdBy: null,
      createdByUserId: 'system',
      createdAt: '2026-06-17T09:12:00.000Z',
      updatedAt: null
    },
    {
      id: 'demo-system-config-sync',
      kind: 'system',
      title: '团队配置同步策略已生效',
      body: '新的配置分发规则会影响已加入团队的用户，未接受邀请的用户不会收到团队配置。管理员可在团队配置页继续调整分发范围。',
      audience: { scope: 'team', team: { id: 'demo-team', name: 'Relay Demo Team', slug: 'relay-demo-team', avatarUrl: null }, teamId: 'demo-team', userIds: [], users: [] },
      createdBy: null,
      createdByUserId: 'system',
      createdAt: '2026-06-16T21:45:00.000Z',
      updatedAt: null
    }
  ]
}

const demoTeamInvitation = (
  currentUser: RelayAdminCurrentUser | undefined,
  status: RelayAdminTeamInvitation['status']
): RelayAdminTeamInvitation => ({
  id: 'demo-team-invitation-relay-demo-team',
  teamId: 'demo-team',
  teamName: 'Relay Demo Team',
  teamSlug: 'relay-demo-team',
  teamAvatarUrl: null,
  email: currentUser?.email ?? 'relay-demo-owner@example.com',
  userId: currentUser?.id ?? 'relay-demo-owner',
  user: currentUserToMessageUser(currentUser),
  inviter: {
    avatarUrl: null,
    email: 'admin@example.com',
    id: 'admin-1',
    name: 'Relay Admin',
    provider: null,
    role: 'admin'
  },
  role: 'member',
  configEnabled: true,
  defaultForPublishing: false,
  status,
  createdByUserId: 'admin-1',
  createdAt: '2026-06-17T09:20:00.000Z',
  updatedAt: status === 'pending' ? null : '2026-06-17T09:25:00.000Z',
  respondedAt: status === 'pending' ? null : '2026-06-17T09:25:00.000Z'
})

const messageStatusTone = (message: MessageCenterItem) => (
  message.kind === 'team_invitation' && message.status === 'pending' ? 'warning' : 'muted'
)

const isTeamManagerRole = (role: string | null | undefined) => (
  role === 'owner' || role === 'admin'
)

const canSendPlatformMessage = (currentUser: RelayAdminCurrentUser | undefined) => (
  currentUser?.role === 'owner' || currentUser?.role === 'admin'
)

const createLocalMessage = (
  values: CreateRelayAdminMessageInput,
  currentUser: RelayAdminCurrentUser | undefined,
  users: RelayAdminUser[],
  teams: RelayAdminTeam[]
): RelayAdminMessage => {
  const targetTeam = values.teamId == null ? undefined : teams.find(team => team.id === values.teamId)
  const targetUsers = (values.userIds ?? [])
    .map(userId => users.find(user => user.id === userId))
    .filter((user): user is RelayAdminUser => user != null)
    .map(userToMessageUser)
  return {
    id: `local-${Date.now()}`,
    kind: values.kind,
    title: values.title,
    body: values.body,
    audience: {
      scope: values.scope,
      teamId: values.teamId ?? null,
      team: targetTeam == null
        ? null
        : {
          avatarUrl: targetTeam.avatarUrl,
          id: targetTeam.id,
          name: targetTeam.name,
          slug: targetTeam.slug
        },
      userIds: values.userIds ?? [],
      users: targetUsers
    },
    createdBy: currentUserToMessageUser(currentUser),
    createdByUserId: currentUser?.id ?? 'local-user',
    createdAt: new Date().toISOString(),
    updatedAt: null
  }
}

export const MessageCenterPage = ({
  currentUser,
  messageId,
  openComposerSignal,
  teams,
  token,
  users,
  onTeamInvitationChanged
}: MessageCenterPageProps) => {
  const navigate = useNavigate()
  const [composerForm] = Form.useForm<MessageComposerValues>()
  const composerScope = Form.useWatch('scope', composerForm)
  const composerTeamId = Form.useWatch('teamId', composerForm)
  const [activeInvitationId, setActiveInvitationId] = useState<string | undefined>()
  const [composerOpen, setComposerOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const [demoInvitationStatus, setDemoInvitationStatus] = useState<RelayAdminTeamInvitation['status']>('pending')
  const [error, setError] = useState<string | undefined>()
  const [invitations, setInvitations] = useState<RelayAdminTeamInvitation[]>([])
  const [localMessages, setLocalMessages] = useState<RelayAdminMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<MessageCategoryFilter>('all')
  const [searchValue, setSearchValue] = useState('')
  const [serverMessages, setServerMessages] = useState<RelayAdminMessage[]>([])
  const [useDemoMessages, setUseDemoMessages] = useState(false)
  const isPlatformSender = canSendPlatformMessage(currentUser)
  const manageableTeams = useMemo(() => (
    isPlatformSender
      ? teams
      : teams.filter(team => isTeamManagerRole(team.membership?.role))
  ), [isPlatformSender, teams])
  const canSendMessage = isPlatformSender || manageableTeams.length > 0
  const refreshMessages = useCallback(() => {
    if (token.trim() === '') {
      setInvitations([])
      setServerMessages([])
      setUseDemoMessages(true)
      return
    }
    setLoading(true)
    setError(undefined)
    void fetchRelayAdminMessages(token)
      .then(body => {
        setInvitations(body.invitations)
        setServerMessages(body.messages ?? [])
        setUseDemoMessages(false)
      })
      .catch(reason => {
        setInvitations([])
        setServerMessages([])
        const message = reason instanceof Error ? reason.message : String(reason)
        setUseDemoMessages(message === 'Not found.')
        setError(message === 'Not found.' ? undefined : message)
      })
      .finally(() => setLoading(false))
  }, [token])
  const respondInvitation = async (invitation: RelayAdminTeamInvitation, action: 'accept' | 'decline') => {
    setActiveInvitationId(invitation.id)
    setError(undefined)
    try {
      if (invitation.id.startsWith('demo-')) {
        setDemoInvitationStatus(action === 'accept' ? 'accepted' : 'declined')
        return
      }
      if (action === 'accept') {
        await acceptRelayAdminTeamInvitation(token, invitation.id)
        onTeamInvitationChanged?.()
      } else {
        await declineRelayAdminTeamInvitation(token, invitation.id)
      }
      refreshMessages()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setActiveInvitationId(undefined)
    }
  }
  const openComposer = useCallback(() => {
    const defaultScope: RelayAdminMessageAudienceScope = isPlatformSender ? 'all' : 'team'
    composerForm.setFieldsValue({
      kind: isPlatformSender ? 'announcement' : 'system',
      scope: defaultScope,
      teamId: defaultScope === 'all' ? undefined : manageableTeams[0]?.id,
      userIds: []
    })
    setComposerOpen(true)
  }, [composerForm, isPlatformSender, manageableTeams])
  const submitComposer = async (values: MessageComposerValues) => {
    const scope = values.scope ?? (isPlatformSender ? 'all' : 'team')
    const input: CreateRelayAdminMessageInput = {
      kind: values.kind ?? 'personal',
      scope,
      title: values.title?.trim() ?? '',
      body: values.body?.trim() ?? '',
      ...(scope === 'team' || scope === 'users' ? { teamId: values.teamId } : {}),
      ...(scope === 'users' ? { userIds: values.userIds ?? [] } : {})
    }
    setComposing(true)
    setError(undefined)
    try {
      const body = await createRelayAdminMessage(token, input)
      setLocalMessages(current => [body.message, ...current])
      setComposerOpen(false)
      composerForm.resetFields()
      refreshMessages()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (message === 'Not found.' || message === 'Method not allowed.') {
        setLocalMessages(current => [createLocalMessage(input, currentUser, users, teams), ...current])
        setComposerOpen(false)
        composerForm.resetFields()
      } else {
        setError(message)
      }
    } finally {
      setComposing(false)
    }
  }

  useEffect(() => {
    refreshMessages()
  }, [refreshMessages])

  useEffect(() => {
    if (openComposerSignal == null || openComposerSignal === 0 || !canSendMessage) return
    openComposer()
  }, [canSendMessage, openComposer, openComposerSignal])

  const messages = useMemo(() => {
    const invitationMessages = (useDemoMessages
      ? [demoTeamInvitation(currentUser, demoInvitationStatus)]
      : invitations
    ).map(invitationToMessage)
    const relayMessages = [
      ...localMessages,
      ...(useDemoMessages ? demoRelayMessages(currentUser) : serverMessages)
    ].map(relayMessageToItem)
    return [...invitationMessages, ...relayMessages]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  }, [currentUser, demoInvitationStatus, invitations, localMessages, serverMessages, useDemoMessages])
  const filteredMessages = useMemo(() => {
    const categoryMessages = categoryFilter === 'all'
      ? messages
      : messages.filter(message => message.kind === categoryFilter)
    const query = searchValue.trim().toLowerCase()
    if (query === '') return categoryMessages
    return categoryMessages.filter(message => message.searchableText.includes(query))
  }, [categoryFilter, messages, searchValue])
  const activeMessage = useMemo(() => (
    messageId == null ? undefined : messages.find(message => message.id === messageId)
  ), [messageId, messages])
  const scopeOptions = useMemo(() => [
    ...(isPlatformSender ? [{ label: '全体用户', value: 'all' as const }] : []),
    { label: '团队成员', value: 'team' as const },
    { label: '指定用户', value: 'users' as const }
  ], [isPlatformSender])
  const teamOptions = manageableTeams.map(team => ({
    label: `${team.name} · ${team.slug}`,
    value: team.id
  }))
  const userOptions = (isPlatformSender || composerTeamId == null
    ? users
    : users.filter(user => user.teams.some(team => team.id === composerTeamId))
  ).map(user => ({
    label: `${user.name.trim() || user.email} · ${user.email} · ${user.id}`,
    value: user.id
  }))
  const shouldPickTeam = composerScope === 'team' || (composerScope === 'users' && !isPlatformSender)

  if (messageId != null) {
    return (
      <section className='relay-message-center relay-message-center--detail'>
        {activeMessage == null ? (
          <Empty
            className='relay-message-center__empty'
            description={loading ? '正在加载消息' : '消息不存在或当前账号无权查看'}
          />
        ) : (
          <article className={`relay-message-center__detail relay-message-center__item--${activeMessage.kind}`}>
            <div className='relay-message-center__detail-header'>
              <Avatar
                className='relay-message-center__team-avatar'
                icon={<AdminIcon name={messageKindIconName[activeMessage.kind]} />}
                size={44}
                src={activeMessage.invitation?.teamAvatarUrl ?? activeMessage.rawMessage?.audience.team?.avatarUrl ?? undefined}
              >
                {activeMessage.title.slice(0, 1).toUpperCase()}
              </Avatar>
              <div className='relay-message-center__detail-title'>
                <div className='relay-message-center__item-title-row'>
                  <h3>{activeMessage.title}</h3>
                  <StatusBadge tone={messageStatusTone(activeMessage)}>
                    {activeMessage.badge}
                  </StatusBadge>
                </div>
                <time>{formatTimestamp(activeMessage.createdAt)}</time>
              </div>
            </div>
            <div className='relay-message-center__detail-body'>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {activeMessage.detailBody}
              </ReactMarkdown>
            </div>
            <dl className='relay-message-center__detail-meta'>
              {activeMessage.detailRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {activeMessage.invitation != null && activeMessage.invitation.status === 'pending' ? (
              <div className='relay-message-center__detail-actions'>
                <Space size={6}>
                  <Button
                    disabled={activeInvitationId != null}
                    loading={activeInvitationId === activeMessage.invitation.id}
                    type='primary'
                    onClick={() => void respondInvitation(activeMessage.invitation as RelayAdminTeamInvitation, 'accept')}
                  >
                    接受邀请
                  </Button>
                  <Button
                    disabled={activeInvitationId != null}
                    onClick={() => void respondInvitation(activeMessage.invitation as RelayAdminTeamInvitation, 'decline')}
                  >
                    拒绝
                  </Button>
                </Space>
              </div>
            ) : null}
          </article>
        )}
      </section>
    )
  }

  return (
    <section className='relay-message-center'>
      <div className='relay-message-center__filters'>
        <Input
          allowClear
          className='relay-message-center__search'
          disabled={loading && messages.length === 0}
          placeholder='搜索消息、团队、邀请人、账号、邮箱、用户 ID'
          prefix={<AdminIcon name='search' />}
          value={searchValue}
          onChange={event => setSearchValue(event.target.value)}
        />
        <Segmented
          className='relay-message-center__category-filter'
          options={messageCategoryOptions}
          value={categoryFilter}
          onChange={value => setCategoryFilter(value as MessageCategoryFilter)}
        />
      </div>
      {error == null ? null : <p className='relay-message-center__error'>{error}</p>}
      {filteredMessages.length === 0 ? (
        <Empty
          className='relay-message-center__empty'
          description={
            loading
              ? '正在加载消息'
              : searchValue.trim() !== ''
                ? '无匹配消息'
                : categoryFilter === 'all'
                  ? '暂无消息'
                  : '当前分类暂无消息'
          }
        />
      ) : (
        <div className='relay-message-center__list'>
          {filteredMessages.map(message => (
            <article
              className={[
                'relay-message-center__item',
                `relay-message-center__item--${message.kind}`
              ].join(' ')}
              key={message.id}
              role='button'
              tabIndex={0}
              onClick={() => void navigate(`/messages/${encodeURIComponent(message.id)}`)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void navigate(`/messages/${encodeURIComponent(message.id)}`)
                }
              }}
            >
              <Avatar
                className='relay-message-center__team-avatar'
                icon={<AdminIcon name={messageKindIconName[message.kind]} />}
                size={34}
                src={message.invitation?.teamAvatarUrl ?? message.rawMessage?.audience.team?.avatarUrl ?? undefined}
              >
                {message.title.slice(0, 1).toUpperCase()}
              </Avatar>
              <div className='relay-message-center__item-copy'>
                <h4>{message.title}</h4>
                <p>{message.body}</p>
                <span className='relay-message-center__item-meta'>{message.meta}</span>
              </div>
              <div className='relay-message-center__item-side'>
                <StatusBadge tone={messageStatusTone(message)}>
                  {message.badge}
                </StatusBadge>
                {message.invitation != null && message.invitation.status === 'pending' ? (
                  <Space
                    className='relay-message-center__item-actions'
                    size={6}
                    onClick={event => event.stopPropagation()}
                  >
                    <Button
                      disabled={activeInvitationId != null}
                      loading={activeInvitationId === message.invitation.id}
                      size='small'
                      type='primary'
                      onClick={() => void respondInvitation(message.invitation as RelayAdminTeamInvitation, 'accept')}
                    >
                      接受
                    </Button>
                    <Button
                      disabled={activeInvitationId != null}
                      size='small'
                      onClick={() => void respondInvitation(message.invitation as RelayAdminTeamInvitation, 'decline')}
                    >
                      拒绝
                    </Button>
                  </Space>
                ) : <span aria-hidden='true' />}
                <time>{formatTimestamp(message.createdAt)}</time>
              </div>
            </article>
          ))}
        </div>
      )}
      <Drawer
        className='relay-message-center__composer'
        destroyOnHidden
        open={composerOpen}
        title='发送消息'
        width={420}
        onClose={() => setComposerOpen(false)}
      >
        <Form
          form={composerForm}
          layout='vertical'
          onFinish={values => void submitComposer(values)}
        >
          <Form.Item label='消息类型' name='kind' rules={[{ required: true, message: '请选择消息类型' }]}>
            <Select
              options={[
                { label: '站内公告', value: 'announcement' },
                { label: '个人通知', value: 'personal' },
                { label: '系统消息', value: 'system' }
              ]}
            />
          </Form.Item>
          <Form.Item label='发送范围' name='scope' rules={[{ required: true, message: '请选择发送范围' }]}>
            <Select options={scopeOptions} />
          </Form.Item>
          {shouldPickTeam ? (
            <Form.Item label='目标团队' name='teamId' rules={[{ required: true, message: '请选择目标团队' }]}>
              <Select options={teamOptions} />
            </Form.Item>
          ) : null}
          {composerScope === 'users' ? (
            <Form.Item label='目标用户' name='userIds' rules={[{ required: true, message: '请选择目标用户' }]}>
              <Select mode='multiple' options={userOptions} />
            </Form.Item>
          ) : null}
          <Form.Item label='标题' name='title' rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item label='内容' name='body' rules={[{ required: true, message: '请输入内容' }]}>
            <Input.TextArea autoSize={{ minRows: 5, maxRows: 9 }} />
          </Form.Item>
          <Button block htmlType='submit' loading={composing} type='primary'>
            发送消息
          </Button>
        </Form>
      </Drawer>
    </section>
  )
}
