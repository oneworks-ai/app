import { describe, expect, it } from 'vitest'

import { filterServiceModelsForAdapter, listServiceModels } from '#~/model-selection.js'
import type { ModelServiceConfig } from '@oneworks/types'

describe('dsh model selection', () => {
  it('does not expose generic model-service routes', () => {
    const modelServices: Record<string, ModelServiceConfig> = {
      deepseek: {
        apiBaseUrl: 'https://api.deepseek.com',
        models: ['deepseek-v4-flash']
      }
    }

    expect(filterServiceModelsForAdapter({
      adapter: 'dsh',
      modelServices,
      serviceModels: listServiceModels(modelServices)
    })).toEqual([])
  })
})
