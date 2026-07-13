import type { MarketplaceConfig } from '@oneworks/types'

/** Codex-owned marketplace declarations consumed by generic OneWorks orchestration. */
export const CODEX_BUILT_IN_PLUGIN_MARKETPLACES: MarketplaceConfig = {
  'openai-curated-remote': {
    type: 'codex',
    enabled: true,
    options: {
      source: {
        source: 'app-server',
        marketplace: 'openai-curated-remote',
        includeRemoteCatalog: true
      }
    }
  },
  'openai-plugins': {
    type: 'codex',
    enabled: true,
    options: {
      source: {
        source: 'github',
        repo: 'openai/plugins'
      }
    }
  }
}
