import { CLAUDE_CODE_BUILT_IN_PLUGIN_MARKETPLACES } from '@oneworks/adapter-claude-code/plugins'
import { CODEX_BUILT_IN_PLUGIN_MARKETPLACES } from '@oneworks/adapter-codex/plugins'
import type { MarketplaceConfig } from '@oneworks/types'

export const BUILT_IN_PLUGIN_MARKETPLACES: MarketplaceConfig = {
  ...CODEX_BUILT_IN_PLUGIN_MARKETPLACES,
  ...CLAUDE_CODE_BUILT_IN_PLUGIN_MARKETPLACES
}
