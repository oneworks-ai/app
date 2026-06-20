import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getCachedModelServiceAccountStatus,
  setCachedModelServiceAccountStatus
} from '#~/components/config/modelServiceAccountStatusCache'

describe('model service account status cache', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps regular balance cached longer than live quota', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    setCachedModelServiceAccountStatus('balance', {
      available: 12.34,
      currency: 'USD',
      kind: 'balance'
    })
    setCachedModelServiceAccountStatus('quota', {
      kind: 'quota',
      limit: 100,
      remaining: 99,
      unit: 'percent'
    })

    vi.setSystemTime(70_000)

    expect(getCachedModelServiceAccountStatus('quota')).toBeNull()
    expect(getCachedModelServiceAccountStatus('balance')).toMatchObject({
      available: 12.34,
      currency: 'USD',
      kind: 'balance'
    })
  })
})
