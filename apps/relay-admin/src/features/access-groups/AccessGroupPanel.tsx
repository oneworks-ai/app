/* eslint-disable max-lines -- access group management owns list, filters, and the compact edit form. */
import './AccessGroupPanel.css'

import { Button, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Tabs } from 'antd'
import type { FormInstance, TableColumnsType } from 'antd'
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
import { AdminIcon } from '../../shared/ui/AdminIcon'
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
  nameEn?: string
  nameZhHans?: string
  parentGroupId?: string | null
  scope: RelayAdminAccessGroupScope
}

type AccessGroupQuotaKey = 'maxDevices' | 'maxMembersPerOwnedTeam' | 'maxTeamsJoined' | 'maxTeamsOwned'
type AccessGroupLocale = 'zh-Hans' | 'en'

const quotaLabels: Record<AccessGroupQuotaKey, string> = {
  maxDevices: '设备上限',
  maxMembersPerOwnedTeam: '名下团队成员上限',
  maxTeamsJoined: '可加入团队数',
  maxTeamsOwned: '可创建团队数'
}

const supportedAccessGroupLocales: { label: string; value: AccessGroupLocale }[] = [
  { label: '简体中文', value: 'zh-Hans' },
  { label: 'English', value: 'en' }
]

const supportedAccessGroupLocaleValues = supportedAccessGroupLocales.map(locale => locale.value)

const nameFieldByLocale: Record<AccessGroupLocale, keyof AccessGroupFormValues> = {
  'zh-Hans': 'nameZhHans',
  en: 'nameEn'
}

const descriptionFieldByLocale: Record<AccessGroupLocale, keyof AccessGroupFormValues> = {
  'zh-Hans': 'descriptionZhHans',
  en: 'descriptionEn'
}

const capabilityCategories = [
  { key: 'all', label: '全部' },
  { key: 'platform', label: '平台管理' },
  { key: 'team', label: '团队协作' },
  { key: 'config', label: '配置分发' },
  { key: 'message', label: '消息' },
  { key: 'device', label: '设备' },
  { key: 'runtime', label: '任务会话' }
] as const

type CapabilityCategoryKey = (typeof capabilityCategories)[number]['key']

interface CapabilityDescriptor {
  category: Exclude<CapabilityCategoryKey, 'all'>
  label: string
  value: string
}

interface QuotaDescriptor {
  category: Exclude<CapabilityCategoryKey, 'all'>
  key: AccessGroupQuotaKey
  label: string
  value: string
}

type CapabilityMatrixEntry =
  | (CapabilityDescriptor & { type: 'capability' })
  | (QuotaDescriptor & { type: 'quota' })

const capabilityCatalog: CapabilityDescriptor[] = [
  { category: 'platform', label: '查看用户组', value: 'admin.accessGroups.read' },
  { category: 'platform', label: '管理用户组', value: 'admin.accessGroups.write' },
  { category: 'platform', label: '查看设备', value: 'admin.devices.read' },
  { category: 'platform', label: '管理设备', value: 'admin.devices.write' },
  { category: 'platform', label: '查看邀请码', value: 'admin.invites.read' },
  { category: 'platform', label: '管理邀请码', value: 'admin.invites.write' },
  { category: 'platform', label: '查看站点设置', value: 'admin.settings.read' },
  { category: 'platform', label: '管理站点设置', value: 'admin.settings.write' },
  { category: 'platform', label: '查看 SSO', value: 'admin.sso.read' },
  { category: 'platform', label: '管理 SSO', value: 'admin.sso.write' },
  { category: 'platform', label: '查看用户', value: 'admin.users.read' },
  { category: 'platform', label: '管理用户', value: 'admin.users.write' },
  { category: 'message', label: '查看消息', value: 'relay.messages.read' },
  { category: 'message', label: '发送消息', value: 'relay.messages.write' },
  { category: 'team', label: '查看团队审计', value: 'relay.teamAudit.read' },
  { category: 'config', label: '读取配置快照', value: 'relay.configSnapshot.read' },
  { category: 'config', label: '查看配置方案', value: 'relay.teamConfigProfiles.read' },
  { category: 'config', label: '管理配置方案', value: 'relay.teamConfigProfiles.write' },
  { category: 'config', label: '查看密钥', value: 'relay.teamConfigSecrets.read' },
  { category: 'config', label: '管理密钥', value: 'relay.teamConfigSecrets.write' },
  { category: 'team', label: '查看团队成员', value: 'relay.teamMembers.read' },
  { category: 'team', label: '管理团队成员', value: 'relay.teamMembers.write' },
  { category: 'team', label: '查看团队', value: 'relay.teams.read' },
  { category: 'team', label: '管理团队', value: 'relay.teams.write' },
  { category: 'device', label: '设备心跳', value: 'relay.devices.heartbeat' },
  { category: 'device', label: '查看本人设备', value: 'relay.devices.read' },
  { category: 'device', label: '查看全部设备', value: 'relay.devices.read.any' },
  { category: 'device', label: '注册设备', value: 'relay.devices.register' },
  { category: 'runtime', label: '查看本人任务', value: 'relay.jobs.read' },
  { category: 'runtime', label: '查看全部任务', value: 'relay.jobs.read.any' },
  { category: 'runtime', label: '查看本人任务结果', value: 'relay.jobs.result.read' },
  { category: 'runtime', label: '查看全部任务结果', value: 'relay.jobs.result.read.any' },
  { category: 'runtime', label: '写入本人任务状态', value: 'relay.jobs.status.write' },
  { category: 'runtime', label: '写入全部任务状态', value: 'relay.jobs.status.write.any' },
  { category: 'runtime', label: '查看本人会话', value: 'relay.sessions.read' },
  { category: 'runtime', label: '查看全部会话', value: 'relay.sessions.read.any' },
  { category: 'runtime', label: '写入本人会话快照', value: 'relay.sessions.snapshot.write' },
  { category: 'runtime', label: '写入全部会话快照', value: 'relay.sessions.snapshot.write.any' },
  { category: 'runtime', label: '提交本人会话', value: 'relay.sessions.submit' },
  { category: 'runtime', label: '提交全部会话', value: 'relay.sessions.submit.any' }
]

const quotaCatalog: QuotaDescriptor[] = [
  { category: 'device', key: 'maxDevices', label: quotaLabels.maxDevices, value: 'quota.maxDevices' },
  {
    category: 'team',
    key: 'maxMembersPerOwnedTeam',
    label: quotaLabels.maxMembersPerOwnedTeam,
    value: 'quota.maxMembersPerOwnedTeam'
  },
  { category: 'team', key: 'maxTeamsJoined', label: quotaLabels.maxTeamsJoined, value: 'quota.maxTeamsJoined' },
  { category: 'team', key: 'maxTeamsOwned', label: quotaLabels.maxTeamsOwned, value: 'quota.maxTeamsOwned' }
]

const capabilityMatrixCatalog: CapabilityMatrixEntry[] = [
  ...capabilityCatalog.map(capability => ({ ...capability, type: 'capability' as const })),
  ...quotaCatalog.map(quota => ({ ...quota, type: 'quota' as const }))
]

const teamCapabilityCategories = new Set<CapabilityCategoryKey>(['team', 'config', 'message'])

const capabilityMatrixCatalogForScope = (scope: RelayAdminAccessGroupScope) => (
  scope === 'platform'
    ? capabilityMatrixCatalog
    : capabilityMatrixCatalog.filter(item => (
      item.type === 'capability' && teamCapabilityCategories.has(item.category)
    ))
)

const capabilityCategoriesForScope = (scope: RelayAdminAccessGroupScope) => {
  const scopeCatalog = capabilityMatrixCatalogForScope(scope)
  return capabilityCategories.filter(category => (
    category.key === 'all' ||
    scopeCatalog.some(item => item.category === category.key)
  ))
}

const capabilityValuesForScope = (scope: RelayAdminAccessGroupScope) =>
  new Set(
    capabilityMatrixCatalogForScope(scope)
      .filter((item): item is CapabilityDescriptor & { type: 'capability' } => item.type === 'capability')
      .map(item => item.value)
  )

const capabilityOptions = capabilityCatalog
  .map(({ label, value }) => ({ label, value }))
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

const normalizeSupportedLocale = (locale: string): AccessGroupLocale | undefined => {
  const normalizedLocale = locale.toLowerCase()
  if (normalizedLocale === 'zh' || normalizedLocale === 'zh-cn' || normalizedLocale === 'zh-hans') return 'zh-Hans'
  if (normalizedLocale === 'en' || normalizedLocale.startsWith('en-')) return 'en'
  return undefined
}

const userPreferredAccessGroupLocale = () => (
  localeCandidates()
    .map(normalizeSupportedLocale)
    .find((locale): locale is AccessGroupLocale => locale != null) ?? 'zh-Hans'
)

const accessGroupLocaleLabel = (locale: AccessGroupLocale) => (
  supportedAccessGroupLocales.find(item => item.value === locale)?.label ?? locale
)

const orderedAccessGroupLocales = (locales: AccessGroupLocale[], defaultLocale: AccessGroupLocale) => (
  Array.from(new Set([defaultLocale, ...locales]))
)

const localizedTextForLocale = (
  textMap: Record<string, string> | undefined,
  locale: AccessGroupLocale
) => {
  if (textMap == null) return undefined
  if (locale === 'zh-Hans') return textMap['zh-Hans'] ?? textMap['zh-CN'] ?? textMap.zh
  return textMap[locale]
}

const preferredLocalizedText = (
  textMap: Record<string, string>,
  fallback: string | null | undefined
) => {
  for (const locale of localeCandidates()) {
    const normalizedLocale = locale.toLowerCase()
    const matchingKey = Object.keys(textMap).find(key => key.toLowerCase() === normalizedLocale)
    if (matchingKey != null) return textMap[matchingKey]
    if (normalizedLocale === 'zh') {
      const zhHans = textMap['zh-Hans'] ?? textMap['zh-CN']
      if (zhHans != null) return zhHans
    }
  }
  return fallback
}

const descriptionForLocale = (
  descriptions: Record<string, string> | undefined,
  locale: AccessGroupLocale
) => localizedTextForLocale(descriptions, locale)

const nameForLocale = (
  names: Record<string, string> | undefined,
  locale: AccessGroupLocale
) => localizedTextForLocale(names, locale)

const localizedAccessGroupName = (group: RelayAdminAccessGroup) => (
  preferredLocalizedText(group.localizedNames, group.name) ?? group.name
)

const localizedAccessGroupDescription = (group: RelayAdminAccessGroup) => (
  preferredLocalizedText(group.localizedDescriptions, group.description)
)

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
    .map(([key, value]) => `${quotaLabels[key as AccessGroupQuotaKey] ?? key}: ${value == null ? '不限' : value}`)
    .join(' · ')
}

const cleanText = (value: string | null | undefined) => value?.trim() ?? ''

const cleanLocalizedTextValues = (
  values: AccessGroupFormValues,
  locales: AccessGroupLocale[],
  defaultLocale: AccessGroupLocale,
  defaultField: keyof AccessGroupFormValues,
  fieldByLocale: Record<AccessGroupLocale, keyof AccessGroupFormValues>
) => {
  if (values.descriptionI18nEnabled !== true) return undefined
  const localizedValues = Object.fromEntries(
    locales.map(locale => [
      locale,
      locale === defaultLocale
        ? cleanText(values[defaultField] as string | undefined)
        : cleanText(values[fieldByLocale[locale]] as string | undefined)
    ])
  )
  return Object.fromEntries(Object.entries(localizedValues).filter(([, text]) => text !== ''))
}

const cleanLocalizedDescriptions = (
  values: AccessGroupFormValues,
  locales: AccessGroupLocale[],
  defaultLocale: AccessGroupLocale
) => cleanLocalizedTextValues(values, locales, defaultLocale, 'description', descriptionFieldByLocale)

const cleanLocalizedNames = (
  values: AccessGroupFormValues,
  locales: AccessGroupLocale[],
  defaultLocale: AccessGroupLocale
) => cleanLocalizedTextValues(values, locales, defaultLocale, 'name', nameFieldByLocale)

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

const capabilityCategoryLabel = (category: CapabilityCategoryKey) =>
  capabilityCategories.find(item => item.key === category)?.label ?? category

const nextCapabilityValues = (values: string[], permission: string, checked: boolean) => (
  checked ? Array.from(new Set([...values, permission])) : values.filter(value => value !== permission)
)

const capabilityMatrixCategoryCount = (category: CapabilityCategoryKey, scope: RelayAdminAccessGroupScope) => (
  category === 'all'
    ? capabilityMatrixCatalogForScope(scope).length
    : capabilityMatrixCatalogForScope(scope).filter(item => item.category === category).length
)

const CapabilityMatrixField = ({
  disabled,
  form,
  scope
}: {
  disabled: boolean
  form: FormInstance<AccessGroupFormValues>
  scope: RelayAdminAccessGroupScope
}) => {
  const [categoryFilter, setCategoryFilter] = useState<CapabilityCategoryKey>('all')
  const [searchValue, setSearchValue] = useState('')
  const allow = Form.useWatch('allow', form) ?? []
  const deny = Form.useWatch('deny', form) ?? []
  const scopeCategories = useMemo(() => capabilityCategoriesForScope(scope), [scope])
  const scopeCatalog = useMemo(() => capabilityMatrixCatalogForScope(scope), [scope])
  const normalizedSearch = searchValue.trim().toLowerCase()

  useEffect(() => {
    if (!scopeCategories.some(category => category.key === categoryFilter)) {
      setCategoryFilter('all')
    }
  }, [categoryFilter, scopeCategories])

  const filteredEntries = useMemo(
    () =>
      scopeCatalog.filter(item => {
        const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter
        const matchesSearch = normalizedSearch === '' || [
          item.label,
          item.value,
          capabilityCategoryLabel(item.category),
          item.type === 'quota' ? '配额' : '权限'
        ].some(value => value.toLowerCase().includes(normalizedSearch))
        return matchesCategory && matchesSearch
      }),
    [categoryFilter, normalizedSearch, scopeCatalog]
  )
  const setCapabilityEnabled = (permission: string, checked: boolean) => {
    const nextAllow = nextCapabilityValues(allow, permission, checked)
    const nextDeny = deny.filter(value => value !== permission)
    form.setFieldsValue({ allow: nextAllow, deny: nextDeny })
  }

  return (
    <div className='relay-access-groups__capability-matrix'>
      <div className='relay-access-groups__capability-toolbar'>
        <Input
          allowClear
          prefix={<AdminIcon name='search' />}
          value={searchValue}
          placeholder='搜索权限、配额名称、标识'
          onChange={event => setSearchValue(event.target.value)}
        />
      </div>
      <div className='relay-access-groups__capability-layout'>
        <nav aria-label='权限分类' className='relay-access-groups__capability-nav'>
          {scopeCategories.map(category => (
            <button
              className={category.key === categoryFilter ? 'is-active' : undefined}
              key={category.key}
              type='button'
              onClick={() => setCategoryFilter(category.key)}
            >
              <span>{category.label}</span>
              <small>{capabilityMatrixCategoryCount(category.key, scope)}</small>
            </button>
          ))}
        </nav>
        <div className='relay-access-groups__capability-table' role='table' aria-label='权限配置'>
          <div className='relay-access-groups__capability-row is-header' role='row'>
            <div role='columnheader'>权限名称</div>
            <div role='columnheader'>权限域</div>
            <div role='columnheader'>操作</div>
          </div>
          {filteredEntries.map(entry => {
            if (entry.type === 'quota') {
              return (
                <div className='relay-access-groups__capability-row' key={entry.value} role='row'>
                  <div className='relay-access-groups__capability-name' role='cell'>
                    <strong>{entry.label}</strong>
                    <code>{entry.value}</code>
                  </div>
                  <div role='cell'>
                    <StatusBadge tone='muted'>{capabilityCategoryLabel(entry.category)}</StatusBadge>
                  </div>
                  <div className='relay-access-groups__capability-action' role='cell'>
                    <Form.Item
                      className='relay-access-groups__inline-item relay-access-groups__quota-operation'
                      name={entry.key}
                    >
                      <InputNumber
                        controls={false}
                        disabled={disabled}
                        min={0}
                        placeholder='不限'
                      />
                    </Form.Item>
                  </div>
                </div>
              )
            }
            const checked = allow.includes(entry.value)
            return (
              <div className='relay-access-groups__capability-row' key={entry.value} role='row'>
                <div className='relay-access-groups__capability-name' role='cell'>
                  <strong>{entry.label}</strong>
                  <code>{entry.value}</code>
                </div>
                <div role='cell'>
                  <StatusBadge tone='muted'>{capabilityCategoryLabel(entry.category)}</StatusBadge>
                </div>
                <div className='relay-access-groups__capability-action' role='cell'>
                  <Switch
                    checked={checked}
                    disabled={disabled}
                    aria-label={`配置${entry.label}`}
                    onChange={checked => setCapabilityEnabled(entry.value, checked)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

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
  const defaultLocale = useMemo(userPreferredAccessGroupLocale, [])
  const [activeLocale, setActiveLocale] = useState<AccessGroupLocale>(defaultLocale)
  const [enabledLocales, setEnabledLocales] = useState<AccessGroupLocale[]>([defaultLocale])
  const [localeToAdd, setLocaleToAdd] = useState<AccessGroupLocale | undefined>()
  const descriptionI18nEnabled = Form.useWatch('descriptionI18nEnabled', form) === true
  const parentOptions = useMemo(
    () =>
      groups
        .filter(item => item.scope === scope && item.id !== group?.id && item.builtIn !== true)
        .map(item => ({ label: localizedAccessGroupName(item), value: item.id })),
    [group?.id, groups, scope]
  )
  const availableLocaleOptions = supportedAccessGroupLocales.filter(
    locale => !enabledLocales.includes(locale.value)
  )

  const addLocale = () => {
    const nextLocale = localeToAdd ?? availableLocaleOptions[0]?.value
    if (nextLocale == null) return
    setEnabledLocales(locales => (locales.includes(nextLocale) ? locales : [...locales, nextLocale]))
    setActiveLocale(nextLocale)
    setLocaleToAdd(undefined)
  }

  useEffect(() => {
    const localizedNames = group?.localizedNames ?? {}
    const localizedDescriptions = group?.localizedDescriptions ?? {}
    const nextLocales = supportedAccessGroupLocales
      .map(locale => locale.value)
      .filter(locale => (
        cleanText(nameForLocale(localizedNames, locale)) !== '' ||
        cleanText(descriptionForLocale(localizedDescriptions, locale)) !== ''
      ))
    const normalizedLocales = isBuiltInGroup
      ? orderedAccessGroupLocales(supportedAccessGroupLocaleValues, defaultLocale)
      : orderedAccessGroupLocales(nextLocales, defaultLocale)
    const defaultName = nameForLocale(localizedNames, defaultLocale) ?? group?.name ?? ''
    const defaultDescription = descriptionForLocale(localizedDescriptions, defaultLocale) ?? group?.description ?? ''
    form.setFieldsValue({
      allow: group?.capabilities.allow ?? [],
      deny: group?.capabilities.deny ?? [],
      description: defaultDescription,
      descriptionEn: descriptionForLocale(localizedDescriptions, 'en') ?? '',
      descriptionI18nEnabled: isBuiltInGroup || Object.keys(localizedNames).length > 0 ||
        Object.keys(localizedDescriptions).length > 0,
      descriptionZhHans: descriptionForLocale(localizedDescriptions, 'zh-Hans') ?? '',
      maxDevices: quotaValue(group?.quotas.maxDevices),
      maxMembersPerOwnedTeam: quotaValue(group?.quotas.maxMembersPerOwnedTeam),
      maxTeamsJoined: quotaValue(group?.quotas.maxTeamsJoined),
      maxTeamsOwned: quotaValue(group?.quotas.maxTeamsOwned),
      name: defaultName,
      nameEn: nameForLocale(localizedNames, 'en') ?? '',
      nameZhHans: nameForLocale(localizedNames, 'zh-Hans') ?? '',
      parentGroupId: parentOptions.some(option => option.value === group?.parentGroupId) ? group?.parentGroupId : null,
      scope
    })
    setEnabledLocales(normalizedLocales)
    setActiveLocale(defaultLocale)
    setLocaleToAdd(undefined)
  }, [defaultLocale, form, group, isBuiltInGroup, parentOptions, scope])

  const buildQuotas = (values: AccessGroupFormValues): Record<string, number | null> | undefined => (
    scope === 'team'
      ? undefined
      : {
        maxDevices: values.maxDevices ?? null,
        maxMembersPerOwnedTeam: values.maxMembersPerOwnedTeam ?? null,
        maxTeamsJoined: values.maxTeamsJoined ?? null,
        maxTeamsOwned: values.maxTeamsOwned ?? null
      }
  )

  const handleSubmit = async (values: AccessGroupFormValues) => {
    const name = cleanText(values.name)
    if (name === '') return
    const localizedNames = cleanLocalizedNames(values, enabledLocales, defaultLocale)
    const localizedDescriptions = cleanLocalizedDescriptions(values, enabledLocales, defaultLocale)
    const scopeCapabilityValues = capabilityValuesForScope(scope)
    const quotas = buildQuotas(values)
    const input = {
      capabilities: {
        allow: (values.allow ?? []).filter(value => scopeCapabilityValues.has(value)),
        deny: (values.deny ?? []).filter(value => scopeCapabilityValues.has(value))
      },
      description: cleanText(values.description),
      name,
      parentGroupId: values.parentGroupId ?? null,
      ...(quotas == null ? {} : { quotas })
    }
    if (mode === 'create') {
      await onCreateGroup({
        ...input,
        ...(localizedNames == null ? {} : { localizedNames }),
        ...(localizedDescriptions == null ? {} : { localizedDescriptions }),
        scope
      })
      form.resetFields()
    } else if (group != null) {
      await onUpdateGroup({
        ...input,
        id: group.id,
        localizedDescriptions: localizedDescriptions ?? null,
        localizedNames: localizedNames ?? null
      })
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
      <Form.Item hidden name='allow'>
        <Select mode='multiple' options={capabilityOptions} />
      </Form.Item>
      <Form.Item hidden name='deny'>
        <Select mode='multiple' options={capabilityOptions} />
      </Form.Item>
      <div className='relay-access-groups__editor-summary'>
        <div>
          <strong>
            {mode === 'create' ? `新建${groupNoun}` : group == null ? groupNoun : localizedAccessGroupName(group)}
          </strong>
          <span>{mode === 'create' ? `配置这个${groupNoun}可继承和可授予的权限能力。` : group?.id}</span>
        </div>
        <div className='relay-access-groups__editor-summary-items'>
          <StatusBadge tone={group?.disabled === true ? 'warning' : 'success'}>
            {group?.disabled === true ? '禁用' : '启用'}
          </StatusBadge>
        </div>
      </div>
      <section className='relay-access-groups__form-section'>
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
        <FormRow label='多语言文案'>
          <Form.Item
            className='relay-access-groups__inline-item'
            name='descriptionI18nEnabled'
            valuePropName='checked'
          >
            <Switch disabled={disabled || isBuiltInGroup} />
          </Form.Item>
        </FormRow>
        {descriptionI18nEnabled
          ? (
            <div className='relay-access-groups__language-editor'>
              <Tabs
                activeKey={activeLocale}
                className='relay-access-groups__language-tabs'
                items={enabledLocales.map(locale => ({
                  children: (
                    <div className='relay-access-groups__language-panel'>
                      <FormRow label={`${groupNoun}名称`} required={locale === defaultLocale}>
                        <Form.Item
                          className='relay-access-groups__inline-item'
                          name={locale === defaultLocale ? 'name' : nameFieldByLocale[locale]}
                          rules={locale === defaultLocale
                            ? [{ required: true, message: `请输入${groupNoun}名称` }]
                            : undefined}
                        >
                          <Input disabled={disabled} />
                        </Form.Item>
                      </FormRow>
                      <FormRow label='说明' stacked>
                        <Form.Item
                          className='relay-access-groups__inline-item'
                          name={locale === defaultLocale ? 'description' : descriptionFieldByLocale[locale]}
                        >
                          <Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} disabled={disabled} />
                        </Form.Item>
                      </FormRow>
                    </div>
                  ),
                  key: locale,
                  label: accessGroupLocaleLabel(locale)
                }))}
                tabBarExtraContent={availableLocaleOptions.length > 0
                  ? (
                    <div className='relay-access-groups__language-actions'>
                      <Select
                        aria-label='选择新增语言'
                        disabled={disabled}
                        options={availableLocaleOptions}
                        placeholder='添加语言'
                        size='small'
                        value={localeToAdd}
                        onChange={value => setLocaleToAdd(value)}
                      />
                      <Button
                        disabled={disabled}
                        icon={<AdminIcon name='add' />}
                        size='small'
                        type='text'
                        onClick={addLocale}
                      >
                        添加
                      </Button>
                    </div>
                  )
                  : null}
                onChange={key => setActiveLocale(key as AccessGroupLocale)}
              />
            </div>
          )
          : (
            <>
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
            </>
          )}
      </section>
      <section className='relay-access-groups__form-section relay-access-groups__form-section--matrix'>
        <CapabilityMatrixField
          disabled={disabled}
          form={form}
          scope={scope}
        />
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
      const name = localizedAccessGroupName(group)
      const description = localizedAccessGroupDescription(group) ?? ''
      const searchable = [
        group.id,
        group.name,
        name,
        description,
        ...Object.values(group.localizedNames),
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
        const name = localizedAccessGroupName(group)
        const description = cleanText(localizedAccessGroupDescription(group))
        return (
          <button
            className='relay-access-groups__name'
            type='button'
            onClick={() => openGroup(group)}
          >
            <strong>{name}</strong>
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
