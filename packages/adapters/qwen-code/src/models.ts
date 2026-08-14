import type { AdapterBuiltinModel } from '@oneworks/types'

export const builtinModels: AdapterBuiltinModel[] = [
  {
    value: 'qwen3.7-max',
    title: 'Qwen3.7 Max',
    description: 'Highest-capability current Qwen model for complex coding and reasoning.'
  },
  {
    value: 'qwen3.7-plus',
    title: 'Qwen3.7 Plus',
    description: 'Balanced Qwen model for agentic software engineering.'
  },
  {
    value: 'qwen3.6-flash',
    title: 'Qwen3.6 Flash',
    description: 'Lower-latency Qwen model for everyday development tasks.'
  },
  {
    value: 'qwen3.5-plus',
    title: 'Qwen3.5 Plus',
    description: 'General-purpose Qwen model with thinking support.'
  },
  {
    value: 'qwen3-coder-next',
    title: 'Qwen3 Coder Next',
    description: 'Qwen coding model for agentic repository work.'
  },
  {
    value: 'qwen3-coder-plus',
    title: 'Qwen3 Coder Plus',
    description: 'Qwen coding model for broad software engineering tasks.'
  }
]
