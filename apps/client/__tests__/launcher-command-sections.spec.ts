import { describe, expect, it } from 'vitest'

import { shouldShowLauncherCommandSection } from '#~/routes/launcher-command-sections'

describe('launcher command sections', () => {
  it('hides built-in commands for an empty query', () => {
    expect(shouldShowLauncherCommandSection('builtin', '')).toBe(false)
    expect(shouldShowLauncherCommandSection('recent-selections', '')).toBe(true)
  })

  it('hides recent selections for a non-empty query', () => {
    expect(shouldShowLauncherCommandSection('builtin', 'project')).toBe(true)
    expect(shouldShowLauncherCommandSection('recent-selections', 'project')).toBe(false)
  })

  it('keeps ordinary sections visible for empty and non-empty queries', () => {
    expect(shouldShowLauncherCommandSection('projects', '')).toBe(true)
    expect(shouldShowLauncherCommandSection('projects', 'project')).toBe(true)
  })
})
