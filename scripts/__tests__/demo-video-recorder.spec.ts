import { describe, expect, it } from 'vitest'

import { shouldContinueSystemCaptureDuringAction } from '../demo-video/recorder'

describe('demo video recorder system capture timing', () => {
  it('treats recordDuring duration as a minimum while the action is still running', () => {
    expect(shouldContinueSystemCaptureDuringAction({
      actionSettled: false,
      capturedMs: 10_000,
      requestedDurationMs: 10_000
    })).toBe(true)
  })

  it('stops only after both the requested duration and scenario action are complete', () => {
    expect(shouldContinueSystemCaptureDuringAction({
      actionSettled: true,
      capturedMs: 9_000,
      requestedDurationMs: 10_000
    })).toBe(true)
    expect(shouldContinueSystemCaptureDuringAction({
      actionSettled: true,
      capturedMs: 10_000,
      requestedDurationMs: 10_000
    })).toBe(false)
  })
})
