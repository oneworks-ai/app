import { z } from 'zod'

import {
  adapterAccountConfigCommonSchema,
  adapterNativeCliConfigSchema,
  defineAdapterConfigContribution,
  effortLevelSchema,
  jsonValueSchema
} from '@oneworks/core/config-schema'

const codexAdapterAccountSchema = adapterAccountConfigCommonSchema.extend({
  authFile: z.string().optional().describe('Path to the Codex auth.json file for this account'),
  auth: z.object({
    type: z.literal('codex-auth-json').optional().describe('Encoded credential payload type'),
    encoding: z.literal('base64').describe('Credential payload encoding'),
    token: z.string().describe('Base64 encoded Codex auth.json payload')
  }).optional().describe('Inline Codex auth.json payload stored in the global OneWorks config'),
  email: z.string().optional().describe('Cached Codex account email'),
  avatarUrl: z.string().optional().describe('Custom Codex account avatar URL'),
  planType: z.string().optional().describe('Cached Codex plan type'),
  accountType: z.string().optional().describe('Cached Codex account type'),
  accountId: z.string().optional().describe('Cached Codex account id'),
  organizationId: z.string().optional().describe('Cached Codex organization id'),
  organizationTitle: z.string().optional().describe('Cached Codex organization title'),
  organizationRole: z.string().optional().describe('Cached Codex organization role'),
  quota: jsonValueSchema.optional().describe('Cached Codex quota snapshot'),
  source: z.string().optional().describe('Codex account source'),
  createdAt: z.number().optional().describe('Account creation timestamp'),
  updatedAt: z.number().optional().describe('Account update timestamp'),
  authDigest: z.string().optional().describe('SHA-256 digest of the Codex auth payload')
})

export const codexAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Codex CLI runtime'),
  defaultAccount: z.string().optional().describe('Default Codex account key'),
  accounts: z.record(z.string(), codexAdapterAccountSchema).optional().describe('Available Codex accounts'),
  sandboxPolicy: z.object({
    type: z.enum(['readOnly', 'workspaceWrite', 'dangerFullAccess', 'externalSandbox'])
      .describe('Sandbox policy type'),
    writableRoots: z.array(z.string()).optional().describe('Additional writable roots'),
    networkAccess: z.union([
      z.boolean(),
      z.enum(['restricted', 'enabled'])
    ]).optional().describe('Network access mode')
  }).optional().describe('Sandbox policy passed to Codex'),
  experimentalApi: z.boolean().optional().describe('Enable experimental Codex API surface'),
  clientInfo: z.object({
    name: z.string().optional().describe('Client name'),
    title: z.string().optional().describe('Client title'),
    version: z.string().optional().describe('Client version')
  }).optional().describe('Client metadata reported to Codex'),
  effort: effortLevelSchema.optional().describe('Reasoning effort level'),
  configOverrides: z.record(z.string(), jsonValueSchema).optional()
    .describe('Raw Codex config overrides encoded as dotted keys'),
  maxOutputTokens: z.number().int().positive().optional().describe('Maximum output tokens per turn'),
  features: z.record(z.string(), z.boolean()).optional().describe('Codex feature flag overrides')
})

export type CodexAdapterConfig = z.infer<typeof codexAdapterConfigSchema>
export type CodexCommonAdapterConfigKey = 'effort'
export type CodexNativeAdapterConfig = CodexAdapterConfig

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'codex',
  title: 'Codex',
  description: 'Codex adapter configuration',
  schema: codexAdapterConfigSchema,
  configEntry: {
    extraCommonKeys: ['effort'] as const,
    deepMergeKeys: ['cli', 'accounts', 'sandboxPolicy', 'clientInfo', 'configOverrides', 'features'] as const
  }
})
