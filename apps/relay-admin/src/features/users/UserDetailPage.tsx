/* eslint-disable max-lines -- user detail keeps account settings, metadata, and device list together. */
import './UserDetailPage.css'

import { Avatar, Empty, Input, InputNumber, Tabs } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'

import type {
  RelayAdminAccessGroup,
  RelayAdminCurrentUser,
  RelayAdminDevice,
  RelayAdminInvite,
  RelayAdminUser
} from '../../shared/model/adminTypes'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { accessGroupName } from '../access-groups/accessGroupModel'
import { DeviceTable } from '../devices/DeviceTable'
import type { RelayAdminTeam } from '../teams/teamTypes'
import { UserAccessPanel } from './UserAccessPanel'
import { UserTeamsPanel } from './UserTeamsPanel'

export interface UserDetailPageProps {
  accessGroups: RelayAdminAccessGroup[]
  currentUser?: RelayAdminCurrentUser
  devices: RelayAdminDevice[]
  disabled: boolean
  invites: RelayAdminInvite[]
  loading: boolean
  onSetLoginId: (user: RelayAdminUser, loginId: string | null) => Promise<void>
  teams: RelayAdminTeam[]
  token: string
  onSetMaxDevices: (user: RelayAdminUser, maxDevices: number | null) => Promise<void>
  onSetAccessGroups: (user: RelayAdminUser, groupIds: string[]) => Promise<void>
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
  accessGroups,
  currentUser,
  devices,
  disabled,
  invites,
  loading,
  onSetLoginId,
  teams,
  token,
  onSetMaxDevices,
  onSetAccessGroups,
  users
}: UserDetailPageProps) => {
  const { userId } = useParams()
  const user = users.find(item => item.id === userId)
  const [loginIdValue, setLoginIdValue] = useState('')
  const boundInvites = useMemo(
    () => user == null ? [] : invites.filter(invite => invite.userId === user.id),
    [invites, user]
  )
  const visibleDevices = useMemo(
    () => user == null || currentUser?.id !== user.id ? [] : devices.filter(device => device.userId === user.id),
    [currentUser?.id, devices, user]
  )

  useEffect(() => {
    setLoginIdValue(user?.loginId ?? '')
  }, [user?.id, user?.loginId])

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
  const commitLoginId = () => {
    const nextLoginId = loginIdValue.trim()
    const currentLoginId = user.loginId ?? ''
    if (nextLoginId === currentLoginId) return
    void onSetLoginId(user, nextLoginId === '' ? null : nextLoginId)
  }
  const detailFields: Array<{ key: string; label: string; value: ReactNode }> = [
    {
      key: 'loginId',
      label: '登录 ID',
      value: (
        <Input
          aria-label={`Login ID for ${user.email}`}
          className='relay-user-detail__login-id-input'
          disabled={disabled}
          placeholder={`默认：${user.email}`}
          size='small'
          value={loginIdValue}
          onBlur={commitLoginId}
          onChange={event => setLoginIdValue(event.target.value)}
          onPressEnter={event => event.currentTarget.blur()}
        />
      )
    },
    {
      key: 'groups',
      label: '用户组',
      value: user.groupIds.map(groupId => accessGroupName(accessGroups, groupId)).join(', ')
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

        <Tabs
          className='relay-user-detail__tabs'
          items={[
            {
              children: (
                <UserTeamsPanel
                  teams={teams}
                  token={token}
                  userId={user.id}
                />
              ),
              key: 'teams',
              label: '所属团队'
            },
            {
              children: (
                <UserAccessPanel
                  accessGroups={accessGroups}
                  disabled={disabled}
                  isCurrentUser={isCurrentUser}
                  user={user}
                  onSetAccessGroups={onSetAccessGroups}
                />
              ),
              key: 'access',
              label: '能力与配额'
            },
            {
              children: (
                <div className='relay-user-detail__devices'>
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
              ),
              key: 'devices',
              label: '设备'
            }
          ]}
        />
      </div>
    </section>
  )
}
