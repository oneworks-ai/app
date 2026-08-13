import type { AdapterBuiltinModel } from '@oneworks/types'

import { DROID_SUPPORTED_EFFORTS } from './config-schema'

export const builtinModels: AdapterBuiltinModel[] = [{
  value: 'default',
  title: 'Default',
  description: 'Use the model selected by Factory Droid.',
  supportedEfforts: [...DROID_SUPPORTED_EFFORTS]
}]
