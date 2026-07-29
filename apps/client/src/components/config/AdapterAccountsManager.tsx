/* eslint-disable max-lines -- account management keeps list, detail, and action flows in one surface. */
import './AdapterAccountsManager.scss'

import { App, Button, Collapse, Empty, Input, Popconfirm, Spin, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'

import type {
  AdapterAccountActionDescriptor,
  AdapterAccountInfo,
  AdapterAccountRateLimitResetCredit,
  AdapterAccountsResult,
  AdapterManageAccountResult,
  ConfigUiObjectSchema
} from '@oneworks/types'

import { getAdapterAccounts, getApiErrorMessage, manageAdapterAccount } from '#~/api'
import { QuotaUsageRing } from '#~/components/account-quota/QuotaUsageRing'
import { InlineActionButton } from '#~/components/inline-action-button'
import { UsagePanel } from '#~/components/usage/UsagePanel'
import {
  getAdapterResetCreditOutcome,
  getAdapterResetCreditOutcomeTone,
  useAdapterAccountQuotaDetail
} from '#~/hooks/use-adapter-account-quota-detail'
import { isUsableAdapterResetCredit } from '#~/utils/account-quota'

import { FieldRow } from './ConfigFieldRow'
import { getFieldDescription, getFieldLabel, getValueByPath, setValueByPath } from './configUtils'
import type { TranslationFn } from './configUtils'
import { SchemaObjectEditor } from './record-editors/SchemaObjectEditor'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const ACCOUNT_ACTION_ICON: Record<AdapterAccountActionDescriptor['key'], string> = {
  add: 'person_add',
  refresh: 'refresh',
  remove: 'delete'
}

const ACCOUNT_STATUS_ICON: Record<NonNullable<AdapterAccountInfo['status']>, string> = {
  ready: 'check_circle',
  missing: 'warning',
  error: 'error'
}

const getConfiguredAccounts = (value: Record<string, unknown>) => {
  const configured = getValueByPath(value, ['accounts'])
  return isRecord(configured) ? configured : {}
}

const getConfiguredAccountEntry = (value: Record<string, unknown>, accountKey: string) => {
  const configured = getConfiguredAccounts(value)[accountKey]
  return isRecord(configured) ? configured : {}
}

const setConfiguredAccountEntry = (
  value: Record<string, unknown>,
  accountKey: string,
  nextEntry: Record<string, unknown>
) => setValueByPath(value, ['accounts', accountKey], nextEntry) as Record<string, unknown>

const formatStatus = (status: AdapterAccountInfo['status'], t: TranslationFn) => {
  switch (status) {
    case 'missing':
      return {
        label: t('config.accounts.status.missing'),
        color: 'default' as const,
        icon: ACCOUNT_STATUS_ICON.missing
      }
    case 'error':
      return {
        label: t('config.accounts.status.error'),
        color: 'error' as const,
        icon: ACCOUNT_STATUS_ICON.error
      }
    case 'ready':
    default:
      return {
        label: t('config.accounts.status.ready'),
        color: 'success' as const,
        icon: ACCOUNT_STATUS_ICON.ready
      }
  }
}

const getActionLabel = (action: AdapterAccountActionDescriptor, t: TranslationFn) => (
  t(`config.accounts.actions.${action.key}.label`, { defaultValue: action.label })
)

const getActionDescription = (action: AdapterAccountActionDescriptor, t: TranslationFn) => (
  t(`config.accounts.actions.${action.key}.description`, {
    defaultValue: action.description ?? action.label
  })
)

const normalizeText = (value: string | undefined) => value?.trim().toLowerCase() ?? ''
const normalizeDisplayText = (value: string | undefined) => value?.trim() ?? ''

const formatEpochSeconds = (value: number | undefined) => {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value * 1000))
}

const getResetCreditTitle = (
  credit: AdapterAccountRateLimitResetCredit,
  index: number,
  t: TranslationFn
) => (
  normalizeText(credit.title) === 'full reset'
    ? t('config.accounts.resetCredits.fullResetTitle')
    : credit.title ?? t('config.accounts.resetCredits.itemTitle', { index: index + 1 })
)

const formatResetCreditRemaining = (
  expiresAt: number | undefined,
  t: TranslationFn
) => {
  if (expiresAt == null || !Number.isFinite(expiresAt) || expiresAt <= 0) return undefined

  const remainingMs = expiresAt * 1000 - Date.now()
  if (remainingMs <= 0) return t('config.accounts.resetCredits.remaining.expired')

  const totalHours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24

  if (days > 0 && hours > 0) {
    return t('config.accounts.resetCredits.remaining.daysHours', { days, hours })
  }
  if (days > 0) {
    return t('config.accounts.resetCredits.remaining.days', { count: days })
  }
  return t('config.accounts.resetCredits.remaining.hours', { count: totalHours })
}

const dedupeDisplayTexts = (...values: Array<string | undefined>) => {
  const uniqueValues = new Set<string>()

  return values
    .map(normalizeDisplayText)
    .filter((value) => {
      if (value === '' || uniqueValues.has(value)) return false
      uniqueValues.add(value)
      return true
    })
}

const compareAccountInfo = (
  left: Pick<AdapterAccountInfo, 'key' | 'title' | 'status' | 'isDefault'>,
  right: Pick<AdapterAccountInfo, 'key' | 'title' | 'status' | 'isDefault'>
) => {
  if (left.isDefault === true && right.isDefault !== true) return -1
  if (right.isDefault === true && left.isDefault !== true) return 1

  if (left.status !== right.status) {
    if (left.status === 'ready') return -1
    if (right.status === 'ready') return 1
  }

  const titleOrder = normalizeText(left.title).localeCompare(normalizeText(right.title))
  if (titleOrder !== 0) return titleOrder

  return left.key.localeCompare(right.key)
}

const renderTooltipContent = (label: string, description?: string) => {
  const normalizedDescription = description?.trim()
  if (normalizedDescription == null || normalizedDescription === '' || normalizedDescription === label) {
    return label
  }

  return (
    <div className='adapter-account-manager__tooltip'>
      <div className='adapter-account-manager__tooltip-title'>{label}</div>
      <div className='adapter-account-manager__tooltip-description'>{normalizedDescription}</div>
    </div>
  )
}

const IconTag = ({
  color,
  icon,
  label,
  description
}: {
  color?: 'default' | 'success' | 'error'
  icon: string
  label: string
  description?: string
}) => {
  const colorStyle = color === 'success'
    ? {
      color: 'var(--success-color, #52c41a)'
    }
    : color === 'error'
    ? {
      color: 'var(--error-color, #ff4d4f)'
    }
    : undefined

  return (
    <Tooltip title={renderTooltipContent(label, description)}>
      <span className='adapter-account-manager__icon-tag' style={colorStyle} aria-label={label}>
        <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>
      </span>
    </Tooltip>
  )
}

const AccountActionButtons = ({
  actions,
  loadingAction,
  onRunAction,
  t
}: {
  actions: AdapterAccountActionDescriptor[]
  loadingAction?: string
  onRunAction: (action: AdapterAccountActionDescriptor) => Promise<void>
  t: TranslationFn
}) => {
  if (actions.length === 0) return null

  return (
    <div className='adapter-account-manager__actions'>
      {actions.map((action) => {
        const label = getActionLabel(action, t)
        const description = getActionDescription(action, t)
        const icon = ACCOUNT_ACTION_ICON[action.key]

        if (action.key === 'remove') {
          return (
            <Popconfirm
              key={action.key}
              title={t('config.accounts.deleteConfirmTitle', {
                defaultValue: 'Delete the stored snapshot for {{account}}?',
                account: label
              })}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              onConfirm={async () => {
                await onRunAction(action)
              }}
            >
              <Tooltip title={renderTooltipContent(label, description)}>
                <Button
                  type='default'
                  size='small'
                  danger
                  loading={loadingAction === action.key}
                  aria-label={label}
                  className='adapter-account-manager__icon-button adapter-account-manager__header-action'
                  icon={<span className='material-symbols-rounded'>{icon}</span>}
                />
              </Tooltip>
            </Popconfirm>
          )
        }

        return (
          <Tooltip key={action.key} title={renderTooltipContent(label, description)}>
            <Button
              type='default'
              size='small'
              loading={loadingAction === action.key}
              aria-label={label}
              className='adapter-account-manager__icon-button adapter-account-manager__header-action'
              icon={<span className='material-symbols-rounded'>{icon}</span>}
              onClick={async () => {
                await onRunAction(action)
              }}
            />
          </Tooltip>
        )
      })}
    </div>
  )
}

export const mergeAccounts = (
  configured: Record<string, unknown>,
  discovered: AdapterAccountInfo[],
  defaultAccountKey?: string
) => {
  const merged = new Map<string, AdapterAccountInfo>()

  Object.entries(configured).forEach(([key, entry]) => {
    const configuredEntry = isRecord(entry) ? entry : {}
    const title = typeof configuredEntry.title === 'string' ? configuredEntry.title.trim() : ''
    const description = typeof configuredEntry.description === 'string' ? configuredEntry.description.trim() : ''
    merged.set(key, {
      key,
      title: title !== '' ? title : key,
      ...(description !== '' ? { description } : {}),
      status: 'missing'
    })
  })

  discovered.forEach((account) => {
    const existing = merged.get(account.key)
    merged.set(account.key, {
      ...existing,
      ...account
    })
  })

  return [...merged.values()]
    .map(account => ({
      ...account,
      isDefault: defaultAccountKey != null && defaultAccountKey !== ''
        ? account.key === defaultAccountKey
        : account.isDefault
    }))
    .sort(compareAccountInfo)
}

const AccountEditor = ({
  adapterKey,
  accountKey,
  accountItemSchema,
  value,
  onChange,
  t
}: {
  adapterKey: string
  accountKey: string
  accountItemSchema?: ConfigUiObjectSchema
  value: Record<string, unknown>
  onChange: (nextValue: Record<string, unknown>) => void
  t: TranslationFn
}) => {
  if (accountItemSchema == null || accountItemSchema.fields.length === 0) {
    return null
  }

  const editorSchema: ConfigUiObjectSchema = {
    ...accountItemSchema,
    fields: accountItemSchema.fields.map((field) => {
      if (field.path.length === 1 && field.path[0] === 'description') {
        return {
          ...field,
          type: 'multiline'
        }
      }

      return field
    })
  }
  const defaultAuthFilePath =
    `~/.oneworks/projects/<project-key>/.local/adapters/${adapterKey}/accounts/${accountKey}/auth.json`

  return (
    <div className='adapter-account-manager__editor'>
      <div className='adapter-account-manager__section-title'>
        <span className='material-symbols-rounded'>tune</span>
        <span>{t('config.accounts.settingsTitle', { defaultValue: 'Account settings' })}</span>
      </div>
      <SchemaObjectEditor
        value={getConfiguredAccountEntry(value, accountKey)}
        schema={editorSchema}
        onChange={(nextEntry) => onChange(setConfiguredAccountEntry(value, accountKey, nextEntry))}
        t={t}
        resolveFieldLabel={(field, fallback) => getFieldLabel(t, 'adapterAccount', field.path, fallback)}
        resolveFieldDescription={(field, fallback) => {
          const translated = getFieldDescription(t, 'adapterAccount', field.path)
          const baseDescription = translated !== '' ? translated : fallback
          if (field.path.length === 1 && field.path[0] === 'authFile') {
            const defaultLookupHint = t('config.accounts.authFileDefaultLookup', {
              defaultValue: 'Leave empty to use {{path}}.',
              path: defaultAuthFilePath
            })

            return [baseDescription, defaultLookupHint]
              .map(item => item.trim())
              .filter(item => item !== '')
              .join(' ')
          }

          return baseDescription
        }}
      />
    </div>
  )
}

const AccountDetailView = ({
  adapterKey,
  accountKey,
  accountItemSchema,
  value,
  onChange,
  onChanged,
  onRemoved,
  t
}: {
  adapterKey: string
  accountKey: string
  accountItemSchema?: ConfigUiObjectSchema
  value: Record<string, unknown>
  onChange: (nextValue: Record<string, unknown>) => void
  onChanged: () => Promise<void>
  onRemoved: () => void
  t: TranslationFn
}) => {
  const { message } = App.useApp()
  const {
    consumeResetCredit,
    data,
    isLoading,
    refreshAccountDetail,
    setAccountDetail
  } = useAdapterAccountQuotaDetail({
    adapter: adapterKey,
    account: accountKey
  })
  const [loadingAction, setLoadingAction] = useState<string>()
  const detail = data?.account
  const statusMeta = formatStatus(detail?.status, t)
  const detailActions = detail?.actions ?? []
  const resetCredits = detail?.quota?.rateLimitResetCredits
  const resetCreditDetails = resetCredits?.credits ?? []
  const usableResetCreditDetailCount = resetCreditDetails
    .filter(credit => isUsableAdapterResetCredit(credit))
    .length
  const missingResetCreditDetailCount = Math.max(
    0,
    (resetCredits?.availableCount ?? 0) - usableResetCreditDetailCount
  )
  const quotaMetrics = detail?.quota?.metrics?.filter((metric) => {
    if (typeof metric.value === 'string') return metric.value.trim() !== ''
    return metric.value != null
  }) ?? []
  const normalizedPlanType = normalizeText(detail?.planType)
  const hasMatchingQuotaPlan = normalizedPlanType !== '' && quotaMetrics.some(metric => (
    metric.id === 'plan' &&
    typeof metric.value === 'string' &&
    normalizeText(metric.value) === normalizedPlanType
  ))
  const normalizedEmail = normalizeText(detail?.email)
  const normalizedTitle = normalizeText(detail?.title)
  const sourceLabel = detail?.source?.label?.trim() ?? ''
  const sourceDescription = detail?.source?.description?.trim() ?? ''
  const normalizedSourceLabel = normalizeText(sourceLabel)
  const normalizedSourceDescription = normalizeText(sourceDescription)
  const detailDescription = detail?.description?.trim() ?? ''
  const normalizedDetailDescription = normalizeText(detailDescription)
  const detailMetadata = detail == null
    ? []
    : [
      {
        key: 'email',
        icon: 'mail',
        label: t('config.accounts.facts.email'),
        value: normalizedEmail !== '' && normalizedTitle.includes(normalizedEmail)
          ? undefined
          : detail.email
      },
      {
        key: 'planType',
        icon: 'workspace_premium',
        label: t('config.accounts.facts.plan'),
        value: hasMatchingQuotaPlan ? undefined : detail.planType
      },
      {
        key: 'source',
        icon: 'database',
        label: t('config.accounts.facts.source'),
        value: sourceLabel || sourceDescription,
        description: sourceLabel !== '' &&
            normalizedSourceDescription !== '' &&
            normalizedSourceDescription !== normalizedSourceLabel
          ? sourceDescription
          : undefined
      },
      {
        key: 'description',
        icon: 'notes',
        label: t('config.accounts.facts.description'),
        value: normalizedDetailDescription !== '' &&
            normalizedDetailDescription !== normalizedSourceLabel &&
            normalizedDetailDescription !== normalizedSourceDescription
          ? detailDescription
          : undefined
      }
    ].filter(item => item.value != null && item.value.trim() !== '')

  const handleRunAction = async (action: AdapterAccountActionDescriptor) => {
    setLoadingAction(action.key)
    try {
      const result = await manageAdapterAccount(adapterKey, {
        action: action.key,
        account: accountKey,
        refresh: action.key === 'refresh'
      })
      await onChanged()
      if (action.key === 'remove') {
        void message.success(result.message ?? t('config.accounts.actionSuccess.remove'))
        onRemoved()
        return
      }

      if (result.account != null) {
        await setAccountDetail(result.account)
      } else {
        await refreshAccountDetail()
      }
      void message.success(result.message ?? t(`config.accounts.actionSuccess.${action.key}`))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t(`config.accounts.actionFailed.${action.key}`)))
    } finally {
      setLoadingAction(undefined)
    }
  }

  const handleConsumeResetCredit = async (
    credit?: AdapterAccountRateLimitResetCredit,
    fallbackKey = 'next'
  ) => {
    const loadingKey = `consume-reset-credit:${credit?.id ?? fallbackKey}`
    setLoadingAction(loadingKey)
    let result: AdapterManageAccountResult
    try {
      result = await consumeResetCredit({
        creditId: credit?.id,
        fallbackKey
      })
    } catch (error) {
      void message.error(getApiErrorMessage(
        error,
        t('config.accounts.actionFailed.consumeResetCredit')
      ))
      setLoadingAction(undefined)
      return
    }

    const outcome = getAdapterResetCreditOutcome(result.outcome)
    const resultMessage = outcome == null
      ? result.message ?? t('config.accounts.resetCredits.outcomes.reset')
      : t(`config.accounts.resetCredits.outcomes.${outcome}`, {
        defaultValue: result.message
      })
    const outcomeTone = getAdapterResetCreditOutcomeTone(outcome)
    if (outcomeTone === 'success') {
      void message.success(resultMessage)
    } else if (outcomeTone === 'warning') {
      void message.warning(resultMessage)
    } else {
      void message.info(resultMessage)
    }

    try {
      const refreshResults = await Promise.allSettled([
        onChanged(),
        result.account == null
          ? refreshAccountDetail()
          : setAccountDetail(result.account)
      ])
      if (refreshResults.some(refreshResult => refreshResult.status === 'rejected')) {
        void message.warning(t('config.accounts.resetCredits.refreshFailed'))
      }
    } finally {
      setLoadingAction(undefined)
    }
  }

  const renderResetCreditAction = (
    credit?: AdapterAccountRateLimitResetCredit,
    fallbackKey = 'next'
  ) => {
    const loadingKey = `consume-reset-credit:${credit?.id ?? fallbackKey}`
    const consumeResetCreditPending = loadingAction?.startsWith('consume-reset-credit:') === true
    const disabled = resetCredits?.canConsume !== true ||
      (resetCredits?.availableCount ?? 0) <= 0 ||
      consumeResetCreditPending ||
      (credit != null && !isUsableAdapterResetCredit(credit))
    const actionLabel = t('config.accounts.resetCredits.use')

    return (
      <Tooltip
        title={disabled
          ? t('config.accounts.resetCredits.unavailable')
          : actionLabel}
      >
        <span className='adapter-account-manager__reset-credit-action-wrap'>
          <Popconfirm
            title={t('config.accounts.resetCredits.confirmTitle')}
            description={t('config.accounts.resetCredits.confirmDescription')}
            okText={t('config.accounts.resetCredits.confirmAction')}
            cancelText={t('common.cancel')}
            disabled={disabled}
            onConfirm={() => handleConsumeResetCredit(credit, fallbackKey)}
          >
            <InlineActionButton
              aria-label={actionLabel}
              className='adapter-account-manager__reset-credit-action'
              disabled={disabled}
              loading={loadingAction === loadingKey}
              icon='restart_alt'
            />
          </Popconfirm>
        </span>
      </Tooltip>
    )
  }

  return (
    <div className='adapter-account-manager__detail'>
      {isLoading && (
        <div className='adapter-account-manager__state'>
          <Spin size='small' />
        </div>
      )}

      {!isLoading && detail == null && (
        <Empty image={null} description={t('config.accounts.detailMissing')} />
      )}

      {detail != null && (
        <div className='adapter-account-manager__detail-body'>
          <div className='adapter-account-manager__hero'>
            <div className='adapter-account-manager__hero-body'>
              <div className='adapter-account-manager__hero-title-row'>
                <div className='adapter-account-manager__hero-title'>{detail.title}</div>
                <div className='adapter-account-manager__hero-meta'>
                  <div className='adapter-account-manager__hero-badges'>
                    <IconTag
                      color={statusMeta.color}
                      icon={statusMeta.icon}
                      label={statusMeta.label}
                    />
                    {detail.isDefault === true && (
                      <IconTag
                        icon='star'
                        label={t('config.accounts.default')}
                      />
                    )}
                  </div>
                  {detailActions.length > 0 && (
                    <AccountActionButtons
                      actions={detailActions}
                      loadingAction={loadingAction}
                      onRunAction={handleRunAction}
                      t={t}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {detailMetadata.length > 0 && (
            <dl className='adapter-account-manager__metadata'>
              {detailMetadata.map(item => (
                <div key={item.key} className='adapter-account-manager__metadata-item'>
                  <span className='material-symbols-rounded adapter-account-manager__metadata-icon' aria-hidden='true'>
                    {item.icon}
                  </span>
                  <dt className='adapter-account-manager__metadata-label'>{item.label}</dt>
                  <dd className='adapter-account-manager__metadata-value'>
                    <span>{item.value}</span>
                    {item.description != null &&
                      item.description.trim() !== '' &&
                      item.description !== item.value && (
                        <span className='adapter-account-manager__metadata-description'>
                          {item.description}
                        </span>
                      )}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {(quotaMetrics.length > 0 || resetCredits != null) && (
            <div className='adapter-account-manager__section'>
              <div className='adapter-account-manager__section-title'>
                <span className='material-symbols-rounded'>query_stats</span>
                <span>{t('config.accounts.quotaTitle', { defaultValue: 'Quota' })}</span>
              </div>
              {quotaMetrics.length > 0 && (
                <div className='adapter-account-manager__metrics'>
                  {quotaMetrics.map(metric => (
                    <div key={metric.id} className='adapter-account-manager__metric'>
                      <div className='adapter-account-manager__metric-label'>
                        {metric.label}
                      </div>
                      <div className='adapter-account-manager__metric-value'>
                        {metric.value ?? '-'}
                        <QuotaUsageRing value={metric.value} />
                      </div>
                      {metric.description != null && metric.description.trim() !== '' && (
                        <div className='adapter-account-manager__metric-description'>{metric.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {resetCredits != null && (
                <div className='adapter-account-manager__reset-credits'>
                  <div className='adapter-account-manager__reset-credits-heading'>
                    <div className='adapter-account-manager__section-title'>
                      <span className='material-symbols-rounded' aria-hidden='true'>
                        confirmation_number
                      </span>
                      <span>{t('config.accounts.resetCredits.title')}</span>
                    </div>
                    <span className='adapter-account-manager__muted'>
                      {t('config.accounts.resetCredits.available', {
                        count: resetCredits.availableCount
                      })}
                    </span>
                  </div>

                  <div
                    className={'adapter-account-manager__reset-credit-list ' +
                      'config-view__field-list config-view__field-list--grouped'}
                  >
                    {resetCreditDetails.length === 0 && missingResetCreditDetailCount === 0 && (
                      <div className='adapter-account-manager__reset-credit-empty'>
                        {t('config.accounts.resetCredits.noCredits')}
                      </div>
                    )}
                    {resetCreditDetails.map((credit, index) => {
                      const grantedAt = formatEpochSeconds(credit.grantedAt)
                      const expiresAt = formatEpochSeconds(credit.expiresAt)
                      const remaining = formatResetCreditRemaining(credit.expiresAt, t)
                      const timeDetails = [
                        {
                          key: 'grantedAt',
                          label: t('config.accounts.resetCredits.fields.grantedAt'),
                          value: grantedAt
                        },
                        {
                          key: 'expiresAt',
                          label: t('config.accounts.resetCredits.fields.expiresAt'),
                          value: expiresAt
                        }
                      ].filter((item): item is typeof item & { value: string } => (
                        item.value != null && item.value !== ''
                      ))

                      return (
                        <FieldRow
                          key={credit.id}
                          icon='restart_alt'
                          title={getResetCreditTitle(credit, index, t)}
                        >
                          <div className='adapter-account-manager__reset-credit-control'>
                            {remaining != null && (
                              <Tooltip
                                placement='top'
                                title={timeDetails.length > 0
                                  ? (
                                    <div className='adapter-account-manager__tooltip'>
                                      {timeDetails.map(item => (
                                        <div
                                          key={item.key}
                                          className='adapter-account-manager__reset-credit-tooltip-row'
                                        >
                                          <span className='adapter-account-manager__tooltip-title'>
                                            {item.label}
                                          </span>
                                          <span className='adapter-account-manager__tooltip-description'>
                                            {item.value}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )
                                  : undefined}
                                trigger={['hover', 'focus']}
                              >
                                <span
                                  aria-label={remaining}
                                  className='adapter-account-manager__reset-credit-remaining'
                                  tabIndex={timeDetails.length > 0 ? 0 : undefined}
                                >
                                  {remaining}
                                </span>
                              </Tooltip>
                            )}
                            {renderResetCreditAction(credit)}
                          </div>
                        </FieldRow>
                      )
                    })}
                    {Array.from({ length: missingResetCreditDetailCount }, (_, index) => (
                      <FieldRow
                        key={`pending-reset-credit-${index}`}
                        icon='confirmation_number'
                        title={t('config.accounts.resetCredits.fullResetTitle')}
                        description={t('config.accounts.resetCredits.summaryDescription')}
                      >
                        {renderResetCreditAction(undefined, `next-${index}`)}
                      </FieldRow>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <Collapse
            className='adapter-account-manager__usage'
            expandIconPosition='end'
            ghost
            items={[{
              key: 'usage',
              label: (
                <span className='adapter-account-manager__section-title'>
                  <span className='material-symbols-rounded' aria-hidden='true'>data_usage</span>
                  <span>{t('usage.title')}</span>
                </span>
              ),
              children: (
                <UsagePanel
                  key={`account-usage:${adapterKey}:${accountKey}`}
                  initialFilters={{ account: accountKey, tool: adapterKey }}
                  lockedFilters={['account', 'tool']}
                  surface='workspace'
                  variant='embedded'
                />
              )
            }]}
          />

          <AccountEditor
            adapterKey={adapterKey}
            accountKey={accountKey}
            accountItemSchema={accountItemSchema}
            value={value}
            onChange={onChange}
            t={t}
          />
        </div>
      )}
    </div>
  )
}

const AccountsOverviewCard = ({
  accounts,
  loading,
  onOpenAccounts,
  t
}: {
  accounts: AdapterAccountInfo[]
  loading?: boolean
  onOpenAccounts: () => void
  t: TranslationFn
}) => {
  const readyCount = accounts.filter(account => account.status !== 'missing' && account.status !== 'error').length
  const defaultAccount = accounts.find(account => account.isDefault === true)

  return (
    <div className='adapter-account-manager__overview'>
      <button
        type='button'
        className='adapter-account-manager__overview-card config-view__field-row'
        onClick={onOpenAccounts}
      >
        <div className='config-view__field-meta'>
          <span className='material-symbols-rounded config-view__field-icon'>manage_accounts</span>
          <div className='config-view__field-text'>
            <div className='config-view__field-title'>{t('config.accounts.title')}</div>
            <div className='config-view__field-desc adapter-account-manager__overview-meta'>
              {loading === true && accounts.length === 0
                ? (
                  <span>{t('config.accounts.loading')}</span>
                )
                : (
                  <>
                    <span>{t('config.accounts.count', { count: accounts.length })}</span>
                    <span>{t('config.accounts.readyCount', { count: readyCount })}</span>
                  </>
                )}
              {loading !== true && defaultAccount != null && (
                <span>{t('config.accounts.defaultHint', { account: defaultAccount.title })}</span>
              )}
            </div>
          </div>
        </div>
        <div className='config-view__field-control adapter-account-manager__overview-control'>
          <span className='material-symbols-rounded adapter-account-manager__overview-arrow'>chevron_right</span>
        </div>
      </button>
    </div>
  )
}

const AccountsListView = ({
  accounts,
  actions,
  loadingAction,
  onOpenAccount,
  onRunAction,
  currentDefaultAccount,
  deletingAccountKey,
  onToggleDefaultAccount,
  onDeleteAccount,
  t
}: {
  accounts: AdapterAccountInfo[]
  actions: AdapterAccountActionDescriptor[]
  loadingAction?: string
  onOpenAccount: (accountKey: string) => void
  onRunAction: (action: AdapterAccountActionDescriptor) => void
  currentDefaultAccount?: string
  deletingAccountKey?: string
  onToggleDefaultAccount: (accountKey: string) => void
  onDeleteAccount: (accountKey: string) => Promise<void>
  t: TranslationFn
}) => {
  const [searchValue, setSearchValue] = useState('')
  const normalizedSearch = normalizeText(searchValue)
  const addAction = actions.find(action => action.key === 'add')
  const filteredAccounts = useMemo(() => {
    if (normalizedSearch === '') return accounts
    return accounts.filter(account => {
      const haystacks = [
        account.title,
        account.key,
        account.description,
        account.quota?.summary
      ]
      return haystacks.some(value => normalizeText(value).includes(normalizedSearch))
    })
  }, [accounts, normalizedSearch])

  return (
    <div className='adapter-account-manager'>
      <div className='adapter-account-manager__header'>
        <Input
          allowClear
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          className='adapter-account-manager__search'
          placeholder={t('config.accounts.searchPlaceholder', { defaultValue: 'Search accounts' })}
          prefix={<span className='material-symbols-rounded'>search</span>}
        />
        {addAction != null && (
          <Tooltip
            title={renderTooltipContent(getActionLabel(addAction, t), getActionDescription(addAction, t))}
          >
            <Button
              size='small'
              type='default'
              loading={loadingAction === addAction.key}
              aria-label={getActionLabel(addAction, t)}
              className='adapter-account-manager__icon-button adapter-account-manager__header-action'
              icon={<span className='material-symbols-rounded'>{ACCOUNT_ACTION_ICON[addAction.key]}</span>}
              onClick={() => onRunAction(addAction)}
            />
          </Tooltip>
        )}
      </div>

      {filteredAccounts.length === 0 && (
        <Empty
          image={null}
          description={accounts.length === 0
            ? t('config.accounts.empty')
            : t('config.accounts.searchEmpty', { defaultValue: 'No matching accounts' })}
        />
      )}

      {filteredAccounts.length > 0 && (
        <div className='adapter-account-manager__list'>
          {filteredAccounts.map((account) => {
            const isDefault = currentDefaultAccount === account.key || account.isDefault === true
            const showDeleteAction = account.status !== 'missing'

            return (
              <div key={account.key} className='adapter-account-manager__item'>
                <button
                  type='button'
                  className='adapter-account-manager__item-trigger'
                  onClick={() => onOpenAccount(account.key)}
                >
                  <div className='adapter-account-manager__item-main'>
                    <div className='adapter-account-manager__item-title'>{account.title}</div>
                    {account.quota?.summary != null && account.quota.summary !== '' && (
                      <div className='adapter-account-manager__item-description'>
                        <span className='material-symbols-rounded'>speed</span>
                        <span>{account.quota.summary}</span>
                      </div>
                    )}
                  </div>
                </button>
                <div className='adapter-account-manager__item-actions'>
                  <Tooltip
                    title={isDefault
                      ? t('config.accounts.rowActions.clearDefault', { defaultValue: 'Clear default account' })
                      : t('config.accounts.rowActions.setDefault', { defaultValue: 'Set as default account' })}
                  >
                    <Button
                      type='text'
                      size='small'
                      aria-label={isDefault
                        ? t('config.accounts.rowActions.clearDefault', { defaultValue: 'Clear default account' })
                        : t('config.accounts.rowActions.setDefault', { defaultValue: 'Set as default account' })}
                      className={`adapter-account-manager__row-action ${
                        isDefault ? 'adapter-account-manager__row-action--active' : ''
                      }`}
                      icon={<span className='material-symbols-rounded'>star</span>}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleDefaultAccount(account.key)
                      }}
                    />
                  </Tooltip>
                  {showDeleteAction && (
                    <Popconfirm
                      title={t('config.accounts.deleteConfirmTitle', {
                        defaultValue: 'Delete the stored snapshot for {{account}}?',
                        account: account.title
                      })}
                      okText={t('common.confirm')}
                      cancelText={t('common.cancel')}
                      onConfirm={async (event) => {
                        event?.stopPropagation?.()
                        await onDeleteAccount(account.key)
                      }}
                    >
                      <Button
                        type='text'
                        size='small'
                        danger
                        loading={deletingAccountKey === account.key}
                        aria-label={t('config.accounts.rowActions.delete', { defaultValue: 'Delete account snapshot' })}
                        className='adapter-account-manager__row-action'
                        icon={<span className='material-symbols-rounded'>delete</span>}
                        onClick={(event) => {
                          event.stopPropagation()
                        }}
                      />
                    </Popconfirm>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const AdapterAccountsManager = ({
  adapterKey,
  value,
  accountsData,
  accountItemSchema,
  nestedPath = [],
  onChange,
  onOpenNestedPath,
  t
}: {
  adapterKey: string
  value: Record<string, unknown>
  accountsData?: AdapterAccountsResult
  accountItemSchema?: ConfigUiObjectSchema
  nestedPath?: string[]
  onChange: (nextValue: Record<string, unknown>) => void
  onOpenNestedPath: (nextPath: string[]) => void
  t: TranslationFn
}) => {
  const { message } = App.useApp()
  const { mutate: mutateCache } = useSWRConfig()
  const configuredDefaultAccount = typeof value.defaultAccount === 'string' && value.defaultAccount.trim() !== ''
    ? value.defaultAccount.trim()
    : undefined
  const accountsCacheKey = `/api/adapters/${adapterKey}/accounts`
  const { data: localAccountsData, isLoading } = useSWR(
    accountsData == null ? accountsCacheKey : null,
    () => getAdapterAccounts(adapterKey),
    {
      dedupingInterval: 30_000,
      keepPreviousData: true,
      revalidateOnFocus: false
    }
  )
  const [loadingAction, setLoadingAction] = useState<string>()
  const [deletingAccountKey, setDeletingAccountKey] = useState<string>()
  const resolvedAccountsData = accountsData ?? localAccountsData
  const configuredAccounts = useMemo(() => getConfiguredAccounts(value), [value])
  const accounts = useMemo(
    () => mergeAccounts(configuredAccounts, resolvedAccountsData?.accounts ?? [], configuredDefaultAccount),
    [configuredAccounts, configuredDefaultAccount, resolvedAccountsData?.accounts]
  )
  const actionDescriptors = resolvedAccountsData?.actions ?? []
  const isAccountsView = nestedPath[0] === 'accounts'
  const activeAccountKey = isAccountsView ? nestedPath[1] : undefined

  const refreshAccounts = async () => {
    await mutateCache(accountsCacheKey, getAdapterAccounts(adapterKey), {
      populateCache: true,
      revalidate: false
    })
  }

  const handleToggleDefaultAccount = (accountKey: string) => {
    const nextValue = { ...value }
    if (configuredDefaultAccount === accountKey) {
      delete nextValue.defaultAccount
    } else {
      nextValue.defaultAccount = accountKey
    }
    onChange(nextValue)
  }

  const handleRunListAction = async (action: AdapterAccountActionDescriptor) => {
    if (action.key !== 'add') return

    setLoadingAction(action.key)
    try {
      const result = await manageAdapterAccount(adapterKey, { action: 'add' })
      await refreshAccounts()
      void message.success(result.message ?? t('config.accounts.actionSuccess.add'))
      if (result.accountKey != null && result.accountKey.trim() !== '') {
        onOpenNestedPath(['accounts', result.accountKey])
      } else {
        onOpenNestedPath(['accounts'])
      }
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('config.accounts.actionFailed.add')))
    } finally {
      setLoadingAction(undefined)
    }
  }

  const handleDeleteAccount = async (accountKey: string) => {
    setDeletingAccountKey(accountKey)
    try {
      const result = await manageAdapterAccount(adapterKey, {
        action: 'remove',
        account: accountKey,
        refresh: true
      })
      await refreshAccounts()
      void message.success(result.message ?? t('config.accounts.actionSuccess.remove'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('config.accounts.actionFailed.remove')))
    } finally {
      setDeletingAccountKey(undefined)
    }
  }

  if (isLoading && accounts.length === 0) {
    return (
      <div className='adapter-account-manager__state'>
        <Spin size='small' />
      </div>
    )
  }

  if (isAccountsView && activeAccountKey != null && activeAccountKey !== '') {
    return (
      <AccountDetailView
        adapterKey={adapterKey}
        accountKey={activeAccountKey}
        accountItemSchema={accountItemSchema}
        value={value}
        onChange={onChange}
        onChanged={refreshAccounts}
        onRemoved={() => onOpenNestedPath(['accounts'])}
        t={t}
      />
    )
  }

  if (isAccountsView) {
    return (
      <AccountsListView
        accounts={accounts}
        actions={actionDescriptors}
        loadingAction={loadingAction}
        onOpenAccount={(accountKey) => onOpenNestedPath(['accounts', accountKey])}
        onRunAction={handleRunListAction}
        currentDefaultAccount={configuredDefaultAccount}
        deletingAccountKey={deletingAccountKey}
        onToggleDefaultAccount={handleToggleDefaultAccount}
        onDeleteAccount={handleDeleteAccount}
        t={t}
      />
    )
  }

  return (
    <AccountsOverviewCard
      accounts={accounts}
      loading={isLoading && resolvedAccountsData == null}
      onOpenAccounts={() => onOpenNestedPath(['accounts'])}
      t={t}
    />
  )
}
