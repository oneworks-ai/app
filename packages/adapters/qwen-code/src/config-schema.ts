import { z } from 'zod'

import { adapterNativeCliConfigSchema, defineAdapterConfigContribution } from '@oneworks/core/config-schema'

export const qwenCodeAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Qwen Code CLI runtime'),
  disableAutoUpdate: z.boolean().optional().describe('Disable Qwen Code automatic update checks'),
  disableExtensions: z.boolean().optional().describe('Disable ambient Qwen Code extensions'),
  disableSubagents: z.boolean().optional().describe('Disable native Qwen Code subagent tools'),
  nativePromptCommands: z.enum(['allow', 'reject']).optional().describe('Native prompt command behavior'),
  settingsContent: z.record(z.string(), z.unknown()).optional().describe(
    'Additional non-provider settings for the isolated Qwen home; routed models use OpenAI Chat Completions only'
  ),
  telemetry: z.enum(['inherit', 'off']).optional().describe('Telemetry mode')
})

export type QwenCodeAdapterConfigSchema = z.infer<typeof qwenCodeAdapterConfigSchema>

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'qwen-code',
  title: 'Qwen Code',
  description: 'Qwen Code adapter configuration',
  schema: qwenCodeAdapterConfigSchema,
  configEntry: {
    deepMergeKeys: ['cli', 'settingsContent'] as const
  }
})
