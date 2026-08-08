import { z } from 'zod'

import {
  adapterAccountConfigCommonSchema,
  adapterAccountCredentialConfigSchema,
  adapterAccountStateConfigSchema,
  adapterConfigCommonSchema,
  adapterNativeCliConfigSchema,
  buildConfigUiObjectSchema,
  defineAdapterConfigContribution,
  effortLevelSchema,
  jsonValueSchema
} from '@oneworks/core/config-schema'

const claudeAccountStateSchema = adapterAccountStateConfigSchema.extend({
  type: z.literal('claude-account-state-json').describe('Encoded Claude account state type'),
  version: z.literal(1).optional().describe('Account state format version')
})

export const claudeCodeAdapterAccountSchema = adapterAccountConfigCommonSchema.extend({
  auth: adapterAccountCredentialConfigSchema.optional().describe('Claude credential envelope'),
  state: claudeAccountStateSchema.optional().describe('Sanitized Claude identity and cached usage state'),
  displayName: z.string().optional().describe('Cached Claude account display name'),
  email: z.string().optional().describe('Cached Claude account email'),
  planType: z.string().optional().describe('Cached Claude subscription type'),
  accountType: z.string().optional().describe('Cached Claude authentication method'),
  organizationId: z.string().optional().describe('Cached Claude organization id'),
  organizationTitle: z.string().optional().describe('Cached Claude organization name'),
  quota: jsonValueSchema.optional().describe('Cached Claude usage snapshot'),
  source: z.string().optional().describe('Claude account source'),
  createdAt: z.number().optional().describe('Account creation timestamp'),
  updatedAt: z.number().optional().describe('Account update timestamp'),
  authDigest: z.string().optional().describe('SHA-256 digest of the Claude credential or binding')
})

export const claudeCodeAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Claude Code CLI runtime'),
  routerCli: adapterNativeCliConfigSchema.optional().describe('Managed Claude Code Router CLI runtime'),
  defaultAccount: z.string().optional().describe('Default Claude account key'),
  accounts: z.record(z.string(), claudeCodeAdapterAccountSchema).optional().describe('Available Claude accounts'),
  accountTombstones: z.record(
    z.string(),
    z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  ).optional()
    .describe('Deleted Claude account generations used by cross-device synchronization'),
  effort: effortLevelSchema.optional().describe('Reasoning effort level'),
  ccrOptions: z.object({
    LOG: z.boolean().optional().describe('Enable CCR logging'),
    PORT: z.string().optional().describe('CCR port'),
    HOST: z.string().optional().describe('CCR host'),
    APIKEY: z.string().optional().describe('CCR API key'),
    API_TIMEOUT_MS: z.number().int().positive().optional().describe('CCR API timeout in milliseconds')
  }).optional().describe('Claude Code Router options'),
  ccrTransformers: z.object({
    logger: z.boolean().optional().describe('Enable the CCR logger transformer')
  }).optional().describe('CCR transformer flags'),
  modelFallbacks: z.object({
    default: z.array(z.string()).optional(),
    background: z.array(z.string()).optional(),
    think: z.array(z.string()).optional(),
    longContext: z.array(z.string()).optional()
  }).optional().describe('Model fallback lists'),
  apiTimeout: z.number().int().positive().optional().describe('Claude API timeout in milliseconds'),
  settingsContent: z.record(z.string(), z.unknown()).optional().describe('Raw Claude settings override'),
  nativeEnv: z.record(z.string(), z.string()).optional().describe('Native environment variables')
})

export type ClaudeCodeAdapterConfig = z.infer<typeof claudeCodeAdapterConfigSchema>
export type ClaudeCodeCommonAdapterConfigKey = 'effort'
export type ClaudeCodeNativeAdapterConfig = ClaudeCodeAdapterConfig

const claudeAdapterUiSchema = buildConfigUiObjectSchema(
  adapterConfigCommonSchema.merge(claudeCodeAdapterConfigSchema)
)
const claudeAccountUiSchema = buildConfigUiObjectSchema(claudeCodeAdapterAccountSchema)
const editableClaudeAccountFields = new Set(['title', 'description'])

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'claude-code',
  title: 'Claude Code',
  description: 'Claude Code adapter configuration',
  schema: claudeCodeAdapterConfigSchema,
  uiSchema: {
    ...claudeAdapterUiSchema,
    recordFields: {
      ...claudeAdapterUiSchema.recordFields,
      accounts: {
        ...claudeAdapterUiSchema.recordFields?.accounts,
        itemSchema: {
          ...claudeAccountUiSchema,
          fields: claudeAccountUiSchema.fields.filter(field => (
            field.path.length === 1 && editableClaudeAccountFields.has(field.path[0] ?? '')
          ))
        }
      }
    }
  },
  configEntry: {
    extraCommonKeys: ['effort'] as const,
    deepMergeKeys: [
      'ccrOptions',
      'ccrTransformers',
      'modelFallbacks',
      'settingsContent',
      'nativeEnv',
      'cli',
      'routerCli',
      'accounts',
      'accountTombstones'
    ] as const
  }
})
