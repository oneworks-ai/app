import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { AccountQuotaIndicators } from '#~/components/chat/sender/@components/account-select/AccountQuotaIndicators'
import { getAccountQuotaWindows, parseQuotaPercent } from '#~/utils/account-quota'

vi.mock('antd', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
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
})
