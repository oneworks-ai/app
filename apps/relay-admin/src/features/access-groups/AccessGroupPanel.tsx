/* eslint-disable max-lines -- access group management owns list, filters, and the compact edit form. */
import './AccessGroupPanel.css'

import { Button, Form, Input, InputNumber, Popconfirm, Select, Space, Switch } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import type {
  CreateAccessGroupInput,
  RelayAdminAccessGroup,
  RelayAdminAccessGroupScope,
  UpdateAccessGroupInput
} from '../../shared/model/adminTypes'
import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminListTable } from '../../shared/ui/AdminListTable'
import type { AdminListColumnOption } from '../../shared/ui/AdminListTable'
import { DataPanel } from '../../shared/ui/DataPanel'
import { StatusBadge } from '../../shared/ui/StatusBadge'

export interface AccessGroupPanelProps {
  disabled: boolean
  groups: RelayAdminAccessGroup[]
  onDeleteGroup: (group: RelayAdminAccessGroup) => Promise<void>
  getGroupPath?: (group: RelayAdminAccessGroup) => string
  onUpdateGroup: (input: UpdateAccessGroupInput) => Promise<void>
  panelId?: string
  scope: RelayAdminAccessGroupScope
  surface?: boolean
}

interface AccessGroupFormValues {
  allow?: string[]
  deny?: string[]
  description?: string
  descriptionEn?: string
  descriptionI18nEnabled?: boolean
  descriptionZhHans?: string
  maxDevices?: number | null
  maxMembersPerOwnedTeam?: number | null
  maxTeamsJoined?: number | null
  maxTeamsOwned?: number | null
  name: string
  parentGroupId?: string | null
  scope: RelayAdminAccessGroupScope
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

const capabilityOptions = Object.entries(capabilityLabels)
  .map(([value, label]) => ({ label, value }))
  .sort((left, right) => left.label.localeCompare(right.label))

const quotaValue = (value: number | null | undefined) => {
  if (value == null) return null
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null
}

const groupNameById = (groups: RelayAdminAccessGroup[], groupId: string | null | undefined) => (
  groups.find(group => group.id === groupId)?.name ?? groupId ?? '-'
)

const localeCandidates = () => {
  const locales = typeof navigator === 'undefined'
    ? []
    : navigator.languages.length > 0
    ? [...navigator.languages]
    : [navigator.language]
  return [
    ...locales,
    ...locales.map(locale => locale.split('-')[0]).filter(locale => locale !== ''),
    'zh-Hans',
    'zh',
    'en'
  ]
}

const localizedAccessGroupDescription = (group: RelayAdminAccessGroup) => {
  const descriptions = group.localizedDescriptions
  for (const locale of localeCandidates()) {
    const normalizedLocale = locale.toLowerCase()
    const matchingKey = Object.keys(descriptions).find(key => key.toLowerCase() === normalizedLocale)
    if (matchingKey != null) return descriptions[matchingKey]
    if (normalizedLocale === 'zh') {
      const zhHans = descriptions['zh-Hans'] ?? descriptions['zh-CN']
      if (zhHans != null) return zhHans
    }
  }
  return group.description
}

const capabilitySummary = (group: RelayAdminAccessGroup) => {
  const allowCount = group.capabilities.allow.length
  const denyCount = group.capabilities.deny.length
  if (allowCount === 0 && denyCount === 0) return '继承父组'
  if (denyCount === 0) return `${allowCount} 项允许`
  return `${allowCount} 项允许 · ${denyCount} 项拒绝`
}

const quotaSummary = (group: RelayAdminAccessGroup) => {
  const entries = Object.entries(group.quotas)
  if (entries.length === 0) return '未设置'
  return entries
    .map(([key, value]) => `${quotaLabels[key] ?? key}: ${value == null ? '不限' : value}`)
    .join(' · ')
}

const cleanText = (value: string | null | undefined) => value?.trim() ?? ''

const cleanLocalizedDescriptions = (values: AccessGroupFormValues) => {
  if (values.descriptionI18nEnabled !== true) return undefined
  const descriptions = {
    'zh-Hans': cleanText(values.descriptionZhHans),
    en: cleanText(values.descriptionEn)
  }
  return Object.fromEntries(Object.entries(descriptions).filter(([, description]) => description !== ''))
}

const ownerGroupIds = new Set(['platform:owner', 'team:owner'])

const isOwnerGroup = (group: RelayAdminAccessGroup) => ownerGroupIds.has(group.id)

const groupDeleteBlockReason = (group: RelayAdminAccessGroup, groupNoun: string) => {
  if (isOwnerGroup(group)) return `${groupNoun}所有者不能删除`
  if (group.builtIn) return `内置${groupNoun}不能删除`
  if (group.memberCount > 0) return `仍有成员使用，不能删除`
  return undefined
}

const FormRow = ({
  children,
  label,
  required,
  stacked
}: {
  children: ReactNode
  label: string
  required?: boolean
  stacked?: boolean
}) => (
  <div className={stacked === true ? 'relay-access-groups__form-row is-stacked' : 'relay-access-groups__form-row'}>
    <div className='relay-access-groups__form-label'>
      {required === true ? <span aria-hidden='true'>*</span> : null}
      {label}
    </div>
    <div className='relay-access-groups__form-control'>
      {children}
    </div>
  </div>
)

export const AccessGroupForm = ({
  disabled,
  groups,
  group,
  mode,
  onCancel,
  onCreateGroup,
  onUpdateGroup,
  scope
}: {
  disabled: boolean
  groups: RelayAdminAccessGroup[]
  group?: RelayAdminAccessGroup
  mode: 'create' | 'edit'
  onCancel: () => void
  onCreateGroup: (input: CreateAccessGroupInput) => Promise<void>
  onUpdateGroup: (input: UpdateAccessGroupInput) => Promise<void>
  scope: RelayAdminAccessGroupScope
}) => {
  const [form] = Form.useForm<AccessGroupFormValues>()
  const groupNoun = scope === 'team' ? '成员组' : '用户组'
  const isBuiltInGroup = group?.builtIn === true
  const descriptionI18nEnabled = Form.useWatch('descriptionI18nEnabled', form) === true
  const parentOptions = useMemo(
    () =>
      groups
        .filter(item => item.scope === scope && item.id !== group?.id && item.builtIn !== true)
        .map(item => ({ label: item.name, value: item.id })),
    [group?.id, groups, scope]
  )

  useEffect(() => {
    form.setFieldsValue({
      allow: group?.capabilities.allow ?? [],
      deny: group?.capabilities.deny ?? [],
      description: group?.description ?? '',
      descriptionEn: group?.localizedDescriptions.en ?? '',
      descriptionI18nEnabled: Object.keys(group?.localizedDescriptions ?? {}).length > 0,
      descriptionZhHans: group?.localizedDescriptions['zh-Hans'] ?? group?.localizedDescriptions['zh-CN'] ?? '',
      maxDevices: quotaValue(group?.quotas.maxDevices),
      maxMembersPerOwnedTeam: quotaValue(group?.quotas.maxMembersPerOwnedTeam),
      maxTeamsJoined: quotaValue(group?.quotas.maxTeamsJoined),
      maxTeamsOwned: quotaValue(group?.quotas.maxTeamsOwned),
      name: group?.name ?? '',
      parentGroupId: parentOptions.some(option => option.value === group?.parentGroupId) ? group?.parentGroupId : null,
      scope
    })
  }, [form, group, parentOptions, scope])

  const buildQuotas = (values: AccessGroupFormValues) => ({
    maxDevices: values.maxDevices ?? null,
    maxMembersPerOwnedTeam: values.maxMembersPerOwnedTeam ?? null,
    maxTeamsJoined: values.maxTeamsJoined ?? null,
    maxTeamsOwned: values.maxTeamsOwned ?? null
  })

  const handleSubmit = async (values: AccessGroupFormValues) => {
    const name = cleanText(values.name)
    if (name === '') return
    const localizedDescriptions = cleanLocalizedDescriptions(values)
    const input = {
      capabilities: {
        allow: values.allow ?? [],
        deny: values.deny ?? []
      },
      description: cleanText(values.description),
      name,
      parentGroupId: values.parentGroupId ?? null,
      quotas: buildQuotas(values)
    }
    if (mode === 'create') {
      await onCreateGroup({
        ...input,
        ...(localizedDescriptions == null ? {} : { localizedDescriptions }),
        scope
      })
      form.resetFields()
    } else if (group != null) {
      await onUpdateGroup({ ...input, id: group.id, localizedDescriptions: localizedDescriptions ?? null })
    }
    onCancel()
  }

  return (
    <Form
      className='relay-access-groups__form'
      form={form}
      onFinish={handleSubmit}
    >
      <Form.Item hidden name='scope'>
        <Input />
      </Form.Item>
      <section className='relay-access-groups__form-section'>
        <div className='relay-access-groups__form-section-title'>基础信息</div>
        <FormRow label={`父级${groupNoun}`}>
          <Form.Item className='relay-access-groups__inline-item' name='parentGroupId'>
            <Select
              allowClear
              disabled={disabled || isBuiltInGroup}
              options={parentOptions}
              placeholder='无继承'
            />
          </Form.Item>
        </FormRow>
        <FormRow label={`${groupNoun}名称`} required>
          <Form.Item
            className='relay-access-groups__inline-item'
            name='name'
            rules={[{ required: true, message: `请输入${groupNoun}名称` }]}
          >
            <Input disabled={disabled} />
          </Form.Item>
        </FormRow>
        <FormRow label='说明' stacked>
          <Form.Item className='relay-access-groups__inline-item' name='description'>
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} disabled={disabled} />
          </Form.Item>
        </FormRow>
        <FormRow label='多语言说明'>
          <Form.Item
            className='relay-access-groups__inline-item'
            name='descriptionI18nEnabled'
            valuePropName='checked'
          >
            <Switch disabled={disabled} />
          </Form.Item>
        </FormRow>
        {descriptionI18nEnabled
          ? (
            <div className='relay-access-groups__i18n-grid'>
              <FormRow label='简体中文' stacked>
                <Form.Item className='relay-access-groups__inline-item' name='descriptionZhHans'>
                  <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} disabled={disabled} />
                </Form.Item>
              </FormRow>
              <FormRow label='English' stacked>
                <Form.Item className='relay-access-groups__inline-item' name='descriptionEn'>
                  <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} disabled={disabled} />
                </Form.Item>
              </FormRow>
            </div>
          )
          : null}
      </section>
      <section className='relay-access-groups__form-section'>
        <div className='relay-access-groups__form-section-title'>能力</div>
        <div className='relay-access-groups__form-grid'>
          <FormRow label='允许能力' stacked>
            <Form.Item className='relay-access-groups__inline-item' name='allow'>
              <Select
                className='relay-access-groups__capability-select'
                disabled={disabled}
                mode='multiple'
                optionFilterProp='label'
                options={capabilityOptions}
                placeholder='继承父组或选择能力'
              />
            </Form.Item>
          </FormRow>
          <FormRow label='拒绝能力' stacked>
            <Form.Item className='relay-access-groups__inline-item' name='deny'>
              <Select
                className='relay-access-groups__capability-select'
                disabled={disabled}
                mode='multiple'
                optionFilterProp='label'
                options={capabilityOptions}
                placeholder='需要显式收回的能力'
              />
            </Form.Item>
          </FormRow>
        </div>
      </section>
      <section className='relay-access-groups__form-section'>
        <div className='relay-access-groups__form-section-title'>配额</div>
        <div className='relay-access-groups__quota-grid'>
          {Object.entries(quotaLabels).map(([key, label]) => (
            <Form.Item className='relay-access-groups__inline-item' key={key} label={label} name={key}>
              <InputNumber
                className='relay-access-groups__quota-input'
                controls={false}
                disabled={disabled}
                min={0}
                placeholder='不限'
              />
            </Form.Item>
          ))}
        </div>
      </section>
      <div className='relay-access-groups__form-actions'>
        <Button disabled={disabled} onClick={onCancel}>
          取消
        </Button>
        <Button disabled={disabled} htmlType='submit' type='primary'>
          {mode === 'create' ? `创建${groupNoun}` : `保存${groupNoun}`}
        </Button>
      </div>
    </Form>
  )
}

export const AccessGroupPanel = ({
  disabled,
  groups,
  onDeleteGroup,
  getGroupPath,
  onUpdateGroup,
  panelId = 'access-groups',
  scope,
  surface = true
}: AccessGroupPanelProps) => {
  const navigate = useNavigate()
  const [searchValue, setSearchValue] = useState('')
  const [builtInFilter, setBuiltInFilter] = useState<'all' | 'builtIn' | 'custom'>('all')
  const [visibleColumnKeys, setVisibleColumnKeys] = useState([
    'name',
    'status',
    'parent',
    'members'
  ])
  const groupNoun = scope === 'team' ? '成员组' : '用户组'
  const openGroup = (group: RelayAdminAccessGroup) => {
    if (getGroupPath == null) return
    void navigate(getGroupPath(group))
  }
  const filteredGroups = useMemo(() => {
    const search = searchValue.trim().toLowerCase()
    return groups.filter(group => {
      const parentName = groupNameById(groups, group.parentGroupId)
      const description = localizedAccessGroupDescription(group) ?? ''
      const searchable = [
        group.id,
        group.name,
        description,
        ...Object.values(group.localizedDescriptions),
        group.scope,
        group.disabled ? '禁用' : '启用',
        parentName,
        capabilitySummary(group),
        quotaSummary(group)
      ]
      return (
        group.scope === scope &&
        (builtInFilter === 'all' || (builtInFilter === 'builtIn' ? group.builtIn : !group.builtIn)) &&
        (search === '' || searchable.some(value => value.toLowerCase().includes(search)))
      )
    })
  }, [builtInFilter, groups, scope, searchValue])
  const columnOptions: AdminListColumnOption[] = [
    { key: 'name', label: groupNoun, required: true },
    { key: 'status', label: '状态' },
    { key: 'parent', label: '继承' },
    { key: 'capabilities', label: '能力' },
    { key: 'quotas', label: '配额' },
    { key: 'members', label: '成员数' }
  ]
  const columns: TableColumnsType<RelayAdminAccessGroup> = [
    {
      key: 'name',
      render: (_, group) => {
        const description = cleanText(localizedAccessGroupDescription(group))
        return (
          <button
            className='relay-access-groups__name'
            type='button'
            onClick={() => openGroup(group)}
          >
            <strong>{group.name}</strong>
            <small className={description === '' ? 'is-placeholder' : undefined}>
              {description === '' ? `暂无${groupNoun}说明` : description}
            </small>
          </button>
        )
      },
      title: groupNoun,
      width: 320
    },
    {
      key: 'status',
      render: (_, group) => (
        <StatusBadge tone={group.disabled ? 'warning' : 'success'}>
          {group.disabled ? '禁用' : '启用'}
        </StatusBadge>
      ),
      title: '状态',
      width: 88
    },
    {
      key: 'parent',
      render: (_, group) => (
        <span className='relay-access-groups__secondary'>
          {groupNameById(groups, group.parentGroupId)}
        </span>
      ),
      title: '继承',
      width: 108
    },
    {
      key: 'capabilities',
      render: (_, group) => capabilitySummary(group),
      title: '能力',
      width: 116
    },
    {
      key: 'quotas',
      render: (_, group) => (
        <span className='relay-access-groups__quota-summary'>
          {quotaSummary(group)}
        </span>
      ),
      title: '配额',
      width: 180
    },
    {
      align: 'right',
      dataIndex: 'memberCount',
      key: 'members',
      title: '成员数',
      width: 82
    },
    {
      align: 'right',
      fixed: 'right',
      key: 'actions',
      render: (_, group) => {
        const deleteBlockReason = groupDeleteBlockReason(group, groupNoun)
        const toggleDisabledReason = isOwnerGroup(group) ? `${groupNoun}所有者不能禁用` : undefined
        return (
          <Space size={4}>
            <AdminActionButton
              aria-label={`编辑${groupNoun}`}
              disabled={disabled}
              iconName='edit'
              size='small'
              title={`编辑${groupNoun}`}
              type='text'
              onClick={() => openGroup(group)}
            />
            <Popconfirm
              disabled={disabled || toggleDisabledReason != null}
              okText={group.disabled ? '启用' : '禁用'}
              title={`${group.disabled ? '启用' : '禁用'}这个${groupNoun}？`}
              onConfirm={() => void onUpdateGroup({ id: group.id, disabled: !group.disabled })}
            >
              <AdminActionButton
                aria-label={toggleDisabledReason ?? `${group.disabled ? '启用' : '禁用'}${groupNoun}`}
                disabled={disabled || toggleDisabledReason != null}
                iconName={group.disabled ? 'check' : 'disabled_by_default'}
                size='small'
                title={toggleDisabledReason ?? `${group.disabled ? '启用' : '禁用'}${groupNoun}`}
                type='text'
              />
            </Popconfirm>
            <Popconfirm
              disabled={disabled || deleteBlockReason != null}
              okText='删除'
              title={`删除这个${groupNoun}？`}
              onConfirm={() => void onDeleteGroup(group)}
            >
              <AdminActionButton
                aria-label={deleteBlockReason ?? `删除${groupNoun}`}
                danger
                disabled={disabled || deleteBlockReason != null}
                iconName='delete'
                size='small'
                title={deleteBlockReason ?? `删除${groupNoun}`}
                type='text'
              />
            </Popconfirm>
          </Space>
        )
      },
      title: (
        <AdminColumnFilter<'all' | 'builtIn' | 'custom'>
          allValue='all'
          ariaLabel='按内置状态过滤'
          label='操作'
          options={[
            { label: '全部', value: 'all' },
            { label: '内置', value: 'builtIn' },
            { label: '自定义', value: 'custom' }
          ]}
          value={builtInFilter}
          onChange={setBuiltInFilter}
        />
      ),
      width: 112
    }
  ]

  const content = (
    <>
      <div className='relay-access-groups'>
        <AdminListTable<RelayAdminAccessGroup>
          ariaLabel={`${groupNoun}列表`}
          className='relay-access-groups__table'
          columnOptions={columnOptions}
          columns={columns}
          dataSource={filteredGroups}
          emptyText={`暂无${groupNoun}`}
          rowKey='id'
          searchPlaceholder={`搜索${groupNoun}、能力、配额、父级`}
          searchValue={searchValue}
          visibleColumnKeys={visibleColumnKeys}
          onSearchChange={setSearchValue}
          onVisibleColumnKeysChange={setVisibleColumnKeys}
        />
      </div>
    </>
  )

  if (!surface) {
    return (
      <div className='relay-access-groups__embedded' id={panelId}>
        {content}
      </div>
    )
  }

  return (
    <DataPanel id={panelId}>
      {content}
    </DataPanel>
  )
}
