import { z } from 'zod'

import { adapterNativeCliConfigSchema, defineAdapterConfigContribution } from '@oneworks/core/config-schema'

export const gooseCliConfigSchema = adapterNativeCliConfigSchema
  .omit({ npmPath: true, package: true })
  .extend({
    variant: z.enum(['standard', 'musl', 'vulkan', 'cuda']).optional()
      .describe('Official release variant; availability depends on the current platform')
  })

export const gooseAdapterConfigSchema = z.object({
  cli: gooseCliConfigSchema.optional().describe('Official Goose CLI release runtime'),
  provider: z.string().min(1).optional().describe('Native Goose provider name'),
  mode: z.enum(['auto', 'approve', 'smart_approve', 'chat']).optional()
    .describe('Native Goose permission mode'),
  inheritNativeAuth: z.boolean().optional()
    .describe('Bridge the native Goose secrets file by symlink without copying credentials')
})

export type GooseAdapterConfig = z.infer<typeof gooseAdapterConfigSchema>
export type GooseCliConfig = z.infer<typeof gooseCliConfigSchema>

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'goose',
  title: 'Goose',
  description: 'Goose CLI adapter configuration',
  schema: gooseAdapterConfigSchema,
  configEntry: {
    deepMergeKeys: ['cli'] as const
  }
})
