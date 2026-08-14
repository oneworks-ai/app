import type { AdapterBuiltinModel } from '@oneworks/types'

import { JUNIE_SUPPORTED_EFFORTS } from './effort'

export const builtinModels: AdapterBuiltinModel[] = [{
  value: 'default',
  title: 'Default',
  description: 'Use the model selected by Junie or the configured BYOK provider.',
  supportedEfforts: [...JUNIE_SUPPORTED_EFFORTS]
}]
