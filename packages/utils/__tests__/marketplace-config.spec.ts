import { describe, expect, it } from 'vitest'

import { mergeMarketplaceConfigs } from '#~/marketplace-config.js'

describe('marketplace config merging', () => {
  it('inherits the official One Works package version when a layer selects a plugin', () => {
    expect(mergeMarketplaceConfigs(
      {
        'oneworks-official': {
          type: 'oneworks',
          options: { version: '0.1.0-beta.7' }
        }
      },
      {
        'oneworks-official': {
          type: 'oneworks',
          plugins: { '@oneworks/plugin-logger': { enabled: true } }
        }
      }
    )).toEqual({
      'oneworks-official': {
        type: 'oneworks',
        options: { version: '0.1.0-beta.7' },
        plugins: { '@oneworks/plugin-logger': { enabled: true } }
      }
    })
  })
})
