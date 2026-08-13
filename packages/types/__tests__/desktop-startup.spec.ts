import { describe, expect, it } from 'vitest'

import { normalizeDesktopFirstActionMilestone, normalizeDesktopWorkspaceStartupReadiness } from '../src/desktop-startup'

describe('desktop startup readiness', () => {
  it('preserves explicit editable and degraded terminal states', () => {
    expect(normalizeDesktopWorkspaceStartupReadiness({ readiness: 'editable' })).toBe('editable')
    expect(normalizeDesktopWorkspaceStartupReadiness({ readiness: 'degraded' })).toBe('degraded')
  })

  it('keeps legacy empty calls editable but fails malformed payloads closed', () => {
    expect(normalizeDesktopWorkspaceStartupReadiness()).toBe('editable')
    expect(normalizeDesktopWorkspaceStartupReadiness(null)).toBe('degraded')
    expect(normalizeDesktopWorkspaceStartupReadiness({})).toBe('degraded')
    expect(normalizeDesktopWorkspaceStartupReadiness({ readiness: 'mounted' })).toBe('degraded')
    expect(normalizeDesktopWorkspaceStartupReadiness('editable')).toBe('degraded')
  })
})

describe('desktop first-action milestones', () => {
  it('accepts only the closed privacy-safe milestone contract', () => {
    expect(normalizeDesktopFirstActionMilestone({ milestone: 'first.submit' })).toBe('first.submit')
    expect(normalizeDesktopFirstActionMilestone({ milestone: 'submit.accepted' })).toBe('submit.accepted')
    expect(normalizeDesktopFirstActionMilestone({ milestone: 'first.response.received' }))
      .toBe('first.response.received')
    expect(normalizeDesktopFirstActionMilestone({ milestone: 'first.success' })).toBe('first.success')
    expect(normalizeDesktopFirstActionMilestone({ milestone: 'first.failed' })).toBe('first.failed')
    expect(normalizeDesktopFirstActionMilestone({ milestone: 'first.terminated' })).toBe('first.terminated')

    expect(normalizeDesktopFirstActionMilestone({ milestone: 'first.token' })).toBeUndefined()
    expect(normalizeDesktopFirstActionMilestone({ milestone: 'first.submit', prompt: 'private' }))
      .toBe('first.submit')
    expect(normalizeDesktopFirstActionMilestone('first.submit')).toBeUndefined()
    expect(normalizeDesktopFirstActionMilestone(null)).toBeUndefined()
  })
})
