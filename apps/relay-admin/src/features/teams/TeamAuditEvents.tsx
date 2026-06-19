/* eslint-disable max-lines -- Team audit list keeps filters, table state, and rendering close to the feature page. */

import { Space } from 'antd'
import type { TableColumnsType } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { useTeamDetailTabActions } from './TeamDetailTabActions'
import type { RelayAdminAuditEvent, RelayAdminTeam } from './teamTypes'
import { fetchRelayAdminTeamAuditEvents } from './teamsApi'

export interface TeamAuditEventsProps {
  disabled: boolean
  team: RelayAdminTeam
  token: string
}

const auditActionLabels: Record<string, string> = {
  'config.assignment.create': '创建配置分配',
  'config.assignment.update': '更新配置分配',
  'config.profile.create': '创建配置方案',
  'config.profile.publish': '发布配置方案',
  'config.profile.update': '更新配置方案',
  'config.profile.version.create': '创建配置版本',
  'config.secret.create': '创建密钥',
  'config.secret.revoke': '撤销密钥',
  'config.secret.rotate': '轮换密钥',
  'team.archive': '归档团队',
  'team.member.create': '添加成员',
  'team.member.delete': '移除成员',
  'team.member.update': '更新成员',
  'team.restore': '恢复团队',
  'team.update': '更新团队'
}

const auditStatusLabels: Record<string, string> = {
  blocked: '已拦截',
  failure: '失败',
  success: '成功',
  unknown: '未知'
}

const auditStatusTone = (status: string) => {
  if (status === 'success') return 'success'
  if (status === 'blocked') return 'warning'
  if (status === 'failure') return 'danger'
  return 'muted'
}

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
}

const formatAuditAction = (action: string) => auditActionLabels[action] ?? action

const formatAuditActor = (actor: string) => {
  if (actor === 'admin-token') return '管理 Token'
  if (actor === 'anonymous') return '匿名访问'
  if (actor === 'bearer') return 'Bearer Token'
  if (actor.startsWith('session:')) return `用户 ${actor.slice('session:'.length)}`
  if (actor.startsWith('device:')) return `设备 ${actor.slice('device:'.length)}`
  return actor
}

export const TeamAuditEvents = ({ disabled, team, token }: TeamAuditEventsProps) => {
  const [auditEvents, setAuditEvents] = useState<RelayAdminAuditEvent[]>([])
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [searchValue, setSearchValue] = useState('')
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(['createdAt', 'action', 'status', 'actor', 'ip'])
  const refreshAuditEvents = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    let active = true
    if (token.trim() === '') {
      setAuditEvents([])
      setError(undefined)
      return
    }
    setLoading(true)
    setError(undefined)
    void fetchRelayAdminTeamAuditEvents(token, team.id)
      .then(body => {
        if (!active) return
        setAuditEvents(body.events)
      })
      .catch(reason => {
        if (!active) return
        setAuditEvents([])
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [revision, team.id, token])

  const filteredEvents = useMemo(() => {
    const search = searchValue.trim().toLowerCase()
    if (search === '') return auditEvents
    return auditEvents.filter(event => {
      const values = [
        formatAuditAction(event.action),
        formatAuditActor(event.actor),
        auditStatusLabels[event.status] ?? event.status,
        event.action,
        event.actor,
        event.createdAt,
        event.id,
        event.ip ?? '',
        event.requestId ?? ''
      ]
      return values.some(value => value.toLowerCase().includes(search))
    })
  }, [auditEvents, searchValue])

  const columns: TableColumnsType<RelayAdminAuditEvent> = [
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: value => formatTimestamp(value),
      title: '时间',
      width: 190
    },
    {
      dataIndex: 'action',
      key: 'action',
      render: value => formatAuditAction(String(value)),
      title: '操作',
      width: 180
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: value => (
        <StatusBadge tone={auditStatusTone(String(value))}>
          {auditStatusLabels[String(value)] ?? String(value)}
        </StatusBadge>
      ),
      title: '状态',
      width: 100
    },
    {
      dataIndex: 'actor',
      key: 'actor',
      render: value => formatAuditActor(String(value)),
      title: '操作者',
      width: 180
    },
    {
      dataIndex: 'ip',
      key: 'ip',
      render: value => value ?? '-',
      title: '来源 IP',
      width: 140
    },
    {
      dataIndex: 'requestId',
      key: 'requestId',
      render: value => value == null ? '-' : <span className='relay-team-panel__secondary'>{value}</span>,
      title: '请求 ID',
      width: 220
    }
  ]
  const columnOptions: AdminListColumnOption[] = [
    { key: 'createdAt', label: '时间', required: true },
    { key: 'action', label: '操作', required: true },
    { key: 'status', label: '状态' },
    { key: 'actor', label: '操作者' },
    { key: 'ip', label: '来源 IP' },
    { key: 'requestId', label: '请求 ID' }
  ]
  const tabActions = useMemo(() => (
    <Space size={4}>
      <AdminActionButton
        aria-label='刷新审计'
        disabled={disabled || loading}
        iconName='refresh'
        onClick={refreshAuditEvents}
        size='small'
        title='刷新审计'
      />
    </Space>
  ), [disabled, loading, refreshAuditEvents])

  useTeamDetailTabActions('audit', tabActions)

  return (
    <div className='relay-team-panel__audit'>
      {error == null ? null : <p className='relay-team-panel__error'>{error}</p>}
      <AdminListTable<RelayAdminAuditEvent>
        ariaLabel='团队操作审计'
        className='relay-team-panel__audit-table'
        columnOptions={columnOptions}
        columns={columns}
        dataSource={filteredEvents}
        emptyText={loading ? '正在加载审计事件' : '暂无审计事件'}
        rowKey='id'
        searchPlaceholder='搜索操作、操作者、请求 ID'
        searchValue={searchValue}
        visibleColumnKeys={visibleColumnKeys}
        onSearchChange={setSearchValue}
        onVisibleColumnKeysChange={setVisibleColumnKeys}
      />
    </div>
  )
}
