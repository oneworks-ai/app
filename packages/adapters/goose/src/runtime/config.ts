import type { AdapterCtx } from '@oneworks/types'
import { omitAdapterCommonConfig } from '@oneworks/utils'

import type { GooseAdapterConfig } from '../config-schema'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const deepMerge = (base: Record<string, unknown>, override: Record<string, unknown>) => {
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    result[key] = isRecord(result[key]) && isRecord(value)
      ? deepMerge(result[key] as Record<string, unknown>, value)
      : value
  }
  return result
}

export const resolveGooseAdapterConfig = (
  ctx: Pick<AdapterCtx, 'configState' | 'configs'>
): GooseAdapterConfig => {
  const merged = ctx.configState?.mergedConfig.adapters?.goose
  if (merged != null) {
    return omitAdapterCommonConfig(merged as unknown as Record<string, unknown>) as GooseAdapterConfig
  }

  const project = (ctx.configs[0]?.adapters?.goose ?? {}) as GooseAdapterConfig
  const user = (ctx.configs[1]?.adapters?.goose ?? {}) as GooseAdapterConfig
  return omitAdapterCommonConfig({
    ...project,
    ...user,
    ...(project.cli != null || user.cli != null
      ? { cli: deepMerge(project.cli ?? {}, user.cli ?? {}) }
      : {})
  }) as GooseAdapterConfig
}
