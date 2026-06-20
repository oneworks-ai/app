import { describe, expect, it } from 'vitest'

import type { TranslationFn } from '#~/components/config/configUtils'
import { formatBalance } from '#~/components/config/modelServiceProviderActionUtils'

const t: TranslationFn = (key) => (
  key === 'config.modelServices.results.amountUnknown'
    ? '未知'
    : key === 'config.modelServices.results.unlimitedQuota'
    ? '无限额度'
    : key
)

describe('model service provider action utils', () => {
  it('formats common balance currencies with symbols', () => {
    expect(formatBalance({ available: 12.34, currency: 'USD', kind: 'balance' }, t)).toBe('12.34 $')
    expect(formatBalance({ available: 56.78, currency: 'CNY', kind: 'balance' }, t)).toBe('56.78 ¥')
  })

  it('keeps unknown balance currency codes visible', () => {
    expect(formatBalance({ available: 9, currency: 'EUR', kind: 'balance' }, t)).toBe('EUR 9')
  })

  it('formats unlimited provider quota without a numeric amount', () => {
    expect(formatBalance({ kind: 'quota', unlimited: true }, t)).toBe('无限额度')
  })
})
