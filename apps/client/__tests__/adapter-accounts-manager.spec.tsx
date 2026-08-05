import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterAccountRateLimitResetCredits } from '@oneworks/types'

const testState = vi.hoisted(() => ({
  detailFetcher: undefined as undefined | (() => Promise<unknown>),
  createAdapterAccountOperationId: vi.fn(),
  getAdapterAccountDetail: vi.fn(),
  manageAdapterAccount: vi.fn(),
  messageError: vi.fn(),
  messageInfo: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  mutate: vi.fn(),
  mutateCache: vi.fn(),
  popconfirmOnConfirms: [] as Array<() => Promise<void> | void>,
  resetCredits: undefined as AdapterAccountRateLimitResetCredits | undefined,
  tooltipTitles: [] as ReactNode[],
  tooltipTriggers: [] as Array<string | string[] | undefined>
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: testState.messageError,
        info: testState.messageInfo,
        success: testState.messageSuccess,
        warning: testState.messageWarning
      }
    })
  },
  Button: ({
    'aria-label': ariaLabel,
    children,
    disabled,
    icon
  }: {
    'aria-label'?: string
    children?: ReactNode
    disabled?: boolean
    icon?: ReactNode
  }) => (
    <button type='button' aria-label={ariaLabel} disabled={disabled}>{icon}{children}</button>
  ),
  Collapse: ({ className, items }: {
    className?: string
    items?: Array<{ key: string; label?: ReactNode }>
  }) => (
    <div className={className}>
      {items?.map(item => <div key={item.key}>{item.label}</div>)}
    </div>
  ),
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
  Input: () => <input readOnly />,
  Popconfirm: ({
    children,
    onConfirm
  }: {
    children?: ReactNode
    onConfirm?: () => Promise<void> | void
  }) => {
    if (onConfirm != null) {
      testState.popconfirmOnConfirms.push(onConfirm)
    }
    return <>{children}</>
  },
  Spin: () => <span>loading</span>,
  Tooltip: ({
    children,
    title,
    trigger
  }: {
    children?: ReactNode
    title?: ReactNode
    trigger?: string | string[]
  }) => {
    testState.tooltipTitles.push(title)
    testState.tooltipTriggers.push(trigger)
    return <>{children}</>
  }
}))

vi.mock('swr', () => ({
  default: (key: readonly string[] | string | null, fetcher: () => Promise<unknown>) => {
    if (Array.isArray(key) && key[0] === '/api/adapters/account-quota' && key[2] === 'work') {
      testState.detailFetcher = fetcher
      return {
        data: {
          account: {
            key: 'work',
            title: 'yijie4188@gmail.com · Personal',
            status: 'ready',
            email: 'yijie4188@gmail.com',
            accountType: 'chatgpt',
            planType: 'pro',
            source: {
              label: 'Codex Home',
              description: 'Read from ~/.codex/auth.json'
            },
            description: 'Read from ~/.codex/auth.json',
            quota: {
              summary: 'Pro · 5h 48% · 7d 8%',
              metrics: [
                {
                  id: 'plan',
                  label: 'Plan',
                  value: 'Pro',
                  primary: true
                },
                {
                  id: 'primary-usage',
                  label: '5h used',
                  value: '48%',
                  description: 'Resets 2026-07-10 16:14'
                },
                {
                  id: 'secondary-usage',
                  label: '7d used',
                  value: '8%',
                  description: 'Resets 2026-07-17 05:42'
                },
                {
                  id: 'codex-bengalfox-primary-usage',
                  label: 'GPT-5.3-Codex-Spark · 7d used',
                  value: '0%',
                  description: 'Resets 2026-07-17 08:30'
                }
              ],
              rateLimitResetCredits: testState.resetCredits
            },
            actions: [
              {
                key: 'refresh',
                label: 'Refresh quota',
                description: 'Refresh the latest quota.',
                scope: 'account'
              }
            ]
          }
        },
        error: undefined,
        isLoading: false,
        isValidating: false,
        mutate: testState.mutate
      }
    }

    return {
      data: undefined,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn()
    }
  },
  useSWRConfig: () => ({ mutate: testState.mutateCache })
}))

vi.mock('#~/api', () => ({
  createAdapterAccountOperationId: testState.createAdapterAccountOperationId,
  getAdapterAccountDetail: testState.getAdapterAccountDetail,
  getAdapterAccounts: vi.fn(),
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  manageAdapterAccount: testState.manageAdapterAccount
}))

vi.mock('#~/components/config/record-editors/SchemaObjectEditor', () => ({
  SchemaObjectEditor: () => <div data-testid='account-editor' />
}))

const translations: Record<string, string> = {
  'config.accounts.actions.refresh.label': '刷新额度',
  'config.accounts.facts.description': '说明',
  'config.accounts.facts.email': '邮箱',
  'config.accounts.facts.key': '账号 Key',
  'config.accounts.facts.plan': '套餐',
  'config.accounts.facts.source': '来源',
  'config.accounts.facts.type': '类型',
  'config.accounts.quotaTitle': '额度',
  'config.accounts.resetCredits.available': '2 张可用',
  'config.accounts.resetCredits.confirmAction': '确认使用',
  'config.accounts.resetCredits.confirmDescription': '确认后会消耗一张重置卡。',
  'config.accounts.resetCredits.confirmTitle': '使用一张额度重置卡？',
  'config.accounts.resetCredits.fields.expiresAt': '到期时间',
  'config.accounts.resetCredits.fields.grantedAt': '获得时间',
  'config.accounts.resetCredits.fullResetTitle': '完整额度重置',
  'config.accounts.resetCredits.remaining.days': '剩余 {{count}} 天',
  'config.accounts.resetCredits.remaining.daysHours': '剩余 {{days}} 天 {{hours}} 小时',
  'config.accounts.resetCredits.remaining.expired': '已过期',
  'config.accounts.resetCredits.remaining.hours': '剩余 {{count}} 小时',
  'config.accounts.resetCredits.summaryDescription': '用于重置符合条件的 Codex 额度窗口。',
  'config.accounts.resetCredits.title': '额度重置卡',
  'config.accounts.resetCredits.unavailable': '这张额度重置卡当前不可用',
  'config.accounts.resetCredits.use': '使用重置卡',
  'config.accounts.status.ready': '可用'
}

const t = (key: string, options?: Record<string, unknown> & { defaultValue?: string }) => (
  translations[key] ?? options?.defaultValue ?? key
)

describe('adapter accounts manager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T00:00:00Z'))
    testState.detailFetcher = undefined
    testState.createAdapterAccountOperationId.mockReset()
    testState.createAdapterAccountOperationId.mockReturnValue('operation-id')
    testState.getAdapterAccountDetail.mockReset()
    testState.manageAdapterAccount.mockReset()
    testState.messageError.mockReset()
    testState.messageInfo.mockReset()
    testState.messageSuccess.mockReset()
    testState.messageWarning.mockReset()
    testState.mutate.mockReset()
    testState.mutateCache.mockReset()
    testState.mutateCache.mockResolvedValue(undefined)
    testState.popconfirmOnConfirms = []
    testState.tooltipTitles = []
    testState.tooltipTriggers = []
    testState.resetCredits = {
      availableCount: 2,
      canConsume: true,
      credits: [
        {
          id: 'credit-a',
          resetType: 'codexRateLimits',
          status: 'available',
          title: 'Full reset',
          grantedAt: 1785200000,
          expiresAt: 1786500000
        },
        {
          id: 'credit-b',
          resetType: 'codexRateLimits',
          status: 'available',
          title: 'Full reset',
          grantedAt: 1785600000,
          expiresAt: 1786900000
        }
      ]
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads and displays the selected account quota', async () => {
    const { AdapterAccountsManager } = await import('#~/components/config/AdapterAccountsManager')
    const html = renderToStaticMarkup(
      <AdapterAccountsManager
        adapterKey='codex'
        value={{ accounts: { work: {} } }}
        accountsData={{ accounts: [], actions: [] }}
        nestedPath={['accounts', 'work']}
        onChange={vi.fn()}
        onOpenNestedPath={vi.fn()}
        t={t}
      />
    )

    expect(html).toContain('额度')
    expect(html).toContain('5h used')
    expect(html).toContain('48%')
    expect(html).toContain('7d used')
    expect(html).toContain('8%')
    expect(html).toContain('GPT-5.3-Codex-Spark · 7d used')
    expect(html).toContain('额度重置卡')
    expect(html).toContain('2 张可用')
    expect(html.match(/完整额度重置/g)).toHaveLength(2)
    expect(html).toContain('config-view__field-list--grouped')
    expect(html).toContain('config-view__field-row')
    expect(html.match(/adapter-account-manager__reset-credit-control/g)).toHaveLength(2)
    expect(html.match(/adapter-account-manager__reset-credit-remaining/g)).toHaveLength(2)
    expect(html).toContain('剩余')
    expect(html).not.toContain('adapter-account-manager__reset-credit-details')
    expect(html).not.toContain('>获得时间</span>')
    expect(html).not.toContain('>到期时间</span>')
    expect(html.match(/aria-label="使用重置卡"/g)).toHaveLength(2)
    const firstControlIndex = html.indexOf('adapter-account-manager__reset-credit-control')
    const firstRemainingIndex = html.indexOf(
      'adapter-account-manager__reset-credit-remaining',
      firstControlIndex
    )
    const firstActionIndex = html.indexOf(
      'adapter-account-manager__reset-credit-action-wrap',
      firstControlIndex
    )
    expect(firstRemainingIndex).toBeGreaterThan(firstControlIndex)
    expect(firstRemainingIndex).toBeLessThan(firstActionIndex)
    const tooltipHtml = testState.tooltipTitles
      .filter((title): title is ReactNode => title != null && title !== false)
      .map(title => renderToStaticMarkup(<>{title}</>))
      .join('')
    expect(tooltipHtml).toContain('adapter-account-manager__reset-credit-tooltip-row')
    expect(tooltipHtml).toContain('>获得时间</span>')
    expect(tooltipHtml).toContain('>到期时间</span>')
    expect(testState.tooltipTriggers).toContainEqual(['hover', 'focus'])
    expect(html).not.toContain('>状态</span>')
    expect(html).not.toContain('>适用额度</span>')
    expect(html).not.toContain('可用 · Codex 额度')
    expect(html).not.toContain('adapter-account-manager__reset-credit-status')
    expect(html).not.toContain('adapter-account-manager__reset-credit-icon')
    expect(html).toContain('adapter-account-manager__metadata')
    expect(html).not.toContain('账号 Key')
    expect(html).not.toContain('类型')
    expect(html).not.toContain('adapter-account-manager__metadata-label">邮箱')
    expect(html).not.toContain('adapter-account-manager__metadata-label">套餐')
    expect(html).not.toContain('adapter-account-manager__metadata-label">说明')
    expect(html.match(/Read from ~\/\.codex\/auth\.json/g)).toHaveLength(1)
    expect(html).toContain('adapter-account-manager__metric-value">Pro')
    expect(html).toContain('aria-label="刷新额度"')

    testState.getAdapterAccountDetail.mockResolvedValue({ account: { key: 'work' } })
    await expect(testState.detailFetcher?.()).resolves.toEqual({ account: { key: 'work' } })
    expect(testState.getAdapterAccountDetail).toHaveBeenCalledWith('codex', 'work', { refresh: true })
  })

  it('renders one fallback row per available reset credit while details recover', async () => {
    testState.resetCredits = {
      availableCount: 2,
      canConsume: true
    }
    const { AdapterAccountsManager } = await import('#~/components/config/AdapterAccountsManager')
    const html = renderToStaticMarkup(
      <AdapterAccountsManager
        adapterKey='codex'
        value={{ accounts: { work: {} } }}
        accountsData={{ accounts: [], actions: [] }}
        nestedPath={['accounts', 'work']}
        onChange={vi.fn()}
        onOpenNestedPath={vi.fn()}
        t={t}
      />
    )

    expect(html).toContain('2 张可用')
    expect(html.match(/完整额度重置/g)).toHaveLength(2)
    expect(html.match(/aria-label="使用重置卡"/g)).toHaveLength(2)
    expect(html.match(/用于重置符合条件的 Codex 额度窗口。/g)).toHaveLength(2)
  })

  it('replaces terminal detailed credits with anonymous usable fallback rows', async () => {
    testState.resetCredits = {
      availableCount: 1,
      canConsume: true,
      credits: [
        {
          id: 'credit-redeemed',
          status: 'redeemed',
          title: 'Redeemed credit',
          expiresAt: 1786500000
        }
      ]
    }
    const { AdapterAccountsManager } = await import('#~/components/config/AdapterAccountsManager')
    const html = renderToStaticMarkup(
      <AdapterAccountsManager
        adapterKey='codex'
        value={{ accounts: { work: {} } }}
        accountsData={{ accounts: [], actions: [] }}
        nestedPath={['accounts', 'work']}
        onChange={vi.fn()}
        onOpenNestedPath={vi.fn()}
        t={t}
      />
    )

    expect(html).toContain('Redeemed credit')
    expect(html.match(/完整额度重置/g)).toHaveLength(1)
    expect(html.match(/aria-label="使用重置卡"/g)).toHaveLength(2)
    expect(html.match(/disabled=""/g)).toHaveLength(1)
    expect(html.match(/用于重置符合条件的 Codex 额度窗口。/g)).toHaveLength(1)
  })

  it('shows the empty state only when the available count and detail list are both empty', async () => {
    testState.resetCredits = {
      availableCount: 0,
      canConsume: true
    }
    const { AdapterAccountsManager } = await import('#~/components/config/AdapterAccountsManager')
    const html = renderToStaticMarkup(
      <AdapterAccountsManager
        adapterKey='codex'
        value={{ accounts: { work: {} } }}
        accountsData={{ accounts: [], actions: [] }}
        nestedPath={['accounts', 'work']}
        onChange={vi.fn()}
        onOpenNestedPath={vi.fn()}
        t={t}
      />
    )

    expect(html).toContain('config.accounts.resetCredits.noCredits')
    expect(html).not.toContain('config.accounts.resetCredits.summaryDescription')
    expect(html).not.toContain('aria-label="使用重置卡"')
  })

  it('reports a definite consume outcome even when the post-action refresh fails', async () => {
    testState.resetCredits = {
      availableCount: 1,
      canConsume: true,
      credits: [
        {
          id: 'credit-outcome',
          status: 'available',
          title: 'Full reset',
          expiresAt: 1786500000
        }
      ]
    }
    testState.manageAdapterAccount.mockResolvedValue({
      outcome: 'alreadyRedeemed',
      account: {
        key: 'work',
        title: 'Work'
      }
    })
    testState.mutate.mockRejectedValueOnce(new Error('refresh failed'))
    const { AdapterAccountsManager } = await import('#~/components/config/AdapterAccountsManager')
    renderToStaticMarkup(
      <AdapterAccountsManager
        adapterKey='codex'
        value={{ accounts: { work: {} } }}
        accountsData={{ accounts: [], actions: [] }}
        nestedPath={['accounts', 'work']}
        onChange={vi.fn()}
        onOpenNestedPath={vi.fn()}
        t={t}
      />
    )

    await testState.popconfirmOnConfirms[0]?.()

    expect(testState.manageAdapterAccount).toHaveBeenCalledWith('codex', {
      action: 'consume-reset-credit',
      account: 'work',
      creditId: 'credit-outcome',
      operationId: 'operation-id'
    })
    expect(testState.messageInfo).toHaveBeenCalledWith(
      'config.accounts.resetCredits.outcomes.alreadyRedeemed'
    )
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.messageWarning).toHaveBeenCalledWith(
      'config.accounts.resetCredits.refreshFailed'
    )
  })

  it('reports reset completion separately from a rejected quota refresh', async () => {
    testState.resetCredits = {
      availableCount: 1,
      canConsume: true,
      credits: [
        {
          id: 'credit-reset',
          status: 'available',
          title: 'Full reset',
          expiresAt: 1786500000
        }
      ]
    }
    testState.manageAdapterAccount.mockResolvedValue({
      outcome: 'reset',
      account: {
        key: 'work',
        title: 'Work'
      }
    })
    testState.mutate.mockRejectedValueOnce(new Error('refresh failed'))
    const { AdapterAccountsManager } = await import('#~/components/config/AdapterAccountsManager')
    renderToStaticMarkup(
      <AdapterAccountsManager
        adapterKey='codex'
        value={{ accounts: { work: {} } }}
        accountsData={{ accounts: [], actions: [] }}
        nestedPath={['accounts', 'work']}
        onChange={vi.fn()}
        onOpenNestedPath={vi.fn()}
        t={t}
      />
    )

    await testState.popconfirmOnConfirms[0]?.()

    expect(testState.messageSuccess).toHaveBeenCalledWith(
      'config.accounts.resetCredits.outcomes.reset'
    )
    expect(testState.messageWarning).toHaveBeenCalledWith(
      'config.accounts.resetCredits.refreshFailed'
    )
    expect(testState.messageError).not.toHaveBeenCalled()
  })
})
