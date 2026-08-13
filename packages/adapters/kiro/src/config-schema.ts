import { z } from 'zod'

import {
  adapterNativeCliConfigSchema,
  defineAdapterConfigContribution,
  jsonValueSchema
} from '@oneworks/core/config-schema'

export const kiroAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Kiro CLI runtime'),
  cliPath: z.string().optional().describe('Kiro CLI binary path'),
  configContent: z.record(z.string(), jsonValueSchema).optional().describe('Raw Kiro CLI settings override'),
  agentConfig: z.record(z.string(), jsonValueSchema).optional().describe('Raw managed Kiro custom-agent override'),
  additionalDirs: z.array(z.string()).optional().describe('Additional Kiro ACP workspace roots')
})

export type KiroAdapterConfig = z.infer<typeof kiroAdapterConfigSchema>

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'kiro',
  title: 'Kiro',
  description: 'Kiro CLI adapter configuration',
  schema: kiroAdapterConfigSchema,
  configEntry: {
    deepMergeKeys: ['cli', 'configContent', 'agentConfig'] as const
  }
})
