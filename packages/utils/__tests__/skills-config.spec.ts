import { describe, expect, it } from 'vitest'

import {
  isObjectSkillsConfig,
  mergeSkillsMeta,
  resolveConfiguredSkillInstalls,
  resolveSkillsHomeBridge,
  resolveSkillsMeta,
  resolveSkillsRegistry
} from '#~/index.js'

describe('skills config utilities', () => {
  it('exports object skills config helpers from the package root', () => {
    expect(isObjectSkillsConfig(['review'])).toBe(false)
    expect(isObjectSkillsConfig({
      items: ['review'],
      registry: 'https://registry.example.com'
    })).toBe(true)
  })

  it('reads object skills config fields used by config merging', () => {
    const skills = {
      items: ['review'],
      registry: ' https://registry.example.com '
    }

    expect(resolveConfiguredSkillInstalls(skills)).toEqual(['review'])
    expect(resolveSkillsRegistry(skills)).toBe('https://registry.example.com')
  })

  it('normalizes and merges skillsMeta without affecting install registry resolution', () => {
    expect(resolveSkillsMeta({
      skillsMeta: {
        registries: [' https://registry.example.com ', 'https://registry.example.com'],
        sources: [' example-source/default/public '],
        homeBridge: {
          enabled: false
        }
      }
    })).toEqual({
      registries: ['https://registry.example.com'],
      sources: ['example-source/default/public'],
      homeBridge: {
        enabled: false
      }
    })

    expect(mergeSkillsMeta(
      {
        skillsMeta: {
          registries: ['https://registry.example.com'],
          sources: ['example-source/base']
        }
      },
      {
        skillsMeta: {
          bundled: false,
          registries: ['https://registry.example.com', 'https://registry.other.example.com'],
          sources: ['example-source/project']
        }
      }
    )).toEqual({
      bundled: false,
      registries: ['https://registry.example.com', 'https://registry.other.example.com'],
      sources: ['example-source/base', 'example-source/project'],
      homeBridge: undefined
    })
    expect(resolveSkillsRegistry(['review'])).toBeUndefined()
  })

  it('prefers skillsMeta homeBridge over legacy object skills homeBridge', () => {
    expect(resolveSkillsHomeBridge({
      skills: {
        homeBridge: {
          enabled: true
        }
      },
      skillsMeta: {
        homeBridge: {
          enabled: false
        }
      }
    })).toEqual({
      enabled: false
    })
  })
})
