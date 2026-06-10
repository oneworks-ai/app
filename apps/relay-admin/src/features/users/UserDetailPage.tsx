/* eslint-disable max-lines -- user detail keeps account settings, metadata, and device list together. */
import './UserDetailPage.css'

import { Avatar, Empty, InputNumber, Select } from 'antd'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'

import { relayAdminRoles } from '../../shared/model/adminRoles'
import type {
  RelayAdminCurrentUser,
  RelayAdminDevice,
  RelayAdminInvite,
  RelayAdminRole,
  RelayAdminUser
} from '../../shared/model/adminTypes'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { DeviceTable } from '../devices/DeviceTable'

export interface UserDetailPageProps {
  currentUser?: RelayAdminCurrentUser
  devices: RelayAdminDevice[]
  disabled: boolean
  invites: RelayAdminInvite[]
  loading: boolean
  onSetMaxDevices: (user: RelayAdminUser, maxDevices: number | null) => Promise<void>
  onSetRole: (user: RelayAdminUser, role: RelayAdminRole) => Promise<void>
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

const userDisplayName = (user: RelayAdminUser) => user.name.trim() || user.email

const normalizeDeviceLimit = (value: string | number | null) => {
  if (value == null || value === '') return null
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null
}

const userDeviceCount = (user: RelayAdminUser, devices: RelayAdminDevice[]) => {
  const count = Number((user as { deviceCount?: unknown }).deviceCount)
  if (Number.isFinite(count)) return Math.max(0, Math.trunc(count))
  return devices.filter(device => device.userId === user.id).length
}

const userMaxDevices = (user: RelayAdminUser) => {
  const value = (user as { maxDevices?: unknown }).maxDevices
  if (value == null || value === '') return null
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null
}

export const UserDetailPage = ({
  currentUser,
  devices,
  disabled,
  invites,
  loading,
  onSetMaxDevices,
  onSetRole,
  users
}: UserDetailPageProps) => {
  const { userId } = useParams()
  const user = users.find(item => item.id === userId)
  const boundInvites = useMemo(
    () => user == null ? [] : invites.filter(invite => invite.userId === user.id),
    [invites, user]
  )
  const visibleDevices = useMemo(
    () => user == null || currentUser?.id !== user.id ? [] : devices.filter(device => device.userId === user.id),
    [currentUser?.id, devices, user]
  )

  if (user == null) {
    return (
      <section className='relay-user-detail-panel'>
        <Empty
          className='relay-user-detail__empty'
          description={loading ? '正在加载账号' : '账号不存在'}
        />
      </section>
    )
  }

  const source = user.provider ?? (user.passwordEnabled ? 'password' : '-')
  const deviceCount = userDeviceCount(user, devices)
  const maxDevices = userMaxDevices(user)
  const canViewDeviceDetails = currentUser?.id === user.id
  const isCurrentUser = currentUser?.id === user.id
  const detailFields: Array<{ key: string; label: string; value: ReactNode }> = [
    {
      key: 'role',
      label: '权限',
      value: (
        <Select
          aria-label={isCurrentUser ? '不能修改自己的权限' : `Role for ${user.email}`}
          className='relay-user-detail__role'
          disabled={disabled || isCurrentUser}
          onChange={role => void onSetRole(user, role)}
          options={relayAdminRoles.map(role => ({ label: role, value: role }))}
          size='small'
          value={user.role}
        />
      )
    },
    {
      key: 'deviceLimit',
      label: '设备上限',
      value: (
        <span className='relay-user-detail__device-limit'>
          <span className='relay-user-detail__device-count'>已连接 {deviceCount}</span>
          <InputNumber
            aria-label={`Max devices for ${user.email}`}
            className='relay-user-detail__device-input'
            controls={false}
            disabled={disabled}
            min={0}
            placeholder='不限'
            size='small'
            value={maxDevices}
            onChange={value => void onSetMaxDevices(user, normalizeDeviceLimit(value))}
          />
        </span>
      )
    },
    { key: 'id', label: 'ID', value: user.id },
    { key: 'source', label: '来源', value: source },
    { key: 'password', label: '密码', value: user.passwordEnabled ? '已启用' : '未设置' },
    { key: 'createdAt', label: '创建时间', value: formatTimestamp(user.createdAt) },
    { key: 'updatedAt', label: '更新时间', value: formatTimestamp(user.updatedAt) },
    { key: 'disabledAt', label: '禁用时间', value: formatTimestamp(user.disabledAt) },
    {
      key: 'invites',
      label: '邀请码',
      value: boundInvites.length === 0 ? '无' : boundInvites.map(invite => invite.code).join(', ')
    }
  ]

  return (
    <section className='relay-user-detail-panel'>
      <div className='relay-user-detail'>
        <div className='relay-user-detail__summary'>
          <Avatar
            className='relay-user-detail__avatar'
            icon={<AdminIcon name='person' />}
            size={54}
            src={user.avatarUrl ?? undefined}
          />
          <div className='relay-user-detail__title'>
            <h2>{userDisplayName(user)}</h2>
            <div className='relay-user-detail__meta'>
              <span>{user.email}</span>
              <span aria-hidden='true'>/</span>
              {user.disabled
                ? <StatusBadge tone='danger'>disabled</StatusBadge>
                : <StatusBadge tone='success'>active</StatusBadge>}
            </div>
          </div>
        </div>

        <dl className='relay-user-detail__fields'>
          {detailFields.map(field => (
            <div key={field.key} className='relay-user-detail__field'>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>

        <div className='relay-user-detail__devices'>
          <div className='relay-user-detail__devices-header'>
            <h3>设备</h3>
            <span>已连接 {deviceCount} · 上限 {maxDevices ?? '不限'}</span>
          </div>
          {canViewDeviceDetails
            ? (
              <DeviceTable
                devices={visibleDevices}
                initialVisibleColumnKeys={['name', 'status', 'lastSeenAt', 'capabilities']}
                searchPlaceholder='搜索设备、支持功能'
              />
            )
            : (
              <div className='relay-user-detail__private-devices'>
                <StatusBadge tone='muted'>{`${deviceCount} 台设备`}</StatusBadge>
                <span>设备明细仅账号本人可见</span>
              </div>
            )}
        </div>
      </div>
    </section>
  )
}
