import { describe, expect, it } from 'vitest'

import { assertUniqueMarketplacePluginScopes } from '#~/managed-plugin-sync.js'

describe('managed plugin marketplace sync', () => {
  it('includes native One Works declarations in cross-marketplace scope validation', () => {
    expect(() =>
      assertUniqueMarketplacePluginScopes({
        'oneworks-official': {
          type: 'oneworks',
          plugins: { '@oneworks/plugin-logger': { scope: 'tools' } }
        },
        'openai-plugins': {
          type: 'codex',
          plugins: { github: { scope: 'tools' } }
        }
      })
    ).toThrow('Plugin scope "tools" is declared by both')
  })
})
