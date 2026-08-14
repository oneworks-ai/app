import { z } from 'zod'

import {
  adapterNativeCliConfigSchema,
  defineAdapterConfigContribution,
  jsonValueSchema
} from '@oneworks/core/config-schema'

import { JUNIE_SUPPORTED_EFFORTS } from './effort'

export const junieAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed JetBrains Junie CLI runtime'),
  configContent: z.record(z.string(), jsonValueSchema).optional()
    .describe('Non-secret Junie config.json overrides; credential-like values are omitted from session persistence'),
  provider: z.enum(['openai', 'anthropic', 'google', 'xai', 'openrouter', 'copilot', 'litellm']).optional()
    .describe('Junie BYOK provider; credentials must be supplied by the provider environment'),
  effort: z.enum(JUNIE_SUPPORTED_EFFORTS).optional().describe('Junie reasoning effort'),
  review: z.boolean().optional().describe('Run Junie code review mode'),
  agentMode: z.enum(['classic', 'chat']).optional().describe('Junie agent mode'),
  disableAutoUpdate: z.boolean().optional().describe('Skip Junie update checks'),
  shareAnonymousStatistics: z.boolean().optional().describe('Share anonymous Junie usage statistics')
})

export type JunieAdapterConfig = z.infer<typeof junieAdapterConfigSchema>

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'junie',
  title: 'Junie',
  description: 'JetBrains Junie CLI adapter configuration',
  schema: junieAdapterConfigSchema,
  configEntry: {
    extraCommonKeys: ['effort'] as const,
    deepMergeKeys: ['cli', 'configContent'] as const
  }
})
