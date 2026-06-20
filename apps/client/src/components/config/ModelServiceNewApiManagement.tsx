/* eslint-disable max-lines -- New API management panel keeps snapshot, token mutation, and local profile import together. */
import { App, Button, Input, InputNumber, Modal, Popconfirm, Switch } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

import type {
  ConfigSource,
  ModelServiceConfig,
  ProviderManagementGroup,
  ProviderManagementSnapshot,
  ProviderManagementToken
} from '@oneworks/types'

import {
  createModelServiceManagementToken,
  deleteModelServiceManagementToken,
  getApiErrorMessage,
  getModelServiceManagementSnapshot,
  getModelServiceManagementTokenProfile,
  updateModelServiceManagementToken
} from '#~/api'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'

import { ConfigRecordCreateRow, ConfigRecordList, ConfigRecordRow } from './ConfigRecordList'
import type { TranslationFn } from './configUtils'
import { formatCurrencyAmount, toModelServiceConfig } from './modelServiceProviderActionUtils'

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)
const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const slugifyProfileKey = (value: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return slug === '' ? 'token' : slug
}

const getUniqueProfileKey = (
  base: string,
  profiles: Record<string, unknown>,
  resolvedProfiles: Record<string, unknown>
) => {
  const normalizedBase = slugifyProfileKey(base)
  if (profiles[normalizedBase] == null && resolvedProfiles[normalizedBase] == null) return normalizedBase
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${normalizedBase}-${index}`
    if (profiles[candidate] == null && resolvedProfiles[candidate] == null) return candidate
  }
  return `${normalizedBase}-${Date.now()}`
}

const formatAmount = (amount: number | undefined, currency: string | undefined, t: TranslationFn) => (
  amount == null
    ? t('config.modelServices.management.unknown', { defaultValue: '-' })
    : formatCurrencyAmount(currency, String(amount))
)

const tokenStatusLabel = (status: number | undefined, t: TranslationFn) => {
  if (status === 1) return t('config.modelServices.management.tokenStatus.enabled', { defaultValue: '启用' })
  if (status === 2) return t('config.modelServices.management.tokenStatus.disabled', { defaultValue: '停用' })
  if (status === 3) return t('config.modelServices.management.tokenStatus.expired', { defaultValue: '过期' })
  return t('config.modelServices.management.tokenStatus.unknown', { defaultValue: '未知' })
}

const groupOptions = (groups: ProviderManagementGroup[], tokens: ProviderManagementToken[]) => {
  const ids = new Set<string>()
  for (const group of groups) ids.add(group.id)
  for (const token of tokens) {
    const group = normalizeString(token.group)
    if (group != null) ids.add(group)
  }
  return Array.from(ids).map(group => ({ label: group, value: group }))
}

const getProfileText = (
  profile: unknown,
  key: string,
  fieldName: 'title' | 'description'
) => {
  if (!isRecord(profile)) return fieldName === 'title' ? key : ''
  const value = profile[fieldName]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fieldName === 'title' ? key : ''
}

const getProfileTokenId = (profile: unknown) => {
  if (!isRecord(profile) || !isRecord(profile.extra)) return undefined
  return normalizeString(profile.extra.newapiTokenId) ?? normalizeString(profile.extra.tokenId)
}

const mergeTokenProfile = (
  profile: ModelServiceConfig,
  token: Pick<ProviderManagementToken, 'group' | 'id'>
) => {
  const extra = isRecord(profile.extra) ? profile.extra : {}
  return {
    ...profile,
    extra: {
      ...extra,
      ...(token.group == null ? {} : { group: token.group }),
      newapiTokenId: token.id
    }
  }
}

export const ModelServiceNewApiManagement = ({
  onOpenApiKey,
  onOpenApiKeysTab,
  onOpenProfile,
  onProfilesChange,
  profileKey,
  profiles,
  readOnly,
  resolvedProfiles,
  service,
  serviceKey,
  source,
  t,
  tokenId,
  view = 'profiles'
}: {
  onOpenApiKey?: (tokenId: string) => void
  onOpenApiKeysTab?: () => void
  onOpenProfile: (profileKey: string) => void
  onProfilesChange: (profiles: Record<string, unknown>) => void
  profileKey?: string
  profiles: Record<string, unknown>
  readOnly: boolean
  resolvedProfiles: Record<string, unknown>
  service: unknown
  serviceKey: string
  source: ConfigSource
  t: TranslationFn
  tokenId?: string
  view?: 'apiKeyDetail' | 'apiKeys' | 'profileDetail' | 'profiles'
}) => {
  const { message } = App.useApp()
  const modelService = useMemo(() => toModelServiceConfig(service), [service])
  const [loadingAction, setLoadingAction] = useState<string>()
  const [newTokenName, setNewTokenName] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [dialogTokenName, setDialogTokenName] = useState('')
  const [tokenDraft, setTokenDraft] = useState<{
    group?: string
    name: string
    quota: number | null
    status?: number
    unlimited: boolean
  }>({
    name: '',
    quota: null,
    unlimited: true
  })
  const {
    data: snapshotResult,
    isLoading: isSnapshotLoading,
    mutate: mutateSnapshot
  } = useSWR(
    ['model-service-management', serviceKey, source, modelService] as const,
    ([, currentServiceKey, currentSource, currentService]) =>
      getModelServiceManagementSnapshot(currentServiceKey, { service: currentService, source: currentSource }),
    {
      keepPreviousData: true,
      revalidateOnFocus: false
    }
  )

  const snapshot: ProviderManagementSnapshot | null = snapshotResult?.management ?? null
  const groups = snapshot?.groups ?? []
  const tokens = snapshot?.tokens ?? []
  const options = useMemo(() => groupOptions(groups, tokens), [groups, tokens])
  const account = snapshot?.account?.kind === 'balance' ? snapshot.account : undefined
  const profileRows = useMemo(() => {
    const keys = Array.from(
      new Set([
        ...Object.keys(resolvedProfiles),
        ...Object.keys(profiles)
      ])
    ).sort((left, right) => left.localeCompare(right))
    return keys.map((key) => {
      const localProfile = profiles[key]
      const resolvedProfile = resolvedProfiles[key]
      const displayProfile = isRecord(localProfile) ? localProfile : resolvedProfile
      return {
        description: getProfileText(displayProfile, key, 'description'),
        isLocal: isRecord(localProfile),
        key,
        title: getProfileText(displayProfile, key, 'title'),
        tokenId: getProfileTokenId(displayProfile)
      }
    })
  }, [profiles, resolvedProfiles])
  const profileKeyByTokenId = useMemo(() => {
    const entries = profileRows
      .filter(row => row.tokenId != null)
      .map(row => [row.tokenId!, row.key] as const)
    return new Map(entries)
  }, [profileRows])
  const profileRowByKey = useMemo(() => (
    new Map(profileRows.map(row => [row.key, row]))
  ), [profileRows])
  const tokenById = useMemo(() => new Map(tokens.map(token => [token.id, token])), [tokens])
  const tokenOptions = useMemo(() => (
    tokens.map(token => ({
      label: token.name ?? token.key ?? token.id,
      value: token.id
    }))
  ), [tokens])
  const defaultToken = tokens[0]
  const defaultGroup = groups[0]?.id ?? tokens.map(token => normalizeString(token.group)).find(Boolean)
  const currentProfileRow = profileKey == null ? undefined : profileRowByKey.get(profileKey)
  const currentDetailToken = tokenId == null ? undefined : tokenById.get(tokenId)
  const visibleProfileRows = view === 'profiles' ? profileRows : []
  const visibleTokens = view === 'apiKeys' ? tokens : []

  const runAction = useCallback(async <T,>(actionKey: string, action: () => Promise<T>) => {
    setLoadingAction(actionKey)
    try {
      return await action()
    } catch (error) {
      void message.error(getApiErrorMessage(
        error,
        t('config.modelServices.management.actionFailed', {
          defaultValue: '平台管理操作失败'
        })
      ))
      return undefined
    } finally {
      setLoadingAction(undefined)
    }
  }, [message, t])

  useEffect(() => {
    if (currentDetailToken == null) return
    setTokenDraft({
      group: currentDetailToken.group,
      name: currentDetailToken.name ?? currentDetailToken.id,
      quota: currentDetailToken.quota ?? currentDetailToken.remaining ?? null,
      status: currentDetailToken.status,
      unlimited: currentDetailToken.unlimited === true
    })
  }, [currentDetailToken])

  const createRemoteApiKey = async (name: string) => {
    if (name === '') return
    const result = await runAction('create-token', () =>
      createModelServiceManagementToken(serviceKey, {
        group: defaultGroup,
        name,
        unlimited: true
      }, { service: modelService, source }))
    if (result == null) return
    void message.success(t('config.modelServices.management.createApiKeySuccess', { defaultValue: '令牌已创建' }))
    await mutateSnapshot()
    if (result.result.token?.id != null) onOpenApiKey?.(result.result.token.id)
  }

  const createProfileFromToken = async (name: string) => {
    if (name === '') return
    if (defaultToken == null) {
      void message.warning(t('config.modelServices.management.noApiKeyForProfile', {
        defaultValue: '请先创建远端令牌。'
      }))
      onOpenApiKeysTab?.()
      return
    }
    const result = await runAction(
      `create-profile:${defaultToken.id}`,
      () => getModelServiceManagementTokenProfile(serviceKey, defaultToken.id, { service: modelService, source })
    )
    if (result == null) return
    const profile = {
      ...mergeTokenProfile(result.profile, defaultToken),
      title: name
    }
    const key = getUniqueProfileKey(name, profiles, resolvedProfiles)
    onProfilesChange({
      ...profiles,
      [key]: profile
    })
    setNewTokenName('')
    void message.success(t('config.modelServices.management.createSuccess', { defaultValue: '配置档案已创建' }))
    onOpenProfile(key)
  }

  const createCurrentItem = async (name: string) => {
    const nextName = name.trim()
    if (nextName === '') return
    if (view === 'apiKeys') {
      await createRemoteApiKey(nextName)
    } else {
      await createProfileFromToken(nextName)
    }
    setNewTokenName('')
    setDialogTokenName('')
    setCreateDialogOpen(false)
  }

  const bindProfileToToken = async (profileKey: string, tokenId: string) => {
    const token = tokenById.get(tokenId)
    if (token == null) return
    const result = await runAction(
      `bind-profile:${profileKey}:${token.id}`,
      () => getModelServiceManagementTokenProfile(serviceKey, token.id, { service: modelService, source })
    )
    if (result == null) return
    const currentProfile = profiles[profileKey]
    const resolvedProfile = resolvedProfiles[profileKey]
    const existingProfile = isRecord(currentProfile)
      ? currentProfile
      : isRecord(resolvedProfile)
      ? resolvedProfile
      : {}
    const importedProfile = mergeTokenProfile(result.profile, token)
    const importedExtra = isRecord(importedProfile.extra) ? importedProfile.extra : {}
    const existingExtra = isRecord(existingProfile.extra) ? existingProfile.extra : {}
    const nextProfile = {
      ...importedProfile,
      ...existingProfile,
      apiKey: importedProfile.apiKey,
      extra: {
        ...importedExtra,
        ...existingExtra,
        ...(token.group == null ? {} : { group: token.group }),
        newapiTokenId: token.id
      }
    }
    onProfilesChange({
      ...profiles,
      [profileKey]: nextProfile
    })
    void message.success(t('config.modelServices.management.bindSuccess', { defaultValue: '远端令牌已绑定' }))
  }

  const updateToken = async () => {
    if (currentDetailToken == null) return
    const name = normalizeString(tokenDraft.name)
    const result = await runAction(
      `update-token:${currentDetailToken.id}`,
      () =>
        updateModelServiceManagementToken(serviceKey, currentDetailToken.id, {
          group: normalizeString(tokenDraft.group),
          name,
          quota: tokenDraft.unlimited ? undefined : tokenDraft.quota ?? undefined,
          status: tokenDraft.status,
          unlimited: tokenDraft.unlimited
        }, { service: modelService, source })
    )
    if (result == null) return
    void message.success(t('config.modelServices.management.updateSuccess', { defaultValue: '令牌已更新' }))
    await mutateSnapshot()
  }

  const deleteToken = async (token: ProviderManagementToken) => {
    const result = await runAction(
      `delete-token:${token.id}`,
      () => deleteModelServiceManagementToken(serviceKey, token.id, { service: modelService, source })
    )
    if (result == null) return
    const linkedProfileKey = profileKeyByTokenId.get(token.id)
    if (linkedProfileKey != null && profiles[linkedProfileKey] != null) {
      const nextProfiles = { ...profiles }
      delete nextProfiles[linkedProfileKey]
      onProfilesChange(nextProfiles)
    }
    void message.success(t('config.modelServices.management.deleteApiKeySuccess', { defaultValue: '令牌已删除' }))
    await mutateSnapshot()
  }

  const deleteLocalProfile = (profileKey: string) => {
    const nextProfiles = { ...profiles }
    delete nextProfiles[profileKey]
    onProfilesChange(nextProfiles)
  }

  if (view === 'profileDetail') {
    return (
      <div className='config-view__newapi-management'>
        <div className='config-view__field-list'>
          <div className='config-view__field-row'>
            <div className='config-view__field-meta'>
              <span className='material-symbols-rounded config-view__field-icon'>vpn_key</span>
              <div className='config-view__field-text'>
                <div className='config-view__field-title'>
                  {t('config.modelServices.management.selectApiKey', { defaultValue: '选择远端令牌' })}
                </div>
                <div className='config-view__field-desc'>
                  {currentProfileRow?.tokenId == null
                    ? t('config.modelServices.management.unboundProfile', { defaultValue: '未选择远端令牌' })
                    : t('config.modelServices.management.boundProfile', {
                      defaultValue: '远端令牌：{{key}}',
                      key: tokenById.get(currentProfileRow.tokenId)?.name ?? currentProfileRow.tokenId
                    })}
                </div>
              </div>
            </div>
            <div className='config-view__field-control'>
              {tokenOptions.length > 0
                ? (
                  <Select
                    options={tokenOptions}
                    value={currentProfileRow?.tokenId}
                    disabled={readOnly || profileKey == null}
                    placeholder={t('config.modelServices.management.selectApiKey', {
                      defaultValue: '选择远端令牌'
                    })}
                    onChange={value => {
                      const nextTokenId = normalizeString(value)
                      if (profileKey != null && nextTokenId != null) void bindProfileToToken(profileKey, nextTokenId)
                    }}
                  />
                )
                : (
                  <Button
                    size='small'
                    onClick={onOpenApiKeysTab}
                    disabled={readOnly}
                  >
                    {t('config.modelServices.management.createApiKeyFirst', { defaultValue: '创建令牌' })}
                  </Button>
                )}
            </div>
          </div>
          {profileKey != null && profiles[profileKey] != null && !readOnly && (
            <div className='config-view__field-row'>
              <div className='config-view__field-meta'>
                <span className='material-symbols-rounded config-view__field-icon'>delete</span>
                <div className='config-view__field-text'>
                  <div className='config-view__field-title'>{t('common.delete')}</div>
                  <div className='config-view__field-desc'>
                    {t('config.modelServices.management.deleteProfileDesc', {
                      defaultValue: '删除这个本地配置档案，不会删除远端令牌。'
                    })}
                  </div>
                </div>
              </div>
              <div className='config-view__field-control'>
                <Button danger size='small' onClick={() => deleteLocalProfile(profileKey)}>
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (view === 'apiKeyDetail') {
    if (currentDetailToken == null) {
      return (
        <div className='config-view__detail-list-empty'>
          <div className='config-view__detail-list-empty-title'>
            {isSnapshotLoading
              ? t('config.modelServices.management.loading', { defaultValue: '正在加载平台数据' })
              : t('common.noData')}
          </div>
        </div>
      )
    }

    return (
      <div className='config-view__newapi-management'>
        <div className='config-view__field-list'>
          <div className='config-view__field-row'>
            <div className='config-view__field-meta'>
              <span className='material-symbols-rounded config-view__field-icon'>badge</span>
              <div className='config-view__field-text'>
                <div className='config-view__field-title'>
                  {t('config.modelServices.management.name', { defaultValue: '名称' })}
                </div>
                <div className='config-view__field-desc'>{currentDetailToken.key}</div>
              </div>
            </div>
            <div className='config-view__field-control'>
              <Input
                value={tokenDraft.name}
                disabled={readOnly}
                onChange={event => setTokenDraft(current => ({ ...current, name: event.target.value }))}
              />
            </div>
          </div>
          <div className='config-view__field-row'>
            <div className='config-view__field-meta'>
              <span className='material-symbols-rounded config-view__field-icon'>groups</span>
              <div className='config-view__field-text'>
                <div className='config-view__field-title'>
                  {t('config.modelServices.management.groups', { defaultValue: '分组' })}
                </div>
                <div className='config-view__field-desc'>
                  {t('config.modelServices.management.groupDesc', {
                    defaultValue: '令牌使用的 New API 分组。'
                  })}
                </div>
              </div>
            </div>
            <div className='config-view__field-control'>
              <Select
                allowClear
                options={options}
                value={tokenDraft.group}
                disabled={readOnly}
                placeholder={t('config.modelServices.management.groupPlaceholder', { defaultValue: '分组' })}
                onChange={value => setTokenDraft(current => ({ ...current, group: normalizeString(value) }))}
              />
            </div>
          </div>
          <div className='config-view__field-row'>
            <div className='config-view__field-meta'>
              <span className='material-symbols-rounded config-view__field-icon'>account_balance_wallet</span>
              <div className='config-view__field-text'>
                <div className='config-view__field-title'>
                  {t('config.modelServices.management.quotaPlaceholder', { defaultValue: '额度' })}
                </div>
                <div className='config-view__field-desc'>
                  {tokenDraft.unlimited
                    ? t('config.modelServices.management.unlimited', { defaultValue: '不限额' })
                    : formatAmount(tokenDraft.quota ?? undefined, account?.currency, t)}
                </div>
              </div>
            </div>
            <div className='config-view__field-control config-view__newapi-management-inline-control'>
              <Switch
                size='small'
                checked={tokenDraft.unlimited}
                disabled={readOnly}
                onChange={unlimited => setTokenDraft(current => ({ ...current, unlimited }))}
              />
              <InputNumber
                min={0}
                precision={2}
                value={tokenDraft.quota}
                disabled={readOnly || tokenDraft.unlimited}
                placeholder={t('config.modelServices.management.quotaPlaceholder', { defaultValue: '额度' })}
                onChange={value =>
                  setTokenDraft(current => ({
                    ...current,
                    quota: typeof value === 'number' ? value : null
                  }))}
              />
            </div>
          </div>
          <div className='config-view__field-row'>
            <div className='config-view__field-meta'>
              <span className='material-symbols-rounded config-view__field-icon'>toggle_on</span>
              <div className='config-view__field-text'>
                <div className='config-view__field-title'>
                  {t('config.modelServices.management.status', { defaultValue: '状态' })}
                </div>
                <div className='config-view__field-desc'>
                  {tokenStatusLabel(tokenDraft.status, t)}
                </div>
              </div>
            </div>
            <div className='config-view__field-control'>
              <Select
                value={tokenDraft.status}
                disabled={readOnly}
                options={[
                  {
                    label: t('config.modelServices.management.tokenStatus.enabled', { defaultValue: '启用' }),
                    value: 1
                  },
                  {
                    label: t('config.modelServices.management.tokenStatus.disabled', { defaultValue: '停用' }),
                    value: 2
                  }
                ]}
                onChange={status => setTokenDraft(current => ({ ...current, status }))}
              />
            </div>
          </div>
          {!readOnly && (
            <div className='config-view__newapi-management-detail-actions'>
              <Button
                type='primary'
                size='small'
                loading={loadingAction === `update-token:${currentDetailToken.id}`}
                onClick={() => void updateToken()}
              >
                {t('config.actions.save')}
              </Button>
              <Popconfirm
                title={t('config.modelServices.management.deleteApiKeyConfirm', {
                  defaultValue: '删除这个远端令牌？'
                })}
                okText={t('common.delete')}
                cancelText={t('common.cancel')}
                onConfirm={() => void deleteToken(currentDetailToken)}
              >
                <Button
                  danger
                  size='small'
                  loading={loadingAction === `delete-token:${currentDetailToken.id}`}
                >
                  {t('common.delete')}
                </Button>
              </Popconfirm>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className='config-view__newapi-management'>
      {!readOnly && (
        <ConfigRecordCreateRow
          value={newTokenName}
          onValueChange={setNewTokenName}
          placeholder={t(
            view === 'apiKeys'
              ? 'config.modelServices.management.newApiKeyName'
              : 'config.modelServices.management.newTokenName',
            { defaultValue: view === 'apiKeys' ? '新建令牌名称' : '新建配置档案名称' }
          )}
          className='config-view__newapi-management-create'
          onSubmit={() => void createCurrentItem(newTokenName)}
          actions={[
            {
              ariaLabel: t('config.modelServices.management.dialogCreate', { defaultValue: '对话创建' }),
              disabled: view === 'profiles' && tokens.length === 0,
              icon: <span className='material-symbols-rounded'>edit_square</span>,
              key: 'dialog-create',
              onClick: () => {
                setDialogTokenName(newTokenName.trim())
                setCreateDialogOpen(true)
              },
              title: t('config.modelServices.management.dialogCreate', { defaultValue: '对话创建' })
            },
            {
              ariaLabel: t('config.editor.addItem'),
              disabled: newTokenName.trim() === '' || (view === 'profiles' && tokens.length === 0),
              icon: <span className='material-symbols-rounded'>add</span>,
              key: 'create',
              loading: loadingAction === 'create-token' ||
                loadingAction?.startsWith('create-profile:') === true,
              onClick: () => void createCurrentItem(newTokenName),
              title: t('config.editor.addItem'),
              type: 'primary'
            }
          ]}
          hint={view === 'profiles' && tokens.length === 0 && (
            <div className='config-view__newapi-management-create-hint'>
              {t('config.modelServices.management.noApiKeyForProfile', {
                defaultValue: '请先创建远端令牌。'
              })}
              <Button type='link' size='small' onClick={onOpenApiKeysTab}>
                {t('config.modelServices.management.createApiKeyFirst', { defaultValue: '创建令牌' })}
              </Button>
            </div>
          )}
        />
      )}

      <ConfigRecordList>
        {visibleTokens.length === 0 && visibleProfileRows.length === 0
          ? (
            <div className='config-view__detail-list-empty'>
              <div className='config-view__detail-list-empty-title'>
                {isSnapshotLoading
                  ? t('config.modelServices.management.loading', { defaultValue: '正在加载平台数据' })
                  : t('common.noData')}
              </div>
              <div className='config-view__detail-list-empty-desc'>
                {t('config.modelServices.management.empty', { defaultValue: '暂无配置档案。' })}
              </div>
            </div>
          )
          : visibleTokens.map(token => (
            <ConfigRecordRow
              key={token.id}
              icon={<span className='material-symbols-rounded config-view__record-icon'>vpn_key</span>}
              title={token.name ?? token.id}
              subtitle={[token.key, tokenStatusLabel(token.status, t)].filter(Boolean).join(' · ')}
              descriptions={[
                [
                  token.group == null
                    ? undefined
                    : t('config.modelServices.management.tokenGroup', {
                      defaultValue: '分组：{{group}}',
                      group: token.group
                    }),
                  token.unlimited === true
                    ? t('config.modelServices.management.unlimited', { defaultValue: '不限额' })
                    : t('config.modelServices.management.tokenQuota', {
                      amount: formatAmount(token.remaining, account?.currency, t),
                      defaultValue: '额度：{{amount}}'
                    })
                ].filter(Boolean).join(' · ')
              ]}
              onClick={() => onOpenApiKey?.(token.id)}
            />
          ))}
        {visibleProfileRows.map(row => (
          <ConfigRecordRow
            key={`profile:${row.key}`}
            icon={<span className='material-symbols-rounded config-view__record-icon'>account_tree</span>}
            title={row.title}
            subtitle={row.key}
            descriptions={[
              row.description,
              row.tokenId == null
                ? t('config.modelServices.management.unboundProfile', { defaultValue: '未选择远端令牌' })
                : t('config.modelServices.management.boundProfile', {
                  defaultValue: '远端令牌：{{key}}',
                  key: tokenById.get(row.tokenId)?.name ?? row.tokenId
                })
            ]}
            onClick={() => onOpenProfile(row.key)}
          />
        ))}
      </ConfigRecordList>
      <Modal
        open={createDialogOpen}
        title={t(
          view === 'apiKeys'
            ? 'config.modelServices.management.createApiKeyTitle'
            : 'config.modelServices.management.createProfileTitle',
          { defaultValue: view === 'apiKeys' ? '创建令牌' : '创建配置档案' }
        )}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        confirmLoading={loadingAction === 'create-token' || loadingAction?.startsWith('create-profile:') === true}
        okButtonProps={{ disabled: dialogTokenName.trim() === '' || (view === 'profiles' && tokens.length === 0) }}
        onCancel={() => setCreateDialogOpen(false)}
        onOk={() => void createCurrentItem(dialogTokenName)}
      >
        <Input
          value={dialogTokenName}
          placeholder={t(
            view === 'apiKeys'
              ? 'config.modelServices.management.newApiKeyName'
              : 'config.modelServices.management.newTokenName',
            { defaultValue: view === 'apiKeys' ? '新建令牌名称' : '新建配置档案名称' }
          )}
          onChange={event => setDialogTokenName(event.target.value)}
          onPressEnter={() => void createCurrentItem(dialogTokenName)}
        />
      </Modal>
    </div>
  )
}
