import { z } from 'zod'

import {
  adapterNativeCliConfigSchema,
  defineAdapterConfigContribution,
  effortLevelSchema
} from '@oneworks/core/config-schema'

export const dshAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed DeepSeek Harness ACP runtime'),
  effort: effortLevelSchema.optional().describe('Default DSH reasoning effort'),
  baseUrl: z.string().url().optional().describe('Optional DeepSeek-compatible API base URL'),
  allowUnrestrictedReadNetwork: z.boolean().optional().describe(
    'Explicitly acknowledge that DSH rc.6 does not confine host reads or network access'
  ),
  startupTimeoutMs: z.number().int().min(100).max(300_000).optional().describe('ACP startup timeout in milliseconds')
})

export type DshAdapterConfig = z.infer<typeof dshAdapterConfigSchema>
export type DshCommonAdapterConfigKey = 'effort'

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'dsh',
  title: 'DSH',
  description: 'DeepSeek Harness adapter configuration',
  schema: dshAdapterConfigSchema,
  configEntry: {
    extraCommonKeys: ['effort'] as const,
    deepMergeKeys: ['cli'] as const
  }
})
