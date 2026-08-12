import { z } from 'zod'

import {
  adapterNativeCliConfigSchema,
  defineAdapterConfigContribution,
  effortLevelSchema,
  jsonValueSchema
} from '@oneworks/core/config-schema'

export const grokAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Grok Build CLI runtime'),
  effort: effortLevelSchema.optional().describe('Reasoning effort level'),
  configContent: z.record(z.string(), jsonValueSchema).optional().describe('Raw Grok config.toml override'),
  disableAutoUpdate: z.boolean().optional().describe('Disable Grok auto update checks'),
  disableMemory: z.boolean().optional().describe('Disable Grok cross-session memory'),
  disableSubagents: z.boolean().optional().describe('Disable Grok subagents'),
  disableWebSearch: z.boolean().optional().describe('Disable Grok web search and fetch tools')
})
export type GrokAdapterConfigSchema = z.infer<typeof grokAdapterConfigSchema>

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'grok',
  title: 'Grok',
  description: 'Grok Build CLI adapter configuration',
  schema: grokAdapterConfigSchema,
  configEntry: {
    extraCommonKeys: ['effort'] as const,
    deepMergeKeys: ['cli', 'configContent'] as const
  }
})
