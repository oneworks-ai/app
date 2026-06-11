import { resolveAdapterConfigWithContribution as resolveMergedAdapterConfig } from '@oneworks/config'
import type { AdapterCtx } from '@oneworks/types'

import { adapterConfigContribution } from './config-schema.js'
import type { ClaudeCodeAdapterConfig, ClaudeCodeCommonAdapterConfigKey } from './config-schema.js'

export const resolveClaudeCodeAdapterConfig = (
  params: Pick<AdapterCtx, 'configState' | 'configs'>
) =>
  resolveMergedAdapterConfig<ClaudeCodeAdapterConfig, ClaudeCodeCommonAdapterConfigKey>(
    adapterConfigContribution,
    params
  )
