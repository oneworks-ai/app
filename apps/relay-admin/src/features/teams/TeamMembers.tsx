/* eslint-disable max-lines -- member table keeps filters, add form, role, and config toggles together. */
import { Avatar, Button, Drawer, Form, Input, Popconfirm, Select, Space, Switch } from 'antd'
import type { TableColumnsType } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { useTeamDetailTabActions } from './TeamDetailTabActions'
import type {
  CreateTeamInvitationInput,
  RelayAdminTeam,
  RelayAdminTeamMember,
  RelayAdminTeamMemberRole,
  UpdateTeamMemberInput
} from './teamTypes'
import {
  createRelayAdminTeamInvitation,
  deleteRelayAdminTeamMember,
  fetchRelayAdminTeamMembers,
  updateRelayAdminTeamMember
} from './teamsApi'

export interface TeamMembersProps {
  disabled: boolean
  team?: RelayAdminTeam
  token: string
}

interface TeamMemberFormValues {
  configEnabled: boolean
  defaultForPublishing: boolean
  email?: string
  role: RelayAdminTeamMemberRole
  userId?: string
}

const roleOptions: Array<{ label: string; value: RelayAdminTeamMemberRole }> = [
  { label: 'owner', value: 'owner' },
  { label: 'admin', value: 'admin' },
  { label: 'editor', value: 'editor' },
  { label: 'member', value: 'member' },
  { label: 'viewer', value: 'viewer' }
]

const cleanText = (value: string | undefined) => value?.trim() ?? ''

const memberAvatarFallback = (member: RelayAdminTeamMember) => (
  (member.name ?? member.email ?? member.userId).trim().slice(0, 1).toUpperCase()
)

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const TeamMemberInviteForm = ({
  disabled,
  onInviteMember,
  onInvited,
  team
}: {
  disabled: boolean
  team: RelayAdminTeam
  onInviteMember: (input: CreateTeamInvitationInput) => Promise<void>
  onInvited: () => void
}) => {
  const [form] = Form.useForm<TeamMemberFormValues>()

  const handleInvite = async (values: TeamMemberFormValues) => {
    const email = cleanText(values.email)
    const userId = cleanText(values.userId)
    if (email === '' && userId === '') return
    await onInviteMember({
      configEnabled: values.configEnabled,
      defaultForPublishing: values.defaultForPublishing,
      email,
      role: values.role,
      teamId: team.id,
      userId
    })
    form.resetFields()
    onInvited()
  }

  return (
    <Form
      form={form}
      initialValues={{ configEnabled: true, defaultForPublishing: false, role: 'member' }}
      layout='vertical'
      onFinish={handleInvite}
    >
      <Form.Item label='用户邮箱' name='email'>
        <Input disabled={disabled} placeholder='member@example.com' />
      </Form.Item>
      <Form.Item label='用户 ID' name='userId'>
        <Input disabled={disabled} />
      </Form.Item>
      <Form.Item label='团队角色' name='role' rules={[{ required: true }]}>
        <Select disabled={disabled} options={roleOptions} />
      </Form.Item>
      <Form.Item label='启用团队配置' name='configEnabled' valuePropName='checked'>
        <Switch disabled={disabled} />
      </Form.Item>
      <Form.Item label='默认发布团队' name='defaultForPublishing' valuePropName='checked'>
        <Switch disabled={disabled} />
      </Form.Item>
      <Button block disabled={disabled} htmlType='submit' type='primary'>
        发送邀请
      </Button>
    </Form>
  )
}

export const TeamMembers = ({ disabled, team, token }: TeamMembersProps) => {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [members, setMembers] = useState<RelayAdminTeamMember[]>([])
  const [notice, setNotice] = useState<string | undefined>()
  const [revision, setRevision] = useState(0)
  const [roleFilter, setRoleFilter] = useState<RelayAdminTeamMemberRole | 'all'>('all')
  const [searchValue, setSearchValue] = useState('')
  const [selectedMemberKeys, setSelectedMemberKeys] = useState<Key[]>([])
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(['identity', 'role', 'config', 'createdAt'])
  const refreshMembers = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    let active = true
    if (team == null || token.trim() === '') {
      setMembers([])
      setError(undefined)
      return
    }
    setLoading(true)
    setError(undefined)
    void fetchRelayAdminTeamMembers(token, team.id)
      .then(body => {
        if (!active) return
        setMembers(body.members)
      })
      .catch(reason => {
        if (!active) return
        setMembers([])
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [revision, team, token])

  const filteredMembers = useMemo(() => {
    const search = searchValue.trim().toLowerCase()
    return members.filter(member => {
      const values = [member.email ?? '', member.name ?? '', member.role, member.userId]
      return (
        (roleFilter === 'all' || member.role === roleFilter) &&
        (search === '' || values.some(value => value.toLowerCase().includes(search)))
      )
    })
  }, [members, roleFilter, searchValue])
  const selectedMembers = useMemo(
    () => members.filter(member => selectedMemberKeys.includes(member.userId)),
    [members, selectedMemberKeys]
  )

  const inviteMember = async (input: CreateTeamInvitationInput) => {
    const body = await createRelayAdminTeamInvitation(token, input)
    const target = body.invitation.email ?? body.invitation.userId ?? '该用户'
    setNotice(`已向 ${target} 发送团队邀请，接受后才会出现在成员列表。`)
  }

  const updateMember = async (member: RelayAdminTeamMember, input: UpdateTeamMemberInput) => {
    await updateRelayAdminTeamMember(token, member, input)
    refreshMembers()
  }

  const deleteMember = async (member: RelayAdminTeamMember) => {
    await deleteRelayAdminTeamMember(token, member)
    refreshMembers()
  }

  const columns: TableColumnsType<RelayAdminTeamMember> = [
    {
      dataIndex: 'email',
      key: 'identity',
      render: (_, member) => (
        <span className='relay-team-panel__member-identity'>
          <Avatar
            className='relay-team-panel__member-avatar'
            size={30}
            src={member.avatarUrl ?? undefined}
          >
            {memberAvatarFallback(member)}
          </Avatar>
          <span className='relay-team-panel__member-identity-copy'>
            <strong>{member.name ?? member.email ?? member.userId}</strong>
            <span className='relay-team-panel__member-email'>{member.email ?? '未设置邮箱'}</span>
            <span className='relay-team-panel__member-id'>ID {member.userId}</span>
          </span>
        </span>
      ),
      title: '成员',
      width: 300
    },
    {
      dataIndex: 'role',
      key: 'role',
      render: (_, member) => (
        <Select
          aria-label={`团队角色 ${member.email ?? member.userId}`}
          disabled={disabled}
          options={roleOptions}
          size='small'
          value={member.role}
          onChange={role => void updateMember(member, { role })}
        />
      ),
      title: (
        <AdminColumnFilter<RelayAdminTeamMemberRole | 'all'>
          allValue='all'
          ariaLabel='按团队角色过滤'
          label='角色'
          options={[{ label: '全部角色', value: 'all' }, ...roleOptions]}
          value={roleFilter}
          onChange={setRoleFilter}
        />
      ),
      width: 130
    },
    {
      key: 'config',
      render: (_, member) => (
        <Space size={4}>
          <StatusBadge tone={member.configEnabled ? 'success' : 'warning'}>
            {member.configEnabled ? 'config on' : 'config off'}
          </StatusBadge>
          {member.defaultForPublishing ? <StatusBadge tone='muted'>default</StatusBadge> : null}
        </Space>
      ),
      title: '配置',
      width: 180
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: value => formatTimestamp(value),
      title: '加入时间',
      width: 170
    },
    {
      align: 'right',
      fixed: 'right',
      key: 'actions',
      render: (_, member) => (
        <Space size={4}>
          <AdminActionButton
            aria-label={member.configEnabled ? '禁用团队配置' : '启用团队配置'}
            disabled={disabled}
            iconName={member.configEnabled ? 'disabled_by_default' : 'check'}
            size='small'
            title={member.configEnabled ? '禁用团队配置' : '启用团队配置'}
            type='text'
            onClick={() => void updateMember(member, { configEnabled: !member.configEnabled })}
          />
          <AdminActionButton
            aria-label={member.defaultForPublishing ? '取消默认发布团队' : '设为默认发布团队'}
            disabled={disabled}
            iconName='fact_check'
            size='small'
            title={member.defaultForPublishing ? '取消默认发布团队' : '设为默认发布团队'}
            type='text'
            onClick={() => void updateMember(member, { defaultForPublishing: !member.defaultForPublishing })}
          />
          <Popconfirm
            disabled={disabled}
            okText='移除'
            title='移除这个团队成员？'
            onConfirm={() => void deleteMember(member)}
          >
            <AdminActionButton
              aria-label='移除成员'
              danger
              disabled={disabled}
              iconName='delete'
              size='small'
              title='移除成员'
              type='text'
            />
          </Popconfirm>
        </Space>
      ),
      title: '操作',
      width: 128
    }
  ]
  const columnOptions: AdminListColumnOption[] = [
    { key: 'identity', label: '成员', required: true },
    { key: 'role', label: '角色' },
    { key: 'config', label: '配置' },
    { key: 'createdAt', label: '加入时间' }
  ]
  const batchActions = (
    <Space size={4}>
      <AdminActionButton
        aria-label='批量启用团队配置'
        disabled={disabled || selectedMembers.length === 0}
        iconName='check'
        size='small'
        title='批量启用团队配置'
        type='text'
        onClick={() => void Promise.all(selectedMembers.map(member => updateMember(member, { configEnabled: true })))}
      />
      <AdminActionButton
        aria-label='批量禁用团队配置'
        disabled={disabled || selectedMembers.length === 0}
        iconName='disabled_by_default'
        size='small'
        title='批量禁用团队配置'
        type='text'
        onClick={() => void Promise.all(selectedMembers.map(member => updateMember(member, { configEnabled: false })))}
      />
    </Space>
  )
  const tabActions = useMemo(() =>
    team == null
      ? undefined
      : (
        <Space size={4}>
          <AdminActionButton
            aria-label='邀请成员'
            disabled={disabled}
            iconName='add'
            onClick={() => setDrawerOpen(true)}
            size='small'
            title='邀请成员'
            type='primary'
          />
          <AdminActionButton
            aria-label='刷新成员'
            disabled={disabled || loading}
            iconName='refresh'
            onClick={refreshMembers}
            size='small'
            title='刷新成员'
          />
        </Space>
      ), [disabled, loading, refreshMembers, team])

  useTeamDetailTabActions('members', tabActions)

  if (team == null) return null

  return (
    <div className='relay-team-panel__members'>
      {error == null ? null : <p className='relay-team-panel__error'>{error}</p>}
      {notice == null ? null : <p className='relay-team-panel__notice'>{notice}</p>}
      <AdminListTable<RelayAdminTeamMember>
        ariaLabel='团队成员列表'
        batchActions={batchActions}
        className='relay-team-panel__member-table'
        columnOptions={columnOptions}
        columns={columns}
        dataSource={filteredMembers}
        emptyText={loading ? '正在加载成员' : '暂无成员'}
        rowKey='userId'
        searchPlaceholder='搜索成员、邮箱、用户 ID'
        searchValue={searchValue}
        selectedRowKeys={selectedMemberKeys}
        visibleColumnKeys={visibleColumnKeys}
        onSearchChange={setSearchValue}
        onSelectedRowKeysChange={setSelectedMemberKeys}
        onVisibleColumnKeysChange={setVisibleColumnKeys}
      />
      <Drawer
        destroyOnHidden
        open={drawerOpen}
        title={`邀请成员 · ${team.name}`}
        width={460}
        onClose={() => setDrawerOpen(false)}
      >
        <TeamMemberInviteForm
          disabled={disabled}
          team={team}
          onInviteMember={inviteMember}
          onInvited={() => setDrawerOpen(false)}
        />
      </Drawer>
    </div>
  )
}
