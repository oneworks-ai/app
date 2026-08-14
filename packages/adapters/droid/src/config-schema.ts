import { z } from 'zod'

import {
  adapterConfigCommonSchema,
  adapterNativeCliConfigSchema,
  buildConfigUiObjectSchema,
  defineAdapterConfigContribution,
  jsonValueSchema
} from '@oneworks/core/config-schema'

export const DROID_SUPPORTED_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const droidEffortSchema = z.enum(DROID_SUPPORTED_EFFORTS)

export const droidAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Factory Droid CLI runtime'),
  effort: droidEffortSchema.optional().describe('Factory Droid reasoning effort'),
  configContent: z.record(z.string(), jsonValueSchema).optional().describe('Session-scoped Factory settings override'),
  disableBuiltinSkills: z.boolean().optional().describe('Disable Factory built-in skills for this session')
})

export type DroidAdapterConfigSchema = z.infer<typeof droidAdapterConfigSchema>
export type DroidCommonAdapterConfigKey = 'effort'

const droidAdapterUiSchema = buildConfigUiObjectSchema(
  adapterConfigCommonSchema.merge(droidAdapterConfigSchema)
)
const droidFieldMetadata = {
  cli: {
    label: 'Factory Droid CLI',
    description: 'Select and configure the validated Factory Droid CLI runtime.'
  },
  effort: {
    label: 'Reasoning effort',
    description: 'Reasoning effort sent to Factory Droid for this session.'
  },
  configContent: {
    label: 'Factory settings override',
    description: 'Session-scoped Factory settings merged into the isolated runtime configuration.'
  },
  disableBuiltinSkills: {
    label: 'Disable built-in skills',
    description: 'Disable Factory built-in skills for this session.'
  }
} as const
const droidUiSchema = {
  ...droidAdapterUiSchema,
  fields: droidAdapterUiSchema.fields.map((field) => {
    const metadata = droidFieldMetadata[field.path[0] as keyof typeof droidFieldMetadata]
    if (metadata == null) return field
    return {
      ...field,
      ...metadata,
      ...(field.path[0] === 'effort'
        ? { options: DROID_SUPPORTED_EFFORTS.map(value => ({ label: value, value })) }
        : {})
    }
  })
}

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'droid',
  capabilities: { accounts: false },
  title: 'Factory Droid',
  description: 'Factory Droid CLI adapter configuration',
  schema: droidAdapterConfigSchema,
  uiSchema: droidUiSchema,
  configEntry: {
    extraCommonKeys: ['effort'] as const,
    deepMergeKeys: ['cli', 'configContent'] as const
  }
})
