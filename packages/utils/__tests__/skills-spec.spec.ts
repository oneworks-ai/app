import { describe, expect, it } from 'vitest'

import { formatSkillsSpec, parseSkillsSpec } from '../src/skills-spec'

describe('skills spec', () => {
  it('round trips scoped npm source refs', () => {
    const ref = formatSkillsSpec({
      name: 'bytedcli',
      source: '@scope/bytedcli',
      version: '1.2.3'
    })

    expect(ref).toBe('@scope/bytedcli@bytedcli@1.2.3')
    expect(parseSkillsSpec(ref)).toEqual({
      ref,
      source: '@scope/bytedcli',
      name: 'bytedcli',
      version: '1.2.3'
    })
  })

  it('round trips scoped npm source refs with a registry', () => {
    const ref = formatSkillsSpec({
      name: 'bytedcli',
      registry: 'https://registry.example.test',
      source: '@scope/bytedcli',
      version: '1.2.3'
    })

    expect(ref).toBe('https://registry.example.test@@scope/bytedcli@bytedcli@1.2.3')
    expect(parseSkillsSpec(ref)).toEqual({
      ref,
      registry: 'https://registry.example.test',
      source: '@scope/bytedcli',
      name: 'bytedcli',
      version: '1.2.3'
    })
  })
})
