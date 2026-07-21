import type {
  AdapterModelProviderImportDiscoverer,
  AdapterModelProviderImportDiscoveryResult,
  AdapterModelProviderImportSource
} from '@oneworks/types'

import { readCodexModelProviderConfig } from './model-provider-config-read'
import { buildCodexModelProviderMigrationPlan } from './model-provider-migration-plan'
import { readCodexProjectModelProviderConfig } from './model-provider-project-config-read'

export { buildCodexModelProviderMigrationPlan } from './model-provider-migration-plan'

export type CodexModelProviderImportSource = AdapterModelProviderImportSource
export type CodexModelProviderImportDiscoveryResult = AdapterModelProviderImportDiscoveryResult

export const discoverCodexModelServicesFromConfig: AdapterModelProviderImportDiscoverer = async params => {
  if (params.source === 'user') {
    throw new TypeError('Codex model providers can only be imported into global or project config.')
  }
  const nativeConfig = params.source === 'global'
    ? await readCodexModelProviderConfig(params)
    : await readCodexProjectModelProviderConfig(params)
  if (nativeConfig == null) {
    return {
      found: false,
      modelServices: {},
      skippedProviderIds: []
    }
  }

  const plan = buildCodexModelProviderMigrationPlan(nativeConfig)
  return {
    found: true,
    modelServices: plan.modelServices,
    skippedProviderIds: plan.skippedProviderIds
  }
}
