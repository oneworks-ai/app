import { describe, expect, it, vi } from 'vitest'

import {
  assertExpectedRelayHealth,
  waitForExpectedRelayHealth
} from '../../.github/workflows/scripts/relay-release-readiness.mjs'

describe('assertExpectedRelayHealth', () => {
  it('requires the expected version and immutable build SHA', () => {
    expect(() =>
      assertExpectedRelayHealth(
        { buildSha: 'old', ok: true, version: '1.2.3' },
        { expectedBuildSha: 'target', expectedVersion: '1.2.3' }
      )
    ).toThrow('buildSha should be "target"')
  })
})

describe('waitForExpectedRelayHealth', () => {
  it('retries only readiness until the target release is serving', async () => {
    const fetchHealth = vi.fn()
      .mockResolvedValueOnce({ buildSha: 'old', ok: true, version: '1.2.3' })
      .mockResolvedValueOnce({ buildSha: 'target', ok: true, version: '1.2.3' })
    const onRetry = vi.fn()
    const sleep = vi.fn(async () => {})

    await expect(waitForExpectedRelayHealth({
      attempts: 3,
      expectedBuildSha: 'target',
      expectedVersion: '1.2.3',
      fetchHealth,
      intervalMs: 20_000,
      onRetry,
      sleep
    })).resolves.toEqual({ buildSha: 'target', ok: true, version: '1.2.3' })
    expect(fetchHealth).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(20_000)
  })

  it('fails after the bounded attempts without sleeping after the final failure', async () => {
    const fetchHealth = vi.fn(async () => ({ buildSha: 'old', ok: true, version: '1.2.3' }))
    const sleep = vi.fn(async () => {})

    await expect(waitForExpectedRelayHealth({
      attempts: 3,
      expectedBuildSha: 'target',
      fetchHealth,
      sleep
    })).rejects.toThrow('did not become ready after 3 attempt(s)')
    expect(fetchHealth).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid retry configuration before making a request', async () => {
    const fetchHealth = vi.fn()

    await expect(waitForExpectedRelayHealth({ attempts: 0, fetchHealth })).rejects.toThrow('positive integer')
    expect(fetchHealth).not.toHaveBeenCalled()
  })
})
