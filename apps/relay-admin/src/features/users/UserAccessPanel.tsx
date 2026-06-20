import { Button, Select } from 'antd'
import { useEffect, useMemo, useState } from 'react'

import type { RelayAdminAccessGroup, RelayAdminEffectiveAccess, RelayAdminUser } from '../../shared/model/adminTypes'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { accessGroupName, accessGroupOptions, defaultPlatformGroupIds } from '../access-groups/accessGroupModel'

export interface UserAccessPanelProps {
  accessGroups: RelayAdminAccessGroup[]
  disabled: boolean
  isCurrentUser: boolean
  onSetAccessGroups: (user: RelayAdminUser, groupIds: string[]) => Promise<void>
  user: RelayAdminUser
}

const quotaLabels: Record<string, string> = {
  maxDevices: '设备上限',
  maxMembersPerOwnedTeam: '名下团队成员上限',
  maxTeamsJoined: '可加入团队数',
  maxTeamsOwned: '可创建团队数'
}

const capabilityLabels: Record<string, string> = {
  'admin.accessGroups.read': '查看用户组',
  'admin.accessGroups.write': '管理用户组',
  'admin.devices.read': '查看设备',
  'admin.devices.write': '管理设备',
  'admin.invites.read': '查看邀请码',
  'admin.invites.write': '管理邀请码',
  'admin.settings.read': '查看站点设置',
  'admin.settings.write': '管理站点设置',
  'admin.sso.read': '查看 SSO',
  'admin.sso.write': '管理 SSO',
  'admin.users.read': '查看用户',
  'admin.users.write': '管理用户',
  'relay.messages.read': '查看消息',
  'relay.messages.write': '发送消息',
  'relay.teamAudit.read': '查看团队审计',
  'relay.teamConfigProfiles.read': '查看配置方案',
  'relay.teamConfigProfiles.write': '管理配置方案',
  'relay.teamConfigSecrets.read': '查看密钥',
  'relay.teamConfigSecrets.write': '管理密钥',
  'relay.teamMembers.read': '查看团队成员',
  'relay.teamMembers.write': '管理团队成员',
  'relay.teams.read': '查看团队',
  'relay.teams.write': '管理团队'
}

const capabilityLabel = (capability: string) => capabilityLabels[capability] ?? capability

const quotaEntries = (access: RelayAdminEffectiveAccess) =>
  Object.entries(access.quotas)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      label: quotaLabels[key] ?? key,
      value: value == null ? '不限' : String(value)
    }))

export const UserAccessPanel = ({
  accessGroups,
  disabled,
  isCurrentUser,
  onSetAccessGroups,
  user
}: UserAccessPanelProps) => {
  const [selectedGroupIds, setSelectedGroupIds] = useState(user.groupIds)
  const canSave = !disabled && !isCurrentUser &&
    selectedGroupIds.slice().sort().join('\n') !== user.groupIds.slice().sort().join('\n')
  const quotas = useMemo(() => quotaEntries(user.effectiveAccess), [user.effectiveAccess])

  useEffect(() => {
    setSelectedGroupIds(user.groupIds.length === 0 ? defaultPlatformGroupIds(user.role) : user.groupIds)
  }, [user.groupIds, user.role])

  return (
    <div className='relay-user-detail__access'>
      <div className='relay-user-detail__access-editor'>
        <div className='relay-user-detail__access-editor-copy'>
          <strong>平台用户组</strong>
          <span>{isCurrentUser ? '当前登录账号不能修改自己的用户组' : '用户能力与配额由所属用户组和继承链计算'}</span>
        </div>
        <div className='relay-user-detail__access-editor-control'>
          <Select
            className='relay-user-detail__access-select'
            disabled={disabled || isCurrentUser}
            mode='multiple'
            optionFilterProp='label'
            options={accessGroupOptions(accessGroups, 'platform')}
            value={selectedGroupIds}
            onChange={setSelectedGroupIds}
          />
          <Button disabled={!canSave} type='primary' onClick={() => void onSetAccessGroups(user, selectedGroupIds)}>
            保存用户组
          </Button>
        </div>
      </div>

      <div className='relay-user-detail__access-section'>
        <h3>继承来源</h3>
        <div className='relay-user-detail__access-badges'>
          {user.effectiveAccess.sources.length === 0
            ? <span className='relay-user-detail__profiles-empty'>无继承来源</span>
            : user.effectiveAccess.sources.map(source => (
              <StatusBadge key={`${source.inheritedFromGroupId ?? source.groupId}:${source.groupId}`} tone='muted'>
                {source.inheritedFromGroupId == null
                  ? source.groupName
                  : `${source.groupName} ← ${accessGroupName(accessGroups, source.inheritedFromGroupId)}`}
              </StatusBadge>
            ))}
        </div>
      </div>

      <div className='relay-user-detail__access-section'>
        <h3>配额</h3>
        <div className='relay-user-detail__quota-list'>
          {quotas.length === 0
            ? <span className='relay-user-detail__profiles-empty'>未设置配额</span>
            : quotas.map(quota => (
              <span key={quota.key} className='relay-user-detail__quota-item'>
                <span>{quota.label}</span>
                <strong>{quota.value}</strong>
              </span>
            ))}
        </div>
      </div>

      <div className='relay-user-detail__access-section'>
        <h3>有效能力</h3>
        <div className='relay-user-detail__capability-list'>
          {user.effectiveAccess.capabilities.map(capability => (
            <StatusBadge key={capability} tone='success'>
              {capabilityLabel(capability)}
            </StatusBadge>
          ))}
        </div>
      </div>

      {user.effectiveAccess.deniedCapabilities.length === 0 ? null : (
        <div className='relay-user-detail__access-section'>
          <h3>拒绝能力</h3>
          <div className='relay-user-detail__capability-list'>
            {user.effectiveAccess.deniedCapabilities.map(capability => (
              <StatusBadge key={capability} tone='danger'>
                {capabilityLabel(capability)}
              </StatusBadge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
