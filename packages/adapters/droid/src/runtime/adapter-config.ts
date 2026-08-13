import { resolveAdapterConfigWithContribution as resolveMergedAdapterConfig } from '@oneworks/config'
import type { AdapterConfigEntry, AdapterCtx } from '@oneworks/types'
import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'

import { adapterConfigContribution } from '../config-schema'
import type { DROID_SUPPORTED_EFFORTS, DroidCommonAdapterConfigKey } from '../config-schema'

export interface DroidAdapterNativeConfig {
  cli?: ManagedNpmCliConfig
  configContent?: Record<string, unknown>
  disableBuiltinSkills?: boolean
  effort?: typeof DROID_SUPPORTED_EFFORTS[number]
}

export type DroidAdapterConfig = AdapterConfigEntry<DroidAdapterNativeConfig>

export const resolveDroidAdapterConfig = (
  ctx: Pick<AdapterCtx, 'configState' | 'configs'>
) => (
  resolveMergedAdapterConfig<DroidAdapterConfig, DroidCommonAdapterConfigKey>(
    adapterConfigContribution,
    { configState: ctx.configState, configs: ctx.configs }
  )
)
