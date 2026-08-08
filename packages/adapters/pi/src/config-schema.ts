import { z } from 'zod'

import {
  adapterNativeCliConfigSchema,
  defineAdapterConfigContribution,
  effortLevelSchema
} from '@oneworks/core/config-schema'

export const piAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Pi CLI runtime'),
  effort: effortLevelSchema.optional().describe('Default Pi reasoning effort'),
  provider: z.string().min(1).optional().describe('Default Pi provider for native model names'),
  inheritNativeSettings: z.boolean().optional().describe('Copy sanitized native Pi settings and models'),
  enableNativeExtensions: z.boolean().optional().describe(
    'Allow reviewed native Pi extensions and explicitly selected custom tools'
  ),
  projectTrust: z.enum(['never', 'always']).optional().describe('Pi project resource trust override'),
  telemetry: z.enum(['off', 'inherit']).optional().describe('Pi telemetry mode'),
  disableVersionCheck: z.boolean().optional().describe('Disable Pi startup version checks'),
  offline: z.boolean().optional().describe('Disable Pi startup network operations')
})

export type PiAdapterConfig = z.infer<typeof piAdapterConfigSchema>
export type PiCommonAdapterConfigKey = 'effort'

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'pi',
  title: 'Pi',
  description: 'Pi coding-agent adapter configuration',
  schema: piAdapterConfigSchema,
  configEntry: {
    extraCommonKeys: ['effort'] as const,
    deepMergeKeys: ['cli'] as const
  }
})
