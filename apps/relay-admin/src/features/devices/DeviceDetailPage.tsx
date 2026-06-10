/* eslint-disable max-lines -- device detail keeps ownership, status fields, and connection rows in one page. */
import './DevicePanel.css'

import { Descriptions, Empty, Table } from 'antd'
import type { DescriptionsProps, TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import type {
  RelayAdminCurrentUser,
  RelayAdminDevice,
  RelayAdminDeviceSession,
  RelayAdminUser
} from '../../shared/model/adminTypes'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { fetchRelayAdminDeviceSessions } from './devicesApi'

export interface DeviceDetailPageProps {
  currentUser?: RelayAdminCurrentUser
  devices: RelayAdminDevice[]
  loading: boolean
  token: string
  users: RelayAdminUser[]
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

const deviceStatusTone = (status: RelayAdminDevice['status']) => {
  if (status === 'online') return 'success'
  if (status === 'stale') return 'warning'
  return 'muted'
}

const deviceStatusLabel = (status: RelayAdminDevice['status']) => status ?? 'offline'

const userDisplayName = (user: { email: string; name: string } | undefined, fallback: string | undefined) => {
  if (user == null) return fallback ?? '-'
  return user.name.trim() || user.email
}

const formatJson = (value: Record<string, unknown>) => {
  const keys = Object.keys(value)
  if (keys.length === 0) return '-'
  return JSON.stringify(value, null, 2)
}

export const DeviceDetailPage = ({ currentUser, devices, loading, token, users }: DeviceDetailPageProps) => {
  const { deviceId } = useParams()
  const [sessionError, setSessionError] = useState<string | undefined>()
  const [sessions, setSessions] = useState<RelayAdminDeviceSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const device = devices.find(item => item.id === deviceId)
  const userById = useMemo(() => {
    const map = new Map<string, { email: string; name: string }>(users.map(user => [user.id, user]))
    if (currentUser != null) map.set(currentUser.id, currentUser)
    return map
  }, [currentUser, users])
  const owner = device?.userId == null ? undefined : userById.get(device.userId)

  useEffect(() => {
    let active = true
    if (device == null || token.trim() === '') {
      setSessions([])
      setSessionError(undefined)
      setSessionsLoading(false)
      return
    }

    setSessionsLoading(true)
    setSessionError(undefined)
    void fetchRelayAdminDeviceSessions(token, device.id)
      .then(body => {
        if (!active) return
        setSessions(body.sessions)
      })
      .catch(reason => {
        if (!active) return
        setSessions([])
        setSessionError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!active) return
        setSessionsLoading(false)
      })

    return () => {
      active = false
    }
  }, [device, token])

  if (device == null) {
    return (
      <section className='relay-device-detail-panel'>
        <Empty
          className='relay-device-detail__empty'
          description={loading ? '正在加载设备' : '设备不存在'}
        />
      </section>
    )
  }

  const descriptionItems: DescriptionsProps['items'] = [
    {
      children: device.id,
      key: 'id',
      label: '设备 ID'
    },
    {
      children: userDisplayName(owner, device.userId),
      key: 'user',
      label: '用户'
    },
    {
      children: <StatusBadge tone={deviceStatusTone(device.status)}>{deviceStatusLabel(device.status)}</StatusBadge>,
      key: 'status',
      label: '状态'
    },
    {
      children: formatTimestamp(device.lastSeenAt),
      key: 'lastSeenAt',
      label: '最近在线'
    },
    {
      children: formatTimestamp(device.createdAt),
      key: 'createdAt',
      label: '注册时间'
    },
    {
      children: device.pluginScope ?? '-',
      key: 'pluginScope',
      label: '插件范围'
    },
    {
      children: device.workspaceFolder ?? '-',
      key: 'workspaceFolder',
      label: '工作区'
    },
    {
      children: <pre className='relay-device-detail__json'>{formatJson(device.capabilities)}</pre>,
      key: 'capabilities',
      label: '支持功能'
    }
  ]
  const sessionColumns: TableColumnsType<RelayAdminDeviceSession> = [
    {
      dataIndex: 'title',
      ellipsis: true,
      key: 'title',
      render: value => value === '' ? '-' : value,
      title: '会话',
      width: 220
    },
    {
      dataIndex: 'state',
      key: 'state',
      render: value => value ?? '-',
      title: '状态',
      width: 120
    },
    {
      dataIndex: 'lastActiveAt',
      key: 'lastActiveAt',
      render: value => formatTimestamp(value),
      title: '最近活跃',
      width: 160
    },
    {
      dataIndex: 'id',
      ellipsis: true,
      key: 'id',
      render: value => <span className='relay-device-panel__secondary'>{value}</span>,
      title: '会话 ID',
      width: 240
    }
  ]

  return (
    <section className='relay-device-detail-panel'>
      <div className='relay-device-detail'>
        <div className='relay-device-detail__hero'>
          <span className='relay-device-detail__icon' aria-hidden='true'>
            <AdminIcon name='hub' />
          </span>
          <div className='relay-device-detail__title'>
            <span className='relay-device-detail__eyebrow'>设备</span>
            <h2>{device.name}</h2>
            <p>{userDisplayName(owner, device.userId)}</p>
          </div>
          <div className='relay-device-detail__badges'>
            <StatusBadge tone={deviceStatusTone(device.status)}>{deviceStatusLabel(device.status)}</StatusBadge>
          </div>
        </div>

        <Descriptions
          bordered
          className='relay-device-detail__descriptions'
          column={{ lg: 2, md: 1, sm: 1, xl: 2, xs: 1, xxl: 2 }}
          items={descriptionItems}
          size='small'
        />

        <div className='relay-device-detail__sessions'>
          <div className='relay-device-detail__sessions-header'>
            <h3>会话</h3>
            <StatusBadge tone={sessionError == null ? 'muted' : 'danger'}>
              {sessionError == null ? String(sessions.length) : 'error'}
            </StatusBadge>
          </div>
          {sessionError == null ? null : (
            <p className='relay-device-detail__error'>{sessionError}</p>
          )}
          <Table<RelayAdminDeviceSession>
            className='relay-admin-table relay-device-detail__sessions-table'
            columns={sessionColumns}
            dataSource={sessions}
            loading={sessionsLoading}
            locale={{ emptyText: '暂无会话' }}
            pagination={false}
            rowKey='id'
            scroll={{ x: 'max-content' }}
            size='middle'
          />
        </div>
      </div>
    </section>
  )
}
