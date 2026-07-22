import { CLAUDE_CODE_BUILT_IN_PLUGIN_MARKETPLACES } from '@oneworks/adapter-claude-code/plugins'
import { CODEX_BUILT_IN_PLUGIN_MARKETPLACES } from '@oneworks/adapter-codex/plugins'
import type { MarketplaceConfig } from '@oneworks/types'

import { ONEWORKS_OFFICIAL_MARKETPLACE_ENTRY, ONEWORKS_OFFICIAL_MARKETPLACE_KEY } from './oneworks-official-marketplace'

export const BUILT_IN_PLUGIN_MARKETPLACES: MarketplaceConfig = {
  [ONEWORKS_OFFICIAL_MARKETPLACE_KEY]: ONEWORKS_OFFICIAL_MARKETPLACE_ENTRY,
  ...CODEX_BUILT_IN_PLUGIN_MARKETPLACES,
  ...CLAUDE_CODE_BUILT_IN_PLUGIN_MARKETPLACES
}
