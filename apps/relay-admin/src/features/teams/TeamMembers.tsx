/* eslint-disable max-lines -- member table keeps filters, add form, role, and config toggles together. */
import { Button, Drawer, Form, Input, Popconfirm, Select, Space, Switch } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type {
  CreateTeamMemberInput,
  RelayAdminTeam,
  RelayAdminTeamMember,
  RelayAdminTeamMemberRole,
  UpdateTeamMemberInput
} from './teamTypes'
import {
  createRelayAdminTeamMember,
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

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const TeamMemberCreateForm = ({
  disabled,
  onCreateMember,
  onCreated,
  team
}: {
  disabled: boolean
  team: RelayAdminTeam
  onCreateMember: (input: CreateTeamMemberInput) => Promise<void>
  onCreated: () => void
}) => {
  const [form] = Form.useForm<TeamMemberFormValues>()

  const handleCreate = async (values: TeamMemberFormValues) => {
    const email = cleanText(values.email)
    const userId = cleanText(values.userId)
    if (email === '' && userId === '') return
    await onCreateMember({
      configEnabled: values.configEnabled,
      defaultForPublishing: values.defaultForPublishing,
      email,
      role: values.role,
      teamId: team.id,
      userId
    })
    form.resetFields()
    onCreated()
  }

  return (
    <Form
      form={form}
      initialValues={{ configEnabled: true, defaultForPublishing: false, role: 'member' }}
      layout='vertical'
      onFinish={handleCreate}
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
        添加成员
      </Button>
    </Form>
  )
}

export const TeamMembers = ({ disabled, team, token }: TeamMembersProps) => {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [members, setMembers] = useState<RelayAdminTeamMember[]>([])
  const [revision, setRevision] = useState(0)
  const [roleFilter, setRoleFilter] = useState<RelayAdminTeamMemberRole | 'all'>('all')
  const [searchValue, setSearchValue] = useState('')
  const [selectedMemberKeys, setSelectedMemberKeys] = useState<Key[]>([])
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(['identity', 'role', 'config', 'createdAt'])
  const refreshMembers = () => setRevision(value => value + 1)

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

  const createMember = async (input: CreateTeamMemberInput) => {
    await createRelayAdminTeamMember(token, input)
    refreshMembers()
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
          <strong>{member.name ?? member.email ?? member.userId}</strong>
          <span>{member.email ?? member.userId}</span>
        </span>
      ),
      title: '成员',
      width: 220
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

  if (team == null) return null

  return (
    <div className='relay-team-panel__members'>
      <div className='relay-team-panel__tab-actions'>
        <Space size={4}>
          <AdminActionButton
            disabled={disabled}
            iconName='add'
            onClick={() => setDrawerOpen(true)}
            size='small'
            type='primary'
          >
            成员
          </AdminActionButton>
          <AdminActionButton
            aria-label='刷新成员'
            disabled={disabled || loading}
            iconName='refresh'
            onClick={refreshMembers}
            size='small'
            title='刷新成员'
          />
        </Space>
      </div>
      {error == null ? null : <p className='relay-team-panel__error'>{error}</p>}
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
        title={`添加成员 · ${team.name}`}
        width={460}
        onClose={() => setDrawerOpen(false)}
      >
        <TeamMemberCreateForm
          disabled={disabled}
          team={team}
          onCreateMember={createMember}
          onCreated={() => setDrawerOpen(false)}
        />
      </Drawer>
    </div>
  )
}
