import type { AdapterModelProviderImportCapability, AdapterModelProviderImportSource } from '@oneworks/types'

import { discoverCodexModelServicesFromConfig } from './runtime/model-provider-import'

export {
  buildCodexModelProviderMigrationPlan,
  discoverCodexModelServicesFromConfig
} from './runtime/model-provider-import'
export type {
  CodexModelProviderImportDiscoveryResult,
  CodexModelProviderImportSource
} from './runtime/model-provider-import'

export const modelProviderImport = {
  descriptor: {
    title: 'Codex config.toml',
    description: 'Import native Codex model providers into One Works model services.',
    supportedSources: [
      'global',
      'project'
    ] as const satisfies readonly AdapterModelProviderImportSource[]
  },
  discover: discoverCodexModelServicesFromConfig
} satisfies AdapterModelProviderImportCapability

export default modelProviderImport
