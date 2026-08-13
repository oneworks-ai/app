import { z } from 'zod'

import { adapterNativeCliConfigSchema, defineAdapterConfigContribution } from '@oneworks/core/config-schema'

export const clineAdapterConfigSchema = z.object({
  authMethod: z.string().min(1).max(128).optional().describe(
    'Exact ACP authentication method id to invoke explicitly before session creation'
  ),
  authTimeoutMs: z.number().int().min(60_000).max(86_400_000).optional().describe(
    'Optional human-usable ACP authentication deadline; omitted waits until task cancellation or child exit'
  ),
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Cline CLI runtime'),
  credentialEnv: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/u)).max(16).optional().describe(
    'Explicit process environment variable names selected for the configured native provider'
  ),
  provider: z.string().min(1).optional().describe('Native Cline provider id'),
  inheritNativeAuth: z.literal(false).optional().describe(
    'Native authentication inheritance is unsupported for the verified Cline 3.0.54 boundary'
  ),
  telemetry: z.enum(['off', 'inherit']).optional().describe('Cline telemetry mode')
})

export type ClineAdapterConfig = z.infer<typeof clineAdapterConfigSchema>

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'cline',
  title: 'Cline',
  description: 'Cline CLI adapter configuration',
  schema: clineAdapterConfigSchema,
  configEntry: {
    deepMergeKeys: ['cli'] as const
  }
})
