import { z } from 'zod'

import {
  adapterNativeCliConfigSchema,
  defineAdapterConfigContribution,
  jsonValueSchema
} from '@oneworks/core/config-schema'

export const cursorAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Cursor Agent CLI runtime'),
  cliPath: z.string().optional().describe('Cursor Agent CLI binary path'),
  configContent: z.record(z.string(), jsonValueSchema).optional().describe('Raw Cursor CLI config override'),
  mode: z.enum(['agent', 'ask', 'plan']).optional().describe('Cursor execution mode'),
  force: z.boolean().optional().describe('Force-allow commands unless explicitly denied'),
  autoReview: z.boolean().optional().describe('Use Cursor Smart Auto tool review'),
  approveMcps: z.boolean().optional().describe('Automatically approve configured MCP servers'),
  sandbox: z.enum(['enabled', 'disabled']).optional().describe('Cursor sandbox mode'),
  endpoint: z.string().optional().describe('Cursor API endpoint override'),
  additionalDirs: z.array(z.string()).optional().describe('Additional Cursor workspace roots'),
  pluginDirs: z.array(z.string()).optional().describe('Additional local Cursor plugin directories'),
  headers: z.array(z.string()).optional().describe('Additional Cursor API request headers')
})

export type CursorAdapterConfig = z.infer<typeof cursorAdapterConfigSchema>

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'cursor',
  title: 'Cursor',
  description: 'Cursor Agent CLI adapter configuration',
  schema: cursorAdapterConfigSchema,
  configEntry: {
    deepMergeKeys: ['cli', 'configContent'] as const
  }
})
