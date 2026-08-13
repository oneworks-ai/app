import { describe, expect, it } from 'vitest'

import { filterServiceModelsForAdapter, listServiceModels } from '#~/model-selection.js'
import type { ModelServiceConfig } from '@oneworks/types'

describe('junie model selection compatibility', () => {
  it('does not route One Works model services through Junie', () => {
    const modelServices: Record<string, ModelServiceConfig> = {
      implicit: {
        apiBaseUrl: 'https://service.example.com/v1',
        apiKey: 'token',
        models: ['implicit-model']
      },
      explicit: {
        apiBaseUrl: 'https://service.example.com/v1',
        apiKey: 'token',
        models: ['explicit-model'],
        supportedAdapters: ['junie']
      }
    }

    expect(
      filterServiceModelsForAdapter({
        adapter: 'junie',
        modelServices,
        serviceModels: listServiceModels(modelServices)
      }).map(entry => entry.selectorValue)
    ).toEqual([])
  })
})
