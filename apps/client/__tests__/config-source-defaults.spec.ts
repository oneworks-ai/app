import { describe, expect, it } from 'vitest'

import {
  getPreferredConfigSourceForTab,
  normalizeConfigSourceForTab,
  resolveConfigSourceForMissingQuery
} from '#~/components/config/configSourceDefaults'

describe('config source defaults', () => {
  it('prefers global config for model services', () => {
    expect(getPreferredConfigSourceForTab('modelServices')).toBe('global')
    expect(resolveConfigSourceForMissingQuery('modelServices', {
      project: true,
      user: true
    })).toBe('global')
  })

  it('keeps worktree environments project or user scoped', () => {
    expect(getPreferredConfigSourceForTab('worktreeEnvironments')).toBe('project')
    expect(normalizeConfigSourceForTab('worktreeEnvironments', 'global')).toBe('project')
    expect(normalizeConfigSourceForTab('worktreeEnvironments', 'project')).toBe('project')
    expect(normalizeConfigSourceForTab('worktreeEnvironments', 'user')).toBe('user')
  })

  it('keeps the existing project/user/global fallback for ordinary sections', () => {
    expect(resolveConfigSourceForMissingQuery('general', {
      project: true,
      user: true,
      global: true
    })).toBe('project')
    expect(resolveConfigSourceForMissingQuery('general', {
      user: true,
      global: true
    })).toBe('user')
    expect(resolveConfigSourceForMissingQuery('general', {
      global: true
    })).toBe('global')
  })
})
