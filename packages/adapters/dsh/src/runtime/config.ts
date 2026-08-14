import { resolveAdapterConfigWithContribution } from '@oneworks/config'
import type { AdapterCtx } from '@oneworks/types'

import { adapterConfigContribution } from '../config-schema'
import type { DshAdapterConfig, DshCommonAdapterConfigKey } from '../config-schema'

export const resolveDshAdapterConfig = (ctx: Pick<AdapterCtx, 'configState' | 'configs'>): DshAdapterConfig => (
  resolveAdapterConfigWithContribution<DshAdapterConfig, DshCommonAdapterConfigKey>(
    adapterConfigContribution,
    { configState: ctx.configState, configs: ctx.configs }
  ).native
)
