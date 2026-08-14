import '../src/adapter-config'

import { describe, expect, it } from 'vitest'

import { buildDshComposition } from '../src/runtime/composition'
import { resolveDshAdapterConfig } from '../src/runtime/config'

describe('dsh runtime config', () => {
  it('preserves the upstream reasoning default when effort is not configured', () => {
    const composition = buildDshComposition({
      cwd: '/workspace',
      effort: undefined,
      model: 'deepseek-v4-flash',
      permissionMode: 'default',
      persistenceRoot: '/private/session'
    })
    expect(composition.find(plugin => plugin.id === 'llm-deepseek')?.config).not.toHaveProperty('reasoningEffort')
  })

  it('deep-merges layered CLI fields through the adapter contribution', () => {
    expect(resolveDshAdapterConfig({
      configs: [
        {
          adapters: {
            dsh: {
              cli: { source: 'managed', package: '@deepseek-ai/dsh-acp-demo' },
              baseUrl: 'https://project.example.com',
              effort: 'low'
            }
          }
        },
        {
          adapters: {
            dsh: {
              cli: { version: '0.1.0-rc.6' },
              baseUrl: 'https://user.example.com',
              effort: 'high'
            }
          }
        }
      ]
    })).toEqual({
      cli: {
        package: '@deepseek-ai/dsh-acp-demo',
        source: 'managed',
        version: '0.1.0-rc.6'
      },
      baseUrl: 'https://user.example.com'
    })
  })
})
