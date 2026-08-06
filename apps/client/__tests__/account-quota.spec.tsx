import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountAvatar } from '#~/components/chat/sender/@components/account-select/AccountAvatar'
import { AccountQuotaIndicators } from '#~/components/chat/sender/@components/account-select/AccountQuotaIndicators'
import { AccountQuotaModalBody } from '#~/components/chat/sender/@components/account-select/AccountQuotaModal'
import {
  getAdapterResetCreditOutcome,
  getAdapterResetCreditOutcomeTone,
  useAdapterAccountQuotaDetail
} from '#~/hooks/use-adapter-account-quota-detail'
import { useAdapterAccountsWithQuota } from '#~/hooks/use-adapter-accounts-with-quota'
import { getAccountQuotaWindows, parseQuotaPercent } from '#~/utils/account-quota'

const {
  createAdapterAccountOperationIdMock,
  getAdapterAccountDetailMock,
  getAdapterAccountsMock,
  manageAdapterAccountMock,
  messageErrorMock,
  messageInfoMock,
  messageSuccessMock,
  messageWarningMock,
  mutateMock,
  popconfirmOnConfirms,
  useSWRConfigMutateMock,
  useSWRMock
} = vi.hoisted(() => ({
  createAdapterAccountOperationIdMock: vi.fn(),
  getAdapterAccountDetailMock: vi.fn(),
  getAdapterAccountsMock: vi.fn(),
  manageAdapterAccountMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageInfoMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  messageWarningMock: vi.fn(),
  mutateMock: vi.fn(),
  popconfirmOnConfirms: [] as Array<() => Promise<void> | void>,
  useSWRConfigMutateMock: vi.fn(),
  useSWRMock: vi.fn()
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: messageErrorMock,
        info: messageInfoMock,
        success: messageSuccessMock,
        warning: messageWarningMock
      }
    })
  },
  Button: ({
    'aria-label': ariaLabel,
    children,
    icon
  }: {
    'aria-label'?: string
    children?: ReactNode
    icon?: ReactNode
  }) => <button type='button' aria-label={ariaLabel}>{icon}{children}</button>,
  Modal: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Popconfirm: ({
    children,
    onConfirm
  }: {
    children?: ReactNode
    onConfirm?: () => Promise<void> | void
  }) => {
    if (onConfirm != null) {
      popconfirmOnConfirms.push(onConfirm)
    }
    return <>{children}</>
  },
  Spin: () => <span>loading</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('swr', () => ({
  default: useSWRMock,
  useSWRConfig: () => ({ mutate: useSWRConfigMutateMock })
}))

vi.mock('#~/api', () => ({
  createAdapterAccountOperationId: createAdapterAccountOperationIdMock,
  getAdapterAccountDetail: getAdapterAccountDetailMock,
  getAdapterAccounts: getAdapterAccountsMock,
  manageAdapterAccount: manageAdapterAccountMock
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'zh',
      resolvedLanguage: 'zh'
    },
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'chat.accountQuota') return '账号额度'
      if (key === 'chat.accountQuotaWindow') {
        return `${String(options?.window)} 额度：已使用 ${String(options?.value)}`
      }
      if (key === 'chat.accountQuotaModal.windowDuration.days') return `${String(options?.count)} 天`
      if (key === 'chat.accountQuotaModal.windowDuration.hours') return `${String(options?.count)} 小时`
      if (key === 'chat.accountQuotaModal.windowDuration.minutes') return `${String(options?.count)} 分钟`
      if (key === 'chat.accountQuotaModal.windowUsage') return `${String(options?.window)}用量`
      if (key === 'chat.accountQuotaModal.resetsAt') return `${String(options?.date)} 重置`
      return key
    }
  })
}))

describe('account quota indicators', () => {
  beforeEach(() => {
    createAdapterAccountOperationIdMock.mockReset()
    getAdapterAccountDetailMock.mockReset()
    getAdapterAccountsMock.mockReset()
    manageAdapterAccountMock.mockReset()
    messageErrorMock.mockReset()
    messageInfoMock.mockReset()
    messageSuccessMock.mockReset()
    messageWarningMock.mockReset()
    mutateMock.mockReset()
    mutateMock.mockResolvedValue(undefined)
    popconfirmOnConfirms.length = 0
    useSWRConfigMutateMock.mockReset()
    useSWRConfigMutateMock.mockResolvedValue(undefined)
    useSWRMock.mockReset()
    useSWRMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      mutate: mutateMock
    })
  })

  it('starts the quota refresh without waiting for the account snapshot', async () => {
    const refreshedData = {
      accounts: [
        {
          key: 'personal',
          title: 'Personal',
          quota: {
            metrics: [
              { id: 'primary-usage', label: '7d used', value: '29%', primary: true }
            ]
          }
        }
      ]
    }
    getAdapterAccountsMock.mockResolvedValue(refreshedData)
    useSWRMock.mockImplementation((key: unknown, fetcher: (() => unknown) | null) => {
      const cacheKey = Array.isArray(key) ? key[0] : undefined
      if (cacheKey === '/api/adapters/accounts-quota') {
        return { data: refreshedData, mutate: fetcher }
      }
      return { data: undefined }
    })

    const result = useAdapterAccountsWithQuota({
      adapter: 'codex',
      model: 'gpt-5.6-sol'
    })

    expect(useSWRMock).toHaveBeenNthCalledWith(
      2,
      ['/api/adapters/accounts-quota', 'codex', 'gpt-5.6-sol'],
      expect.any(Function),
      expect.objectContaining({
        revalidateOnFocus: false
      })
    )
    const quotaFetcher = useSWRMock.mock.calls[1]?.[1] as (() => Promise<unknown>)
    await quotaFetcher()
    expect(getAdapterAccountsMock).toHaveBeenCalledWith('codex', {
      model: 'gpt-5.6-sol',
      refresh: true
    })
    expect(result).toEqual(refreshedData)
  })

  it('extracts the primary and secondary usage windows', () => {
    const windows = getAccountQuotaWindows({
      metrics: [
        { id: 'plan', label: 'Plan', value: 'Pro', primary: true },
        { id: 'secondary-usage', label: '7d used', value: '8%' },
        { id: 'primary-usage', label: '5h used', value: '48%', primary: true }
      ]
    })

    expect(windows).toEqual([
      expect.objectContaining({ id: 'primary-usage', label: '5h', percent: 48, value: '48%' }),
      expect.objectContaining({ id: 'secondary-usage', label: '7d', percent: 8, value: '8%' })
    ])
    expect(parseQuotaPercent('120%')).toBe(100)
    expect(parseQuotaPercent('-5%')).toBe(0)
  })

  it('renders two labeled quota rings', () => {
    const html = renderToStaticMarkup(
      <AccountQuotaIndicators
        windows={[
          { id: 'primary-usage', label: '5h', percent: 48, value: '48%', primary: true },
          { id: 'secondary-usage', label: '7d', percent: 8, value: '8%' }
        ]}
      />
    )

    expect(html).toContain('aria-label="账号额度"')
    expect(html).toContain('aria-label="5h 额度：已使用 48%"')
    expect(html).toContain('aria-label="7d 额度：已使用 8%"')
    expect(html.match(/quota-usage-ring--compact/g)).toHaveLength(2)
  })

  it('isolates the quota trigger from its parent select option', () => {
    const element = AccountQuotaIndicators({
      windows: [
        { id: 'primary-usage', label: '5h', percent: 48, value: '48%' }
      ]
    }) as ReactElement<{
      trigger: ReactElement<{
        onClick?: (event: { preventDefault: () => void; stopPropagation: () => void }) => void
        onMouseDown?: (event: { preventDefault: () => void; stopPropagation: () => void }) => void
      }>
    }>
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    }

    element.props.trigger.props.onMouseDown?.(event)
    element.props.trigger.props.onClick?.(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(event.stopPropagation).toHaveBeenCalledTimes(2)
  })

  it('renders anonymous actions instead of an empty state for count-only reset credits', () => {
    const html = renderToStaticMarkup(
      <AccountQuotaModalBody
        adapter='codex'
        account='work'
        quota={{
          metrics: [
            {
              id: 'primary-usage',
              label: '5h used',
              value: '48%',
              description: 'Resets 2026-07-10 16:14'
            },
            { id: 'codex-spark-primary-usage', label: 'Codex Spark · 7d used', value: '0%' }
          ],
          rateLimitResetCredits: {
            availableCount: 2,
            canConsume: true
          }
        }}
      />
    )

    expect(html).toContain('chat.accountQuotaModal.available')
    expect(html).toContain('query_stats')
    expect(html).toContain('schedule')
    expect(html).toContain('bolt')
    expect(html).toContain('5 小时用量')
    expect(html).toContain('重置')
    expect(html).not.toContain('Resets')
    expect(html).toContain('<div class="account-quota-modal__panel"><section')
    expect(html).toContain('<details class="account-quota-modal__credits"><summary')
    expect(html).not.toContain('<details class="account-quota-modal__credits" open=""')
    expect(html).not.toContain('config.accounts.resetCredits.noCredits')
    expect(html.match(/config\.accounts\.resetCredits\.fullResetTitle/g)).toHaveLength(2)
    expect(html.match(/config\.accounts\.resetCredits\.summaryDescription/g)).toHaveLength(2)
    expect(html.match(/aria-label="config\.accounts\.resetCredits\.use"/g)).toHaveLength(2)
  })

  it('uses the same non-success outcome messaging in the quota modal', async () => {
    createAdapterAccountOperationIdMock.mockReturnValue('modal-operation')
    manageAdapterAccountMock.mockResolvedValue({
      outcome: 'noCredit',
      account: {
        key: 'work',
        title: 'Work'
      }
    })
    renderToStaticMarkup(
      <AccountQuotaModalBody
        adapter='codex'
        account='work'
        quota={{
          rateLimitResetCredits: {
            availableCount: 1,
            canConsume: true,
            credits: [
              {
                id: 'credit-modal',
                status: 'available'
              }
            ]
          }
        }}
      />
    )

    await popconfirmOnConfirms[0]?.()

    expect(manageAdapterAccountMock).toHaveBeenCalledWith('codex', {
      action: 'consume-reset-credit',
      account: 'work',
      creditId: 'credit-modal',
      operationId: 'modal-operation'
    })
    expect(messageWarningMock).toHaveBeenCalledWith(
      'config.accounts.resetCredits.outcomes.noCredit'
    )
    expect(messageSuccessMock).not.toHaveBeenCalled()
    expect(messageErrorMock).not.toHaveBeenCalled()
  })

  it('keeps a pending anonymous operation id across unmount and rotates it after a definite outcome', async () => {
    type ConsumeResetCredit = ReturnType<typeof useAdapterAccountQuotaDetail>['consumeResetCredit']
    type RefreshAccountDetail = ReturnType<typeof useAdapterAccountQuotaDetail>['refreshAccountDetail']
    let consumeResetCredit: ConsumeResetCredit | undefined
    let refreshAccountDetail: RefreshAccountDetail | undefined

    const Harness = () => {
      const quotaDetail = useAdapterAccountQuotaDetail({
        adapter: 'codex',
        account: 'operation-reuse'
      })
      consumeResetCredit = quotaDetail.consumeResetCredit
      refreshAccountDetail = quotaDetail.refreshAccountDetail
      return null
    }

    createAdapterAccountOperationIdMock
      .mockReturnValueOnce('operation-reused')
      .mockReturnValueOnce('operation-after-outcome')
    manageAdapterAccountMock
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce({ outcome: 'reset' })
      .mockResolvedValueOnce({ outcome: 'reset' })

    renderToStaticMarkup(<Harness />)
    await expect(
      consumeResetCredit?.({ fallbackKey: 'next-0' })
    ).rejects.toThrow('connection lost')

    renderToStaticMarkup(<Harness />)
    await expect(
      consumeResetCredit?.({ fallbackKey: 'next-0' })
    ).resolves.toMatchObject({ outcome: 'reset' })
    expect(manageAdapterAccountMock.mock.calls[0]?.[1]).toMatchObject({
      operationId: 'operation-reused'
    })
    expect(manageAdapterAccountMock.mock.calls[1]?.[1]).toMatchObject({
      operationId: 'operation-reused'
    })

    mutateMock.mockRejectedValueOnce(new Error('refresh failed'))
    await expect(refreshAccountDetail?.()).rejects.toThrow('refresh failed')
    await expect(
      consumeResetCredit?.({ fallbackKey: 'next-0' })
    ).resolves.toMatchObject({ outcome: 'reset' })
    expect(manageAdapterAccountMock.mock.calls[2]?.[1]).toMatchObject({
      operationId: 'operation-after-outcome'
    })
  })

  it('does not share pending operation ids across accounts or reset-credit keys', async () => {
    type ConsumeResetCredit = ReturnType<typeof useAdapterAccountQuotaDetail>['consumeResetCredit']
    const consumers = new Map<string, ConsumeResetCredit>()
    const Harness = ({ account }: { account: string }) => {
      const quotaDetail = useAdapterAccountQuotaDetail({ adapter: 'codex', account })
      consumers.set(account, quotaDetail.consumeResetCredit)
      return null
    }

    createAdapterAccountOperationIdMock
      .mockReturnValueOnce('operation-account-a-card-a')
      .mockReturnValueOnce('operation-account-b-card-a')
      .mockReturnValueOnce('operation-account-a-card-b')
    manageAdapterAccountMock.mockRejectedValue(new TypeError('connection lost'))

    renderToStaticMarkup(<Harness account='operation-account-a' />)
    renderToStaticMarkup(<Harness account='operation-account-b' />)
    await expect(consumers.get('operation-account-a')?.({ creditId: 'credit-a' })).rejects.toThrow()
    await expect(consumers.get('operation-account-b')?.({ creditId: 'credit-a' })).rejects.toThrow()
    await expect(consumers.get('operation-account-a')?.({ creditId: 'credit-b' })).rejects.toThrow()

    expect(manageAdapterAccountMock.mock.calls.map(call => call[1]?.operationId)).toEqual([
      'operation-account-a-card-a',
      'operation-account-b-card-a',
      'operation-account-a-card-b'
    ])
  })

  it('maps every known consume outcome to a non-success-specific notice tone', () => {
    expect(getAdapterResetCreditOutcomeTone(getAdapterResetCreditOutcome('reset'))).toBe('success')
    expect(getAdapterResetCreditOutcomeTone(getAdapterResetCreditOutcome('alreadyRedeemed'))).toBe('info')
    expect(getAdapterResetCreditOutcomeTone(getAdapterResetCreditOutcome('nothingToReset'))).toBe('info')
    expect(getAdapterResetCreditOutcomeTone(getAdapterResetCreditOutcome('noCredit'))).toBe('warning')
  })

  it('keeps a deterministic pixel fallback behind a remote account avatar', () => {
    const html = renderToStaticMarkup(
      <AccountAvatar
        option={{
          value: 'personal',
          label: 'Personal',
          email: 'personal@example.com',
          avatarUrl: 'https://chatgpt.com/avatar.jpg'
        }}
      />
    )

    expect(html).toContain('account-avatar__pixel')
    expect(html).toContain('account-avatar__image')
    expect(html).toContain('referrerPolicy="no-referrer"')
  })
})
