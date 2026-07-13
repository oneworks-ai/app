import { describe, expect, it, vi } from 'vitest'

import { buildSkillsTabHeaderActions } from '#~/components/knowledge-base/components/skills-tab-header-actions'

const t = ((key: string) => key) as any

describe('knowledge skills header actions', () => {
  it('places the project and market switches at the far right without a refresh action', () => {
    const actions = buildSkillsTabHeaderActions({
      navigateToSettings: vi.fn(),
      onViewModeChange: vi.fn(),
      t,
      viewMode: 'project'
    })

    expect(actions.map(action => action.key)).toEqual([
      'knowledge-skills-settings',
      'knowledge-skills-project',
      'knowledge-skills-store'
    ])
  })

  it('keeps the same header actions in the market view', () => {
    const actions = buildSkillsTabHeaderActions({
      navigateToSettings: vi.fn(),
      onViewModeChange: vi.fn(),
      t,
      viewMode: 'market'
    })

    expect(actions.map(action => action.key)).toEqual([
      'knowledge-skills-settings',
      'knowledge-skills-project',
      'knowledge-skills-store'
    ])
  })
})
