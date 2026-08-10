import { resolveAdapterConfigWithContribution } from '@oneworks/config'
import type { AdapterCtx } from '@oneworks/types'

import { adapterConfigContribution } from '#~/config-schema.js'
import type { PiAdapterConfig, PiCommonAdapterConfigKey } from '#~/config-schema.js'

export const resolvePiAdapterConfig = (ctx: Pick<AdapterCtx, 'configState' | 'configs'>) => (
  resolveAdapterConfigWithContribution<PiAdapterConfig, PiCommonAdapterConfigKey>(
    adapterConfigContribution,
    { configState: ctx.configState, configs: ctx.configs }
  )
)
