import type { MarketplaceConfig } from '@oneworks/types'

/** Claude Code-owned marketplace declarations consumed by generic OneWorks orchestration. */
export const CLAUDE_CODE_BUILT_IN_PLUGIN_MARKETPLACES: MarketplaceConfig = {
  'claude-plugins-official': {
    type: 'claude-code',
    enabled: true,
    options: {
      source: {
        source: 'github',
        repo: 'anthropics/claude-plugins-official'
      }
    }
  }
}
