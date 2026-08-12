import { z } from 'zod'

import {
  adapterAccountConfigCommonSchema,
  adapterAccountCredentialConfigSchema,
  adapterConfigCommonSchema,
  adapterNativeCliConfigSchema,
  buildConfigUiObjectSchema,
  defineAdapterConfigContribution,
  effortLevelSchema,
  jsonValueSchema
} from '@oneworks/core/config-schema'

const codexInlineAuthSchema = z.object({
  storage: z.literal('inline').optional().describe('Inline credential storage'),
  type: z.literal('codex-auth-json').optional().describe('Encoded credential payload type'),
  version: z.literal(1).optional().describe('Credential format version'),
  portability: z.literal('portable').optional().describe('Cross-device portability'),
  encoding: z.literal('base64').describe('Credential payload encoding'),
  token: z.string().describe('Base64 encoded Codex auth.json payload')
})

const codexAdapterAccountSchema = adapterAccountConfigCommonSchema.extend({
  authFile: z.string().optional().describe(
    'Optional explicit path to a Codex auth.json file. Leave empty to use the credentials stored for this account.'
  ),
  auth: z.union([codexInlineAuthSchema, adapterAccountCredentialConfigSchema]).optional().describe(
    'Codex credential envelope; unresolved secret/device bindings are shown as missing on this device'
  ),
  displayName: z.string().optional().describe('Cached Codex account display name'),
  email: z.string().optional().describe('Cached Codex account email'),
  avatarUrl: z.string().optional().describe('Custom Codex account avatar URL'),
  planType: z.string().optional().describe('Cached Codex plan type'),
  accountType: z.string().optional().describe('Cached Codex account type'),
  accountId: z.string().optional().describe('Cached Codex account id'),
  organizationId: z.string().optional().describe('Cached Codex organization id'),
  organizationTitle: z.string().optional().describe('Cached Codex organization title'),
  organizationRole: z.string().optional().describe('Cached Codex organization role'),
  quota: jsonValueSchema.optional().describe('Cached Codex quota snapshot'),
  resetCreditDetailsCapturedAt: z.number().optional()
    .describe('Timestamp when detailed Codex reset-credit cards were captured'),
  source: z.string().optional().describe('Codex account source'),
  createdAt: z.number().optional().describe('Account creation timestamp'),
  updatedAt: z.number().optional().describe('Account update timestamp'),
  authDigest: z.string().optional().describe('SHA-256 digest of the Codex auth payload'),
  priority: z.number().int().optional().describe('Automatic account selection priority'),
  disabled: z.boolean().optional().describe('Exclude this account from automatic selection')
})

export const codexAdapterConfigSchema = z.object({
  cli: adapterNativeCliConfigSchema.optional().describe('Managed Codex CLI runtime'),
  defaultAccount: z.string().optional().describe('Default Codex account key'),
  accountPool: z.object({
    enabled: z.boolean().optional().describe('Automatically select a healthy Codex account for new sessions'),
    strategy: z.literal('sticky-priority').optional().describe('Keep each session on the selected account'),
    cooldownMs: z.number().int().positive().optional().describe('Fallback cooldown for account-scoped failures')
  }).optional().describe('Official Codex account pool selection'),
  shareBuiltinModels: z.boolean().optional().describe(
    'Share Codex built-in models with other One Works adapters and managed Codex clients through the existing PM service'
  ),
  accounts: z.record(z.string(), codexAdapterAccountSchema).optional().describe('Available Codex accounts'),
  accountTombstones: z.record(
    z.string(),
    z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  ).optional()
    .describe('Deleted Codex account generations used by cross-device synchronization'),
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
  features: z.record(z.string(), z.boolean()).optional().describe('Codex feature flag overrides'),
  appServer: z.object({
    idleTimeoutMs: z.number().int().nonnegative().optional()
      .describe('How long an unused shared Codex app-server stays alive')
  }).optional().describe('Shared Codex app-server lifecycle'),
  network: z.object({
    httpProxy: z.string().trim().min(1).optional().describe('HTTP proxy URL'),
    httpsProxy: z.string().trim().min(1).optional().describe('HTTPS proxy URL'),
    allProxy: z.string().trim().min(1).optional().describe('Fallback HTTP(S) proxy URL'),
    noProxy: z.union([
      z.string(),
      z.array(z.string().trim().min(1))
    ]).optional().describe('Hosts that bypass the configured proxy'),
    caCertificate: z.string().trim().min(1).optional()
      .describe('PEM CA bundle used by Codex and routed upstream requests')
  }).optional().describe('Codex adapter network and TLS settings')
})

export type CodexAdapterConfig = z.infer<typeof codexAdapterConfigSchema>
export type CodexCommonAdapterConfigKey = 'effort'
export type CodexNativeAdapterConfig = CodexAdapterConfig

const codexAdapterUiSchema = buildConfigUiObjectSchema(
  adapterConfigCommonSchema.merge(codexAdapterConfigSchema)
)
const codexAccountUiSchema = buildConfigUiObjectSchema(codexAdapterAccountSchema)
const editableCodexAccountFields = new Set(['title', 'description', 'authFile', 'priority', 'disabled'])

export const adapterConfigContribution = defineAdapterConfigContribution({
  adapterKey: 'codex',
  title: 'Codex',
  description: 'Codex adapter configuration',
  schema: codexAdapterConfigSchema,
  uiSchema: {
    ...codexAdapterUiSchema,
    recordFields: {
      ...codexAdapterUiSchema.recordFields,
      accounts: {
        ...codexAdapterUiSchema.recordFields?.accounts,
        itemSchema: {
          ...codexAccountUiSchema,
          fields: codexAccountUiSchema.fields.filter(field => (
            field.path.length === 1 && editableCodexAccountFields.has(field.path[0] ?? '')
          ))
        }
      }
    }
  },
  configEntry: {
    extraCommonKeys: ['effort'] as const,
    deepMergeKeys: [
      'cli',
      'accountPool',
      'accounts',
      'accountTombstones',
      'sandboxPolicy',
      'clientInfo',
      'configOverrides',
      'features',
      'appServer',
      'network'
    ] as const
  }
})
