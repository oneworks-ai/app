import { describe, expect, it } from 'vitest'

import { normalizeDesktopWorkspaceStartupReadiness } from '../src/desktop-startup'

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
