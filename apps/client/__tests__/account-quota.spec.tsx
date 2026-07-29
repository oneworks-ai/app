import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { AccountAvatar } from '#~/components/chat/sender/@components/account-select/AccountAvatar'
import { AccountQuotaIndicators } from '#~/components/chat/sender/@components/account-select/AccountQuotaIndicators'
import { useAdapterAccountsWithQuota } from '#~/hooks/use-adapter-accounts-with-quota'
import { getAccountQuotaWindows, parseQuotaPercent } from '#~/utils/account-quota'

const { getAdapterAccountsMock, useSWRMock } = vi.hoisted(() => ({
  getAdapterAccountsMock: vi.fn(),
  useSWRMock: vi.fn()
}))

vi.mock('antd', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('swr', () => ({
  default: useSWRMock
}))

vi.mock('#~/api', () => ({
  getAdapterAccounts: getAdapterAccountsMock
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === 'chat.accountQuota') return '账号额度'
      if (key === 'chat.accountQuotaWindow') return `${options?.window} 额度：已使用 ${options?.value}`
      return key
    }
  })
}))

describe('account quota indicators', () => {
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
