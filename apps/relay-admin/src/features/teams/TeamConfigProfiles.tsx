/* eslint-disable max-lines -- profile management keeps list, selected detail, and drawers in one local workflow. */
import { Descriptions, Drawer, Empty, Space, Table } from 'antd'
import type { DescriptionsProps, TableColumnsType } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { TeamConfigAssignmentForm } from './TeamConfigAssignmentForm'
import { TeamProfileCreateForm, TeamProfileVersionForm } from './TeamConfigProfileForms'
import { useTeamDetailTabActions } from './TeamDetailTabActions'
import type {
  CreateConfigProfileAssignmentInput,
  CreateConfigProfileInput,
  CreateConfigProfileVersionInput,
  RelayAdminConfigProfile,
  RelayAdminConfigProfileAssignment,
  RelayAdminConfigProfileVersion,
  RelayAdminTeam
} from './teamTypes'
import {
  createRelayAdminConfigProfile,
  createRelayAdminConfigProfileAssignment,
  createRelayAdminConfigProfileVersion,
  fetchRelayAdminConfigProfile,
  fetchRelayAdminTeamConfigProfiles,
  publishRelayAdminConfigProfile,
  updateRelayAdminConfigProfileAssignment
} from './teamsApi'

export interface TeamConfigProfilesProps {
  disabled: boolean
  team?: RelayAdminTeam
  token: string
}

interface ProfileDetail {
  assignments: RelayAdminConfigProfileAssignment[]
  profile: RelayAdminConfigProfile
  versions: RelayAdminConfigProfileVersion[]
}

const profileTone = (status: RelayAdminConfigProfile['status']) => {
  if (status === 'published') return 'success'
  if (status === 'disabled') return 'warning'
  return 'muted'
}

const formatJson = (value: unknown) => JSON.stringify(value, null, 2)

export const TeamConfigProfiles = ({ disabled, team, token }: TeamConfigProfilesProps) => {
  const [assignmentDrawerOpen, setAssignmentDrawerOpen] = useState(false)
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [profileDetails, setProfileDetails] = useState<ProfileDetail[]>([])
  const [profiles, setProfiles] = useState<RelayAdminConfigProfile[]>([])
  const [revision, setRevision] = useState(0)
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>()
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)
  const selectedDetail = profileDetails.find(detail => detail.profile.id === selectedProfileId)
  const selectedProfile = selectedDetail?.profile ?? profiles.find(profile => profile.id === selectedProfileId)
  const versionOptions = useMemo(
    () =>
      selectedDetail?.versions.map(version => ({
        label: `v${version.version} · ${version.id}`,
        value: version.id
      })) ?? [],
    [selectedDetail]
  )

  const refreshProfiles = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    let active = true
    if (team == null || token.trim() === '') {
      setProfiles([])
      setProfileDetails([])
      setSelectedProfileId(undefined)
      setError(undefined)
      return
    }
    setLoading(true)
    setError(undefined)
    void fetchRelayAdminTeamConfigProfiles(token, team.id)
      .then(async body => {
        const details = await Promise.all(body.profiles.map(profile => fetchRelayAdminConfigProfile(token, profile.id)))
        if (!active) return
        setProfiles(body.profiles)
        setProfileDetails(details)
        setSelectedProfileId(current =>
          current == null || !body.profiles.some(profile => profile.id === current)
            ? body.profiles[0]?.id
            : current
        )
      })
      .catch(reason => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setProfiles([])
        setProfileDetails([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [revision, team, token])

  const createProfile = async (input: CreateConfigProfileInput) => {
    const body = await createRelayAdminConfigProfile(token, input)
    setSelectedProfileId(body.profile.id)
    refreshProfiles()
  }

  const createVersion = async (input: CreateConfigProfileVersionInput) => {
    if (selectedProfile == null) return
    await createRelayAdminConfigProfileVersion(token, selectedProfile.id, input)
    refreshProfiles()
  }

  const publishLatest = async (profile: RelayAdminConfigProfile) => {
    const detail = profileDetails.find(item => item.profile.id === profile.id)
    const latest = detail?.versions.at(-1)
    await publishRelayAdminConfigProfile(token, profile.id, latest?.id)
    refreshProfiles()
  }

  const createAssignment = async (input: CreateConfigProfileAssignmentInput) => {
    if (selectedProfile == null) return
    await createRelayAdminConfigProfileAssignment(token, selectedProfile.id, input)
    refreshProfiles()
  }

  const setAssignmentEnabled = async (assignment: RelayAdminConfigProfileAssignment, enabled: boolean) => {
    await updateRelayAdminConfigProfileAssignment(token, assignment, { enabled })
    refreshProfiles()
  }

  const columns: TableColumnsType<RelayAdminConfigProfile> = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (_, profile) => (
        <button
          className={[
            'relay-team-panel__profile-button',
            profile.id === selectedProfileId ? 'is-active' : ''
          ].filter(Boolean).join(' ')}
          type='button'
          onClick={() => setSelectedProfileId(profile.id)}
        >
          {profile.name}
        </button>
      ),
      title: '配置方案',
      width: 220
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: value => <StatusBadge tone={profileTone(value)}>{value}</StatusBadge>,
      title: '状态',
      width: 120
    },
    {
      dataIndex: 'versionCount',
      key: 'versionCount',
      title: '版本',
      width: 88
    },
    {
      dataIndex: 'assignmentCount',
      key: 'assignmentCount',
      title: '分配',
      width: 88
    },
    {
      align: 'right',
      fixed: 'right',
      key: 'actions',
      render: (_, profile) => (
        <Space size={4}>
          <AdminActionButton
            aria-label='创建版本'
            disabled={disabled}
            iconName='add'
            size='small'
            title='创建版本'
            type='text'
            onClick={() => {
              setSelectedProfileId(profile.id)
              setVersionDrawerOpen(true)
            }}
          />
          <AdminActionButton
            aria-label='发布最新版本'
            disabled={disabled ||
              (profileDetails.find(item => item.profile.id === profile.id)?.versions.length ?? 0) === 0}
            iconName='check'
            size='small'
            title='发布最新版本'
            type='text'
            onClick={() => void publishLatest(profile)}
          />
          <AdminActionButton
            aria-label='创建分配'
            disabled={disabled || profile.status !== 'published'}
            iconName='fact_check'
            size='small'
            title='创建分配'
            type='text'
            onClick={() => {
              setSelectedProfileId(profile.id)
              setAssignmentDrawerOpen(true)
            }}
          />
        </Space>
      ),
      title: '操作',
      width: 128
    }
  ]
  const assignmentColumns: TableColumnsType<RelayAdminConfigProfileAssignment> = [
    {
      dataIndex: 'enabled',
      key: 'enabled',
      render: value =>
        value
          ? <StatusBadge tone='success'>enabled</StatusBadge>
          : <StatusBadge tone='warning'>disabled</StatusBadge>,
      title: '状态',
      width: 110
    },
    {
      dataIndex: 'mode',
      key: 'mode',
      title: '模式',
      width: 100
    },
    {
      dataIndex: 'priority',
      key: 'priority',
      title: '优先级',
      width: 100
    },
    {
      dataIndex: 'target',
      key: 'target',
      render: value => <pre className='relay-team-panel__json-inline'>{formatJson(value ?? {})}</pre>,
      title: '目标',
      width: 220
    },
    {
      dataIndex: 'project',
      key: 'project',
      render: value => <pre className='relay-team-panel__json-inline'>{formatJson(value ?? {})}</pre>,
      title: '项目',
      width: 220
    },
    {
      align: 'right',
      fixed: 'right',
      key: 'actions',
      render: (_, assignment) => (
        <AdminActionButton
          aria-label={assignment.enabled ? '禁用' : '启用'}
          disabled={disabled}
          iconName={assignment.enabled ? 'disabled_by_default' : 'check'}
          size='small'
          title={assignment.enabled ? '禁用' : '启用'}
          type='text'
          onClick={() => void setAssignmentEnabled(assignment, !assignment.enabled)}
        />
      ),
      title: '操作',
      width: 72
    }
  ]
  const selectedDescriptionItems: DescriptionsProps['items'] = [
    { children: selectedProfile?.id ?? '-', key: 'id', label: '配置方案 ID' },
    { children: selectedProfile?.activeVersionId ?? '-', key: 'activeVersionId', label: '当前版本' },
    { children: selectedDetail?.versions.length ?? 0, key: 'versions', label: '版本数' },
    { children: selectedDetail?.assignments.length ?? 0, key: 'assignments', label: '分配数' }
  ]
  const tabActions = useMemo(() =>
    team == null
      ? undefined
      : (
        <Space size={4}>
          <AdminActionButton
            aria-label='创建配置方案'
            disabled={disabled}
            iconName='add'
            onClick={() => setCreateDrawerOpen(true)}
            size='small'
            title='创建配置方案'
            type='primary'
          />
        </Space>
      ), [disabled, team])

  useTeamDetailTabActions('profiles', tabActions)

  if (team == null) {
    return <Empty description='请选择团队' />
  }

  return (
    <div className='relay-team-panel__profiles'>
      {error == null ? null : <p className='relay-team-panel__error'>{error}</p>}
      <Table<RelayAdminConfigProfile>
        className='relay-admin-table relay-team-panel__profile-table'
        columns={columns}
        dataSource={profiles}
        loading={loading}
        locale={{ emptyText: '暂无配置方案' }}
        pagination={false}
        rowKey='id'
        scroll={{ x: 'max-content' }}
        size='middle'
      />

      {selectedProfile == null ? null : (
        <div className='relay-team-panel__profile-detail'>
          <Descriptions
            bordered
            column={{ lg: 2, md: 1, sm: 1, xl: 4, xs: 1, xxl: 4 }}
            items={selectedDescriptionItems}
            size='small'
          />
          <Table<RelayAdminConfigProfileAssignment>
            className='relay-admin-table relay-team-panel__assignment-table'
            columns={assignmentColumns}
            dataSource={selectedDetail?.assignments ?? []}
            locale={{ emptyText: '暂无分配' }}
            pagination={false}
            rowKey='id'
            scroll={{ x: 'max-content' }}
            size='middle'
          />
        </div>
      )}

      <Drawer
        destroyOnHidden
        open={createDrawerOpen}
        title='新建配置方案'
        width={460}
        onClose={() => setCreateDrawerOpen(false)}
      >
        <TeamProfileCreateForm
          disabled={disabled}
          teamId={team.id}
          onCreateProfile={createProfile}
          onCreated={() => setCreateDrawerOpen(false)}
        />
      </Drawer>
      <Drawer
        destroyOnHidden
        open={versionDrawerOpen}
        title={selectedProfile == null ? '创建版本' : `创建版本 · ${selectedProfile.name}`}
        width={560}
        onClose={() => setVersionDrawerOpen(false)}
      >
        <TeamProfileVersionForm
          disabled={disabled || selectedProfile == null}
          onCreateVersion={createVersion}
          onCreated={() => setVersionDrawerOpen(false)}
        />
      </Drawer>
      <Drawer
        destroyOnHidden
        open={assignmentDrawerOpen}
        title={selectedProfile == null ? '创建分配' : `创建分配 · ${selectedProfile.name}`}
        width={560}
        onClose={() => setAssignmentDrawerOpen(false)}
      >
        <TeamConfigAssignmentForm
          disabled={disabled || selectedProfile == null}
          team={team}
          versionOptions={versionOptions}
          onCreateAssignment={createAssignment}
          onCreated={() => setAssignmentDrawerOpen(false)}
        />
      </Drawer>
    </div>
  )
}
