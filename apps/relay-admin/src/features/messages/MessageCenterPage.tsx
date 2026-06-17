import './MessageCenterPage.css'

import { Avatar, Button, Empty, Input, Space } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { RelayAdminCurrentUser } from '../../shared/model/adminTypes'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { AdminSessionAccount } from '../auth/adminSessionStorage'
import type { RelayAdminTeamInvitation } from '../teams/teamTypes'
import {
  acceptRelayAdminTeamInvitation,
  declineRelayAdminTeamInvitation,
  fetchRelayAdminMessages
} from '../teams/teamsApi'

export interface MessageCenterPageProps {
  accounts: AdminSessionAccount[]
  activeToken: string
  currentUser?: RelayAdminCurrentUser
  token: string
  onTeamInvitationChanged?: () => void
}

type MessageKind = 'announcement' | 'personal' | 'system' | 'team_invitation'

interface MessageCenterItem {
  badge: string
  body: string
  createdAt: string
  id: string
  invitation?: RelayAdminTeamInvitation
  kind: MessageKind
  meta: string
  searchableText: string
  status: string
  title: string
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

const buildSearchableText = (values: Array<string | null | undefined>) => (
  values.filter((value): value is string => value != null && value.trim() !== '').join(' ').toLowerCase()
)

const invitationToMessage = (invitation: RelayAdminTeamInvitation): MessageCenterItem => {
  const teamName = invitationTeamName(invitation)
  const target = invitationTarget(invitation)
  const inviter = invitationInviter(invitation)
  return {
    id: `team-invitation:${invitation.id}`,
    kind: 'team_invitation',
    title: teamName,
    body: `${inviter} 邀请 ${target} 以 ${invitation.role} 身份加入团队`,
    meta: [
      formatTimestamp(invitation.createdAt),
      invitation.configEnabled ? '启用团队配置' : '不启用团队配置',
      invitation.defaultForPublishing ? '默认发布团队' : ''
    ].filter(Boolean).join(' · '),
    badge: invitation.status === 'pending' ? '待处理' : invitation.status,
    status: invitation.status,
    createdAt: invitation.createdAt,
    invitation,
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

const demoMessages = (currentUser: RelayAdminCurrentUser | undefined): MessageCenterItem[] => {
  const accountName = currentUser?.name.trim() || currentUser?.email || '当前账号'
  return [
    {
      id: 'demo-announcement-relay-maintenance',
      kind: 'announcement',
      title: 'Relay 控制台消息能力灰度中',
      body: '消息中心将承载团队邀请、站内公告和账号通知，当前演示数据用于预览交互效果。',
      meta: '平台',
      badge: '公告',
      status: 'info',
      createdAt: '2026-06-17T09:30:00.000Z',
      searchableText: buildSearchableText(['站内公告', 'Relay 控制台消息能力灰度中', '平台', '消息中心'])
    },
    {
      id: 'demo-personal-security',
      kind: 'personal',
      title: '账号安全设置已更新',
      body: `${accountName} 的账号安全策略已同步，新的设备登录会在这里生成提醒。`,
      meta: '账号',
      badge: '个人',
      status: 'info',
      createdAt: '2026-06-17T08:10:00.000Z',
      searchableText: buildSearchableText(['个人通知', accountName, '账号安全设置已更新', '设备登录'])
    },
    {
      id: 'demo-system-config-sync',
      kind: 'system',
      title: '团队配置同步策略已生效',
      body: '新的配置分发规则会影响已加入团队的用户，未接受邀请的用户不会收到团队配置。',
      meta: '配置分发',
      badge: '系统',
      status: 'info',
      createdAt: '2026-06-16T21:45:00.000Z',
      searchableText: buildSearchableText(['系统消息', '团队配置', '配置分发', '邀请'])
    }
  ]
}

const messageStatusTone = (message: MessageCenterItem) => (
  message.kind === 'team_invitation' && message.status === 'pending' ? 'warning' : 'muted'
)

export const MessageCenterPage = ({
  currentUser,
  token,
  onTeamInvitationChanged
}: MessageCenterPageProps) => {
  const [activeInvitationId, setActiveInvitationId] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [invitations, setInvitations] = useState<RelayAdminTeamInvitation[]>([])
  const [loading, setLoading] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [useDemoMessages, setUseDemoMessages] = useState(false)
  const refreshMessages = useCallback(() => {
    if (token.trim() === '') {
      setInvitations([])
      setUseDemoMessages(true)
      return
    }
    setLoading(true)
    setError(undefined)
    void fetchRelayAdminMessages(token)
      .then(body => {
        setInvitations(body.invitations)
        setUseDemoMessages(false)
      })
      .catch(reason => {
        setInvitations([])
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

  useEffect(() => {
    refreshMessages()
  }, [refreshMessages])
  const messages = useMemo(() => {
    const invitationMessages = invitations.map(invitationToMessage)
    return useDemoMessages ? demoMessages(currentUser) : invitationMessages
  }, [currentUser, invitations, useDemoMessages])
  const filteredMessages = useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    if (query === '') return messages
    return messages.filter(message => message.searchableText.includes(query))
  }, [messages, searchValue])

  return (
    <section className='relay-message-center'>
      <Input
        allowClear
        className='relay-message-center__search'
        disabled={loading && messages.length === 0}
        placeholder='搜索消息、团队、邀请人、账号、邮箱、用户 ID'
        prefix={<AdminIcon name='search' />}
        value={searchValue}
        onChange={event => setSearchValue(event.target.value)}
      />
      {error == null ? null : <p className='relay-message-center__error'>{error}</p>}
      {filteredMessages.length === 0 ? (
        <Empty
          className='relay-message-center__empty'
          description={loading ? '正在加载消息' : searchValue.trim() === '' ? '暂无消息' : '无匹配消息'}
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
            >
              <Avatar
                className='relay-message-center__team-avatar'
                icon={<AdminIcon name={messageKindIconName[message.kind]} />}
                size={34}
                src={message.invitation?.teamAvatarUrl ?? undefined}
              >
                {message.title.slice(0, 1).toUpperCase()}
              </Avatar>
              <div className='relay-message-center__item-copy'>
                <div className='relay-message-center__item-title-row'>
                  <h4>{message.title}</h4>
                  <StatusBadge tone={messageStatusTone(message)}>
                    {message.badge}
                  </StatusBadge>
                </div>
                <p>{message.body}</p>
                <span className='relay-message-center__item-meta'>
                  {messageKindLabel[message.kind]} · {message.meta}
                </span>
              </div>
              {message.invitation != null && message.invitation.status === 'pending' ? (
                <Space className='relay-message-center__item-actions' size={6}>
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
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
