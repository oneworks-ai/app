/* eslint-disable max-lines -- team config profiles combine a routeable list, detail view, and admin drawers. */
import { Drawer, Empty, Space, Table } from 'antd'
import type { TableColumnsType } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
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
  activeProfileId?: string
  disabled: boolean
  team?: RelayAdminTeam
  token: string
  onProfileRouteChange?: (profileId?: string) => void
}

interface ProfileDetail {
  assignments: RelayAdminConfigProfileAssignment[]
  profile: RelayAdminConfigProfile
  versions: RelayAdminConfigProfileVersion[]
}

const profileColumnOptions: AdminListColumnOption[] = [
  { key: 'name', label: '名称', required: true },
  { key: 'status', label: '状态' },
  { key: 'versionCount', label: '版本' },
  { key: 'assignmentCount', label: '分配' },
  { key: 'updatedAt', label: '更新时间' }
]

const defaultVisibleColumnKeys = ['name', 'status', 'versionCount', 'assignmentCount', 'updatedAt']

const profileTone = (status: RelayAdminConfigProfile['status']) => {
  if (status === 'published') return 'success'
  if (status === 'disabled') return 'warning'
  return 'muted'
}

const profileStatusLabel = (status: RelayAdminConfigProfile['status']) => {
  if (status === 'published') return '已发布'
  if (status === 'disabled') return '已停用'
  return '草稿'
}

const formatJson = (value: unknown) => JSON.stringify(value, null, 2)

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const textMatches = (values: Array<string | number | null | undefined>, query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true
  return values.some(value => String(value ?? '').toLowerCase().includes(normalizedQuery))
}

const activeVersion = (detail: ProfileDetail | undefined) => {
  if (detail == null) return undefined
  return detail.versions.find(version => version.id === detail.profile.activeVersionId) ?? detail.versions.at(-1)
}

const createSummaryItem = (label: string, value: string | number, meta?: string) => (
  <div className='relay-team-panel__profile-summary-card' key={label}>
    <span>{label}</span>
    <strong>{value}</strong>
    {meta == null ? null : <small>{meta}</small>}
  </div>
)

export const TeamConfigProfiles = ({
  activeProfileId,
  disabled,
  team,
  token,
  onProfileRouteChange
}: TeamConfigProfilesProps) => {
  const [assignmentDrawerOpen, setAssignmentDrawerOpen] = useState(false)
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [profileDetails, setProfileDetails] = useState<ProfileDetail[]>([])
  const [profiles, setProfiles] = useState<RelayAdminConfigProfile[]>([])
  const [revision, setRevision] = useState(0)
  const [actionProfileId, setActionProfileId] = useState<string | undefined>()
  const [searchValue, setSearchValue] = useState('')
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(defaultVisibleColumnKeys)
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)
  const selectedDetail = profileDetails.find(detail => detail.profile.id === activeProfileId)
  const selectedProfile = selectedDetail?.profile ?? profiles.find(profile => profile.id === activeProfileId)
  const actionProfile = profiles.find(profile => profile.id === actionProfileId) ?? selectedProfile
  const actionDetail = profileDetails.find(detail => detail.profile.id === actionProfile?.id)
  const currentVersion = activeVersion(selectedDetail)
  const versionOptions = useMemo(
    () =>
      actionDetail?.versions.map(version => ({
        label: `v${version.version} · ${version.id}`,
        value: version.id
      })) ?? [],
    [actionDetail]
  )

  const refreshProfiles = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    let active = true
    if (team == null || token.trim() === '') {
      setProfiles([])
      setProfileDetails([])
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
    onProfileRouteChange?.(body.profile.id)
    refreshProfiles()
  }

  const createVersion = async (input: CreateConfigProfileVersionInput) => {
    if (actionProfile == null) return
    await createRelayAdminConfigProfileVersion(token, actionProfile.id, input)
    refreshProfiles()
  }

  const publishLatest = async (profile: RelayAdminConfigProfile) => {
    const detail = profileDetails.find(item => item.profile.id === profile.id)
    const latest = detail?.versions.at(-1)
    await publishRelayAdminConfigProfile(token, profile.id, latest?.id)
    refreshProfiles()
  }

  const createAssignment = async (input: CreateConfigProfileAssignmentInput) => {
    if (actionProfile == null) return
    await createRelayAdminConfigProfileAssignment(token, actionProfile.id, input)
    refreshProfiles()
  }

  const setAssignmentEnabled = async (assignment: RelayAdminConfigProfileAssignment, enabled: boolean) => {
    await updateRelayAdminConfigProfileAssignment(token, assignment, { enabled })
    refreshProfiles()
  }

  const filteredProfiles = useMemo(
    () =>
      profiles.filter(profile =>
        textMatches([
          profile.id,
          profile.name,
          profile.description,
          profile.status,
          profile.teamName,
          profile.activeVersionId,
          profile.versionCount,
          profile.assignmentCount
        ], searchValue)
      ),
    [profiles, searchValue]
  )

  const columns: TableColumnsType<RelayAdminConfigProfile> = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (_, profile) => (
        <button
          className='relay-team-panel__profile-link'
          type='button'
          onClick={() => onProfileRouteChange?.(profile.id)}
        >
          <span className='relay-team-panel__profile-link-title'>{profile.name}</span>
          <span className='relay-team-panel__profile-link-meta'>
            {profile.description == null || profile.description === '' ? profile.id : profile.description}
          </span>
        </button>
      ),
      sorter: (a, b) => a.name.localeCompare(b.name),
      title: '名称',
      width: 260
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: value => <StatusBadge tone={profileTone(value)}>{profileStatusLabel(value)}</StatusBadge>,
      sorter: (a, b) => a.status.localeCompare(b.status),
      title: '状态',
      width: 120
    },
    {
      dataIndex: 'versionCount',
      key: 'versionCount',
      sorter: (a, b) => a.versionCount - b.versionCount,
      title: '版本',
      width: 88
    },
    {
      dataIndex: 'assignmentCount',
      key: 'assignmentCount',
      sorter: (a, b) => a.assignmentCount - b.assignmentCount,
      title: '分配',
      width: 88
    },
    {
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: value => formatTimestamp(value),
      sorter: (a, b) => String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? '')),
      title: '更新时间',
      width: 160
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
              setActionProfileId(profile.id)
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
              setActionProfileId(profile.id)
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
          ? <StatusBadge tone='success'>启用</StatusBadge>
          : <StatusBadge tone='warning'>停用</StatusBadge>,
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

  const drawers = (
    <>
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
        title={actionProfile == null ? '创建版本' : `创建版本 · ${actionProfile.name}`}
        width={560}
        onClose={() => setVersionDrawerOpen(false)}
      >
        <TeamProfileVersionForm
          disabled={disabled || actionProfile == null}
          onCreateVersion={createVersion}
          onCreated={() => setVersionDrawerOpen(false)}
        />
      </Drawer>
      <Drawer
        destroyOnHidden
        open={assignmentDrawerOpen}
        title={actionProfile == null ? '创建分配' : `创建分配 · ${actionProfile.name}`}
        width={560}
        onClose={() => setAssignmentDrawerOpen(false)}
      >
        <TeamConfigAssignmentForm
          disabled={disabled || actionProfile == null}
          team={team}
          versionOptions={versionOptions}
          onCreateAssignment={createAssignment}
          onCreated={() => setAssignmentDrawerOpen(false)}
        />
      </Drawer>
    </>
  )

  if (activeProfileId != null) {
    return (
      <div className='relay-team-panel__profiles relay-team-panel__profiles--detail'>
        <div className='relay-team-panel__subroute-breadcrumb'>
          <button
            className='relay-team-panel__subroute-back'
            type='button'
            onClick={() => onProfileRouteChange?.(undefined)}
          >
            <AdminIcon name='chevron_left' />
            <span>配置列表</span>
          </button>
          <AdminIcon className='relay-team-panel__subroute-separator' name='chevron_right' />
          <span className='relay-team-panel__subroute-current'>
            {selectedProfile?.name ?? '配置详情'}
          </span>
        </div>
        {error == null ? null : <p className='relay-team-panel__error'>{error}</p>}
        {selectedProfile == null
          ? (
            <Empty
              className='relay-team-panel__profile-empty'
              description={loading ? '正在加载配置方案' : '配置不存在或已不在当前团队中'}
            />
          )
          : (
            <div className='relay-team-panel__profile-detail'>
              <div className='relay-team-panel__profile-detail-head'>
                <div>
                  <h3>{selectedProfile.name}</h3>
                  <p>
                    {selectedProfile.description == null || selectedProfile.description === ''
                      ? selectedProfile.id
                      : selectedProfile.description}
                  </p>
                </div>
                <Space size={4}>
                  <AdminActionButton
                    aria-label='创建版本'
                    disabled={disabled}
                    iconName='add'
                    size='small'
                    title='创建版本'
                    type='text'
                    onClick={() => {
                      setActionProfileId(selectedProfile.id)
                      setVersionDrawerOpen(true)
                    }}
                  />
                  <AdminActionButton
                    aria-label='发布最新版本'
                    disabled={disabled || (selectedDetail?.versions.length ?? 0) === 0}
                    iconName='check'
                    size='small'
                    title='发布最新版本'
                    type='text'
                    onClick={() => void publishLatest(selectedProfile)}
                  />
                  <AdminActionButton
                    aria-label='创建分配'
                    disabled={disabled || selectedProfile.status !== 'published'}
                    iconName='fact_check'
                    size='small'
                    title='创建分配'
                    type='text'
                    onClick={() => {
                      setActionProfileId(selectedProfile.id)
                      setAssignmentDrawerOpen(true)
                    }}
                  />
                </Space>
              </div>
              <div className='relay-team-panel__profile-summary'>
                {createSummaryItem('状态', profileStatusLabel(selectedProfile.status), selectedProfile.status)}
                {createSummaryItem('当前版本', selectedProfile.activeVersionId ?? '-', '服务端发布版本')}
                {createSummaryItem('版本', selectedDetail?.versions.length ?? selectedProfile.versionCount)}
                {createSummaryItem('分配', selectedDetail?.assignments.length ?? selectedProfile.assignmentCount)}
                {createSummaryItem('更新时间', formatTimestamp(selectedProfile.updatedAt))}
              </div>
              <section className='relay-team-panel__profile-section'>
                <div className='relay-team-panel__profile-section-head'>
                  <h4>版本内容</h4>
                  <span>{currentVersion == null ? '暂无版本' : `v${currentVersion.version}`}</span>
                </div>
                {currentVersion == null
                  ? <Empty description='暂无配置版本' />
                  : (
                    <pre className='relay-team-panel__json-block'>
                      {formatJson({
                        allowedFields: currentVersion.allowedFields,
                        configPatch: currentVersion.configPatch,
                        secretRefs: currentVersion.secretRefs,
                        sourceHash: currentVersion.sourceHash
                      })}
                    </pre>
                  )}
              </section>
              <section className='relay-team-panel__profile-section'>
                <div className='relay-team-panel__profile-section-head'>
                  <h4>分配规则</h4>
                  <span>{selectedDetail?.assignments.length ?? 0} 个</span>
                </div>
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
              </section>
            </div>
          )}
        {drawers}
      </div>
    )
  }

  return (
    <div className='relay-team-panel__profiles'>
      {error == null ? null : <p className='relay-team-panel__error'>{error}</p>}
      <AdminListTable<RelayAdminConfigProfile>
        ariaLabel='团队配置方案列表'
        className='relay-team-panel__profile-table'
        columnOptions={profileColumnOptions}
        columns={columns}
        dataSource={filteredProfiles}
        emptyText={loading ? '正在加载配置方案' : '暂无配置方案'}
        rowKey='id'
        searchPlaceholder='搜索配置名称、状态、版本'
        searchValue={searchValue}
        visibleColumnKeys={visibleColumnKeys}
        onSearchChange={setSearchValue}
        onVisibleColumnKeysChange={setVisibleColumnKeys}
      />
      {drawers}
    </div>
  )
}
