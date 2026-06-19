import type { RelayConfigSafeField } from './types.js'

export const RELAY_CONFIG_SAFE_FIELDS = [
  'defaultModelService',
  'modelServices',
  'recommendedModels',
  'plugins',
  'marketplaces',
  'skills',
  'skillsMeta',
  'skillRegistries'
] as const satisfies readonly RelayConfigSafeField[]
