import { describe, expect, it } from 'vitest'

import type { ConfigResponse } from '@oneworks/types'

import { buildSkillRegistriesValue } from '#~/components/knowledge-base/components/skill-hub-utils'
import {
  buildBuiltInSkillRegistryToggleValue,
  buildSkillRegistryRemovalValue,
  collectManagedSkillRegistries,
  resolveInheritedBuiltInRegistryEnabled
} from '#~/components/knowledge-base/components/skill-registry-settings-utils'

describe('skill registry settings helpers', () => {
  const configRes: ConfigResponse = {
    sources: {
      global: {
        general: {
          skillRegistries: [{
            source: 'team/global-skills',
            title: 'Global Skills',
            registry: 'https://registry.example.com'
          }]
        }
      },
      project: {
        general: {
          skillsMeta: {
            sources: ['legacy/project-skills', 'team/project-skills']
          },
          skillRegistries: [{ source: 'team/project-skills' }]
        }
      }
    }
  }

  it('collects raw registries by config layer and de-duplicates legacy mirrors', () => {
    expect(
      collectManagedSkillRegistries(configRes).map(entry => ({
        configSource: entry.configSource,
        kind: entry.kind,
        source: entry.source
      }))
    ).toEqual([
      { configSource: 'global', kind: 'configured', source: 'team/global-skills' },
      { configSource: 'project', kind: 'configured', source: 'team/project-skills' },
      { configSource: 'project', kind: 'legacy', source: 'legacy/project-skills' }
    ])
  })

  it('shows built-ins first and hides matching raw overrides from the custom list', () => {
    expect(
      collectManagedSkillRegistries(configRes, [{
        builtIn: true,
        configLabel: '.oo.config.json',
        configSource: 'project',
        enabled: false,
        id: 'project:team/project-skills',
        name: 'team/project-skills',
        searchable: false,
        source: 'team/project-skills',
        title: 'Official Project Skills',
        type: 'skills-cli'
      }]).map(entry => ({
        enabled: entry.enabled,
        kind: entry.kind,
        source: entry.source
      }))
    ).toEqual([
      { enabled: false, kind: 'builtIn', source: 'team/project-skills' },
      { enabled: true, kind: 'configured', source: 'team/global-skills' },
      { enabled: true, kind: 'legacy', source: 'legacy/project-skills' }
    ])
  })

  it('upserts an enabled override without dropping custom registries', () => {
    expect(buildBuiltInSkillRegistryToggleValue(
      configRes.sources?.project?.general,
      'official/skills',
      false
    )).toEqual({
      skillRegistries: [
        { source: 'team/project-skills' },
        { source: 'official/skills', enabled: false }
      ]
    })
    expect(buildBuiltInSkillRegistryToggleValue(
      {
        skillRegistries: [{ source: 'official/skills', title: 'Official' }]
      },
      'official/skills',
      true
    )).toEqual({
      skillRegistries: [{ source: 'official/skills', title: 'Official', enabled: true }]
    })
    expect(buildBuiltInSkillRegistryToggleValue(
      { skillRegistries: [{ source: 'official/skills', enabled: false }] },
      'official/skills',
      true
    )).toEqual({ skillRegistries: [] })
    expect(buildBuiltInSkillRegistryToggleValue(
      { skillRegistries: [{ source: 'official/skills', enabled: false }] },
      'official/skills',
      true,
      false
    )).toEqual({ skillRegistries: [{ source: 'official/skills', enabled: true }] })
  })

  it('resolves the inherited enabled state below the owning config layer', () => {
    expect(resolveInheritedBuiltInRegistryEnabled(
      {
        sources: {
          global: {
            general: {
              skillRegistries: [{ source: 'official/skills', enabled: false }]
            }
          },
          project: {
            general: {
              skillRegistries: [{ source: 'official/skills', title: 'Project title' }]
            }
          }
        }
      },
      'project',
      'official/skills'
    )).toBe(false)
    expect(resolveInheritedBuiltInRegistryEnabled(
      {
        sources: {
          global: {
            general: {
              skillRegistries: [{ source: 'official/skills', enabled: false }]
            }
          },
          project: {
            general: {
              disableGlobalConfig: true,
              skillRegistries: [{ source: 'official/skills', enabled: true }]
            }
          }
        }
      },
      'project',
      'official/skills'
    )).toBe(true)
    expect(resolveInheritedBuiltInRegistryEnabled(
      {
        sources: {
          global: {
            general: {
              skillRegistries: [{ source: 'official/skills', enabled: false }]
            }
          },
          project: {
            general: { disableGlobalConfig: true }
          },
          user: {
            general: { disableGlobalConfig: false }
          }
        }
      },
      'project',
      'official/skills'
    )).toBe(false)
    expect(resolveInheritedBuiltInRegistryEnabled(configRes, 'global', 'official/skills')).toBe(true)
  })

  it('removes only the selected configured registry from its raw section', () => {
    const registry = collectManagedSkillRegistries(configRes)[0]
    expect(buildSkillRegistryRemovalValue(configRes.sources?.global?.general, registry)).toEqual({
      skillRegistries: []
    })
  })

  it('preserves other skillsMeta fields when removing a legacy source', () => {
    const general = {
      skillsMeta: {
        homeBridge: { enabled: false },
        sources: ['legacy/project-skills', 'other/source']
      }
    }
    const registry = {
      configSource: 'project' as const,
      enabled: true,
      index: 0,
      key: 'legacy',
      kind: 'legacy' as const,
      source: 'legacy/project-skills'
    }
    expect(buildSkillRegistryRemovalValue(general, registry)).toEqual({
      skillsMeta: {
        homeBridge: { enabled: false },
        sources: ['other/source']
      }
    })
  })

  it('stores custom registry metadata in skillRegistries', () => {
    expect(buildSkillRegistriesValue([], {
      configSource: 'project',
      source: 'team/skills',
      title: 'Team Skills',
      registry: 'https://registry.example.com'
    })).toEqual([{
      source: 'team/skills',
      title: 'Team Skills',
      registry: 'https://registry.example.com'
    }])
  })
})
