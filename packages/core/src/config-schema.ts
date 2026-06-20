/* eslint-disable max-lines -- central config schema registry */
import { z } from 'zod'

import type { ConfigUiField, ConfigUiFieldType, ConfigUiObjectSchema, ConfigUiRecordFieldSchema } from '@oneworks/types'

import { channelBaseSchema } from './channel'

export interface ConfigSemanticIssue {
  path?: string[]
  message: string
}

type AdapterConfigSchemaKey<TSchema extends z.AnyZodObject> = Extract<keyof z.infer<TSchema>, string>

export interface AdapterConfigEntryMetadata<
  TSchema extends z.AnyZodObject = z.AnyZodObject,
  TExtraCommonKey extends AdapterConfigSchemaKey<TSchema> = never,
> {
  extraCommonKeys?: readonly TExtraCommonKey[]
  deepMergeKeys?: readonly AdapterConfigSchemaKey<TSchema>[]
}

export interface AdapterConfigContribution<
  TSchema extends z.AnyZodObject = z.AnyZodObject,
  TExtraCommonKey extends AdapterConfigSchemaKey<TSchema> = never,
> {
  adapterKey: string
  title?: string
  description?: string
  schema: TSchema
  uiSchema?: ConfigUiObjectSchema
  configEntry?: AdapterConfigEntryMetadata<TSchema, TExtraCommonKey>
  validate?: (value: z.infer<TSchema>) => readonly ConfigSemanticIssue[] | void
}

export const defineAdapterConfigContribution = <
  TSchema extends z.AnyZodObject,
  TExtraCommonKey extends AdapterConfigSchemaKey<TSchema> = never,
>(
  contribution: AdapterConfigContribution<TSchema, TExtraCommonKey>
) => contribution

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
)

export const effortLevelSchema = z.enum(['low', 'medium', 'high', 'max'])
export const languageCodeSchema = z.enum(['zh', 'en'])

export const adapterAccountConfigCommonSchema = z.object({
  title: z.string().optional().describe('Display title'),
  description: z.string().optional().describe('Display description')
})

export const adapterConfigCommonSchema = z.object({
  packageId: z.string().optional()
    .describe('Runtime adapter package name or package root path for this adapter instance'),
  defaultModel: z.string().optional().describe('Default model override for this adapter'),
  includeModels: z.array(z.string()).optional().describe('Allowed model IDs for this adapter'),
  excludeModels: z.array(z.string()).optional().describe('Blocked model IDs for this adapter'),
  defaultAccount: z.string().optional().describe('Default account override for this adapter'),
  accounts: z.record(z.string(), adapterAccountConfigCommonSchema).optional()
    .describe('Adapter account display metadata')
})

export const adapterNativeCliConfigSchema = z.object({
  source: z.enum(['managed', 'system', 'path']).optional().describe('Native CLI source'),
  path: z.string().optional().describe('Native CLI binary path when source is path'),
  package: z.string().optional().describe('Managed npm package name'),
  version: z.string().optional().describe('Managed npm package version'),
  autoInstall: z.boolean().optional().describe('Install the managed CLI when no usable binary is found'),
  prepareOnInstall: z.boolean().optional().describe('Preinstall this managed CLI during One Works package install'),
  npmPath: z.string().optional().describe('npm binary used for managed installs')
})

export const modelServiceConfigSchema = z.object({
  kind: z.enum(['service', 'collection']).optional().describe('Model service entry kind'),
  title: z.string().optional().describe('Display title'),
  description: z.string().optional().describe('Display description'),
  provider: z.string().min(1).optional().describe('Known provider id used to apply defaults'),
  icon: z.string().optional().describe('Service icon override'),
  homepageUrl: z.string().optional().describe('Provider management homepage override'),
  apiBaseUrl: z.string().min(1).optional().describe('Provider API base URL override'),
  apiKey: z.string().min(1).optional().describe('Provider API key'),
  models: z.array(z.string()).optional().describe('Supported model IDs'),
  timeoutMs: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
  maxOutputTokens: z.number().int().positive().optional().describe('Default max output tokens'),
  billing: jsonValueSchema.optional().describe('Provider billing metadata'),
  codingPlan: jsonValueSchema.optional().describe('Provider coding-plan metadata'),
  providerOptions: z.record(z.string(), jsonValueSchema).optional().describe('Provider-specific management options'),
  management: z.object({
    enabled: z.boolean().optional().describe('Enable provider management API actions'),
    apiKey: z.string().optional().describe('Provider management API key'),
    baseUrl: z.string().optional().describe('Provider management API base URL'),
    headers: z.record(z.string(), z.string()).optional().describe('Provider management API request headers'),
    organizationId: z.string().optional().describe('Provider organization id'),
    userId: z.string().optional().describe('Provider management user id'),
    projectId: z.string().optional().describe('Provider project id'),
    endpointKind: z.string().optional().describe('Provider management endpoint kind')
  }).passthrough().optional().describe('Provider management API credentials and options'),
  profiles: z.record(z.string(), jsonValueSchema).optional().describe('Collection child model-service profiles'),
  services: z.record(z.string(), jsonValueSchema).optional().describe('Legacy alias for collection child services'),
  extra: z.record(z.string(), jsonValueSchema).optional().describe('Provider-specific extra config')
}).passthrough()

export const recommendedModelConfigSchema = z.object({
  service: z.string().optional().describe('Model service key'),
  model: z.string().min(1).describe('Model ID'),
  title: z.string().optional().describe('Display title'),
  description: z.string().optional().describe('Display description'),
  placement: z.enum(['modelSelector']).optional().describe('UI placement')
})

export const modelMetadataConfigSchema = z.object({
  alias: z.union([z.string(), z.array(z.string())]).optional().describe('Model aliases'),
  title: z.string().optional().describe('Display title'),
  description: z.string().optional().describe('Display description'),
  icon: z.string().optional().describe('Model icon override'),
  defaultAdapter: z.string().optional().describe('Preferred adapter key'),
  effort: effortLevelSchema.optional().describe('Recommended effort level')
})

export const notificationEventConfigSchema = z.object({
  title: z.string().optional().describe('Notification title override'),
  description: z.string().optional().describe('Notification description override'),
  disabled: z.boolean().optional().describe('Disable this notification event'),
  sound: z.string().optional().describe('Custom sound asset')
})

export const notificationConfigSchema = z.object({
  disabled: z.boolean().optional().describe('Disable notifications'),
  volume: z.number().min(0).max(100).optional().describe('Notification volume'),
  events: z.object({
    completed: notificationEventConfigSchema.optional(),
    failed: notificationEventConfigSchema.optional(),
    terminated: notificationEventConfigSchema.optional(),
    waiting_input: notificationEventConfigSchema.optional()
  }).optional().describe('Per-event notification overrides')
})

export const messageLinksConfigSchema = z.object({
  externalLinkTarget: z.enum(['newTab', 'currentTab']).optional()
    .describe('How external links in chat messages open'),
  workspaceFileTarget: z.enum(['fileTab', 'externalIde', 'defaultLink']).optional()
    .describe('How workspace-relative file links in chat messages open'),
  workspaceFileOpener: z.enum([
    'auto',
    'vscode',
    'cursor',
    'windsurf',
    'zed',
    'intellij',
    'webstorm',
    'pycharm',
    'goland',
    'textedit'
  ]).optional().describe('Preferred external app for workspace file links'),
  imageLinkMode: z.enum(['inlinePreview', 'link']).optional()
    .describe('How image-looking links in chat messages render'),
  plainWorkspacePathMode: z.enum(['link', 'text']).optional()
    .describe('Whether plain workspace file paths in message text become links')
})

const appearancePrimaryColorSchema = z.enum(['#E23F12', '#3F7E8F', '#00B454', '#8B9493'])
const appearanceThemeModeSchema = z.enum(['system', 'light', 'dark'])
const iconBackgroundSchema = z.enum(['transparent', 'solid', 'textured'])
const desktopIconAppearanceSchema = z.enum(['system', 'light', 'dark'])
const desktopIconThemeSchema = z.enum(['industrial', 'metal', 'matrix'])
const desktopUpdateChannelSchema = z.enum(['stable', 'rc', 'beta', 'alpha'])

export const appearanceConfigSchema = z.object({
  primaryColor: appearancePrimaryColorSchema.optional()
    .describe('Global app primary color preset'),
  themeMode: appearanceThemeModeSchema.optional()
    .describe('Global app light/dark/system theme mode')
})

export const desktopConfigSchema = z.object({
  launcherShortcut: z.string().optional().describe('Global desktop launcher shortcut'),
  openLastWorkspaceOnStartup: z.boolean().optional()
    .describe('Open the most recent desktop workspace when the app starts without an explicit workspace'),
  syncAppIcon: z.boolean().optional().describe('Sync the desktop app icon with the selected icon style'),
  iconAppearance: desktopIconAppearanceSchema.optional().describe('Desktop app icon appearance mode'),
  iconBackground: iconBackgroundSchema.optional().describe('Desktop app icon background style'),
  iconTheme: desktopIconThemeSchema.optional().describe('Desktop app icon theme'),
  autoUpdate: z.boolean().optional().describe('Enable automatic desktop update checks and downloads'),
  updateChannel: desktopUpdateChannelSchema.optional().describe('Default desktop and module update channel'),
  moduleUpdateChannels: z.record(z.string(), desktopUpdateChannelSchema).optional()
    .describe('Per-module update channel overrides keyed by module id or package name')
})

export const permissionsConfigSchema = z.object({
  allow: z.array(z.string()).optional().describe('Allowed tools'),
  deny: z.array(z.string()).optional().describe('Denied tools'),
  ask: z.array(z.string()).optional().describe('Tools that always ask'),
  defaultMode: z.enum(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']).optional()
    .describe('Default permission mode')
})

export const shortcutsConfigSchema = z.object({
  newSession: z.string().optional().describe('Shortcut for creating a new session'),
  openConfig: z.string().optional().describe('Shortcut for opening config'),
  sendMessage: z.string().optional().describe('Shortcut for sending a message'),
  clearInput: z.string().optional().describe('Shortcut for clearing the composer'),
  switchModel: z.string().optional().describe('Shortcut for switching models'),
  switchEffort: z.string().optional().describe('Shortcut for switching effort'),
  switchPermissionMode: z.string().optional().describe('Shortcut for switching permission mode')
})

export const conversationStarterModeSchema = z.enum([
  'default',
  'workspace',
  'entity',
  'agent',
  'spec'
])

export const conversationStarterWorktreeConfigSchema = z.object({
  create: z.boolean().optional().describe('Override whether the session uses a managed worktree'),
  environment: z.string().optional().describe('Managed worktree environment override'),
  branch: z.object({
    name: z.string().min(1).describe('Branch name'),
    kind: z.enum(['local', 'remote']).optional().describe('Branch kind'),
    mode: z.enum(['checkout', 'create']).optional().describe('Branch operation mode')
  }).optional().describe('Branch selection override')
})

export const conversationStarterConfigSchema = z.object({
  id: z.string().optional().describe('Stable starter identifier'),
  title: z.string().min(1).describe('Starter title'),
  description: z.string().optional().describe('Starter description'),
  icon: z.string().optional().describe('Material Symbols icon name'),
  mode: conversationStarterModeSchema.optional().describe('Target mode, `agent` is an alias for `entity`'),
  target: z.string().optional().describe('Target resource name or workspace id'),
  targetLabel: z.string().optional().describe('Optional target label shown in the UI'),
  targetDescription: z.string().optional().describe('Optional target description shown in the UI'),
  model: z.string().optional().describe('Model id or service-prefixed model value'),
  adapter: z.string().optional().describe('Adapter override'),
  account: z.string().optional().describe('Account override'),
  effort: z.union([z.literal('default'), effortLevelSchema]).optional().describe('Effort override'),
  permissionMode: z.enum(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']).optional()
    .describe('Permission mode override'),
  worktree: conversationStarterWorktreeConfigSchema.optional().describe('Managed worktree overrides'),
  prompt: z.string().optional().describe('Prefilled prompt'),
  files: z.array(z.string()).optional().describe('Referenced file paths'),
  rules: z.array(z.string()).optional().describe('Referenced rule paths or rule identifiers'),
  skills: z.array(z.string()).optional().describe('Referenced skill paths or skill identifiers')
})

export const conversationRunCommandEnvVarConfigSchema = z.object({
  key: z.string().regex(/^[a-z_]\w*$/i).describe('Environment variable name'),
  value: z.string().describe('Environment variable value')
})

export const conversationRunCommandConfigSchema = z.object({
  id: z.string().optional().describe('Stable run command identifier'),
  name: z.string().optional().describe('Display name'),
  icon: z.string().optional().describe('Material Symbols icon name'),
  script: z.string().min(1).describe('Shell script to run from the workspace'),
  cwd: z.string().optional().describe('Working directory used before the script runs'),
  env: z.array(conversationRunCommandEnvVarConfigSchema).optional()
    .describe('Environment variables exported before the script runs'),
  isFavorite: z.boolean().optional().describe('Pin this run command as a favorite')
})

export const conversationConfigSchema = z.object({
  style: z.enum(['friendly', 'programmatic']).optional().describe('Conversation style'),
  customInstructions: z.string().optional().describe('Extra system instructions'),
  injectDefaultSystemPrompt: z.boolean().optional().describe('Inject the default system prompt'),
  showSessionCardMessage: z.boolean().optional().describe('Show message previews in sidebar session cards'),
  createSessionWorktree: z.boolean().optional().describe('Create a managed worktree for new sessions by default'),
  worktreeEnvironment: z.string().optional().describe('Default managed worktree environment'),
  startupPresets: z.array(conversationStarterConfigSchema).optional()
    .describe('Quick-start presets shown on the new session page'),
  builtinActions: z.array(conversationStarterConfigSchema).optional()
    .describe('Built-in development actions shown on the new session page'),
  runCommands: z.array(conversationRunCommandConfigSchema).optional()
    .describe('Workspace run commands shown in the chat header')
})

export const webAuthAccountConfigSchema = z.object({
  username: z.string().min(1).describe('Login username'),
  password: z.string().min(1).describe('Login password')
})

export const webAuthConfigSchema = z.object({
  enabled: z.boolean().optional().describe('Enable Web UI login protection'),
  username: z.string().optional().describe('Fallback single-account username'),
  password: z.string().optional().describe('Fallback single-account password'),
  accounts: z.array(webAuthAccountConfigSchema).optional().describe('Allowed Web UI login accounts'),
  sessionTtlHours: z.number().positive().optional().describe('Browser session token lifetime in hours'),
  rememberDeviceTtlDays: z.number().positive().optional().describe('Remember-device token lifetime in days')
})

export const serverConfigSchema = z.object({
  public: z.object({
    schema: z.enum(['http', 'https']).default('https')
      .describe('Public URL schema used to build this server external base URL'),
    domain: z.string().min(1).optional()
      .describe('Public domain used to build this server external base URL'),
    port: z.number().int().positive().optional()
      .describe('Optional public port used to build this server external base URL')
  }).optional().describe('Public server endpoint used by channel webhooks and external action links'),
  publicPaths: z.array(z.string().min(1)).optional()
    .describe('Extra public paths allowed on non-local hosts; channel webhook paths are always allowed')
})

export const speechToTextCapabilitiesConfigSchema = z.object({
  streaming: z.boolean().optional().describe('Whether this service supports streaming transcription'),
  diarization: z.boolean().optional().describe('Whether this service can identify speakers'),
  wordTimestamps: z.boolean().optional().describe('Whether this service can return word timestamps'),
  languageDetection: z.boolean().optional().describe('Whether this service can detect spoken language')
})

export const speechToTextServiceCommonConfigSchema = z.object({
  label: z.string().optional().describe('Display label'),
  description: z.string().optional().describe('Display description'),
  provider: z.string().min(1).describe('Speech-to-text provider kind'),
  enabled: z.boolean().optional().describe('Enable this service'),
  language: z.string().optional().describe('Default language, or auto'),
  prompt: z.string().optional().describe('Default provider prompt or vocabulary hint'),
  timeoutMs: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
  maxDurationSeconds: z.number().int().positive().optional().describe('Maximum recording duration'),
  maxBytes: z.number().int().positive().optional().describe('Maximum audio payload bytes'),
  capabilities: speechToTextCapabilitiesConfigSchema.optional().describe('Declared service capabilities')
})

export const speechToTextOpenAITranscriptionsConfigSchema = speechToTextServiceCommonConfigSchema.extend({
  provider: z.literal('openai-transcriptions'),
  baseUrl: z.string().url().optional().describe('OpenAI-compatible API base URL'),
  apiKey: z.string().optional().describe('API key. Prefer apiKeyEnv for shared config files'),
  apiKeyEnv: z.string().optional().describe('Environment variable that stores the API key'),
  model: z.string().min(1).describe('Transcription model id'),
  responseFormat: z.enum(['json', 'text', 'srt', 'verbose_json', 'vtt']).optional()
    .describe('Provider response format')
})

export const speechToTextCustomHttpBodyConfigSchema = z.object({
  kind: z.enum(['multipart', 'binary', 'json']).describe('Custom HTTP request body kind'),
  fileField: z.string().optional().describe('Multipart file field name'),
  audioBase64Field: z.string().optional().describe('JSON field that receives the base64 audio'),
  fields: z.record(z.string(), jsonValueSchema).optional().describe('Static or templated request fields')
})

export const speechToTextCustomHttpRequestConfigSchema = z.object({
  method: z.enum(['POST', 'PUT']).optional().describe('HTTP method'),
  url: z.string().url().describe('Custom speech-to-text endpoint URL'),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers, supports $' + '{env:NAME}'),
  body: speechToTextCustomHttpBodyConfigSchema.optional().describe('Request body mapping')
})

export const speechToTextCustomHttpResponseConfigSchema = z.object({
  textPath: z.string().optional().describe('Dot path for transcript text'),
  languagePath: z.string().optional().describe('Dot path for detected language'),
  segmentsPath: z.string().optional().describe('Dot path for transcript segments'),
  wordsPath: z.string().optional().describe('Dot path for word timestamps')
})

export const speechToTextCustomHttpConfigSchema = speechToTextServiceCommonConfigSchema.extend({
  provider: z.literal('custom-http'),
  request: speechToTextCustomHttpRequestConfigSchema,
  response: speechToTextCustomHttpResponseConfigSchema.optional()
})

export const speechToTextServiceConfigSchema = z.discriminatedUnion('provider', [
  speechToTextOpenAITranscriptionsConfigSchema,
  speechToTextCustomHttpConfigSchema
])

export const voiceConfigSchema = z.object({
  speechToText: z.object({
    defaultServiceId: z.string().optional().describe('Default speech-to-text service id'),
    showInSender: z.boolean().optional().describe('Show speech-to-text controls in the sender'),
    services: z.record(z.string(), speechToTextServiceConfigSchema).optional()
      .describe('Configured speech-to-text services')
  }).optional().describe('Speech-to-text configuration')
})

export const skillRegistryPublishConfigSchema = z.object({
  access: z.string().optional().describe('Default publish access passed to the skills CLI'),
  group: z.string().optional().describe('Default publish group passed to the skills CLI'),
  region: z.string().optional().describe('Default publish region passed to the skills CLI')
})

export const configuredSkillRegistrySchema = z.object({
  title: z.string().optional().describe('Display title'),
  description: z.string().optional().describe('Display description'),
  source: z.string().min(1).describe('Skills CLI source path used for listing and installing skills'),
  registry: z.string().optional().describe('npm registry used to install the managed skills CLI'),
  publish: skillRegistryPublishConfigSchema.optional().describe(
    'Default publish options for skills bound to this registry'
  )
})

export const skillHomeBridgeConfigSchema = z.object({
  enabled: z.boolean().optional().describe('Bridge supported home skill roots into workspace asset discovery'),
  roots: z.union([z.string(), z.array(z.string())]).optional()
    .describe('Ordered home skill roots. Supports absolute paths or paths starting with ~')
})

export const configuredSkillIncludeConfigSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1).describe('Remote skill name'),
    rename: z.string().optional().describe('Local skill name to expose after install'),
    version: z.string().optional().describe('Remote skill version passed to the skills CLI')
  })
])

export const configuredSkillInstallEntryConfigSchema = z.object({
  name: z.string().min(1).describe('Remote skill name'),
  registry: z.string().optional().describe('Package registry used to install the managed skills CLI'),
  source: z.string().optional().describe('Remote skills CLI source path'),
  version: z.string().optional().describe('Remote skill version passed to the skills CLI'),
  rename: z.string().optional().describe('Local skill name to expose after install')
})

export const configuredSkillCollectionConfigSchema = z.object({
  source: z.string().min(1).describe('Remote skills CLI source path'),
  registry: z.string().optional().describe('Package registry used to install the managed skills CLI'),
  version: z.string().optional().describe('Remote source version passed to the skills CLI'),
  include: z.array(configuredSkillIncludeConfigSchema).optional()
    .describe('Skills to install from this source. "*" or an omitted include installs all skills from the source.')
})

export const configuredSkillInstallConfigSchema = z.union([
  z.string().min(1),
  configuredSkillInstallEntryConfigSchema,
  configuredSkillCollectionConfigSchema
])

export const objectSkillsConfigSchema = z.object({
  items: z.array(configuredSkillInstallConfigSchema).optional()
    .describe('Project skills managed by ow skills install/update'),
  registry: z.string().optional().describe('Default npm registry used to install the managed skills CLI'),
  homeBridge: skillHomeBridgeConfigSchema.optional().describe('Home skill auto-bridge settings'),
  install: z.array(configuredSkillInstallConfigSchema).optional()
    .describe('Deprecated alias for `skills.items`')
})

export const skillsConfigSchema = z.union([
  z.array(configuredSkillInstallConfigSchema)
    .describe('Project skills managed by ow skills install/update'),
  objectSkillsConfigSchema
])

export const skillsMetaConfigSchema = z.object({
  bundled: z.boolean().optional().describe('Whether bundled skills are enabled'),
  registries: z.array(z.string()).optional().describe('npm registry candidates shown in skill selectors'),
  sources: z.array(z.string()).optional().describe('Skills CLI source candidates shown in skill selectors'),
  homeBridge: skillHomeBridgeConfigSchema.optional().describe('Home skill auto-bridge settings')
})

const pluginInstanceConfigSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1).describe('Plugin package name or short id'),
    enabled: z.boolean().optional().describe('Disable this plugin instance'),
    watch: z.boolean().optional().describe('Watch this plugin for local development changes'),
    version: z.string().optional().describe('Managed plugin package version'),
    scope: z.string().optional().describe('User-defined plugin scope'),
    options: z.record(z.string(), jsonValueSchema).optional().describe('Plugin instance options'),
    children: z.array(pluginInstanceConfigSchema).optional().describe('Nested child plugin overrides')
  })
)

export const pluginConfigSchema = z.array(pluginInstanceConfigSchema).describe('Plugin instance list')

const marketplacePluginSourceSchema = z.union([
  z.string().min(1),
  z.object({
    source: z.literal('github'),
    repo: z.string().min(1),
    ref: z.string().optional(),
    sha: z.string().optional()
  }),
  z.object({
    source: z.literal('url'),
    url: z.string().min(1),
    ref: z.string().optional(),
    sha: z.string().optional()
  }),
  z.object({
    source: z.literal('git-subdir'),
    url: z.string().min(1),
    path: z.string().min(1),
    ref: z.string().optional(),
    sha: z.string().optional()
  }),
  z.object({
    source: z.literal('npm'),
    package: z.string().min(1),
    version: z.string().optional(),
    registry: z.string().optional()
  })
])

const marketplacePluginDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
  strict: z.boolean().optional(),
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  commands: z.union([z.string(), z.array(z.string())]).optional(),
  agents: z.union([z.string(), z.array(z.string())]).optional(),
  hooks: z.union([z.string(), z.array(z.string()), z.record(z.string(), jsonValueSchema)]).optional(),
  mcpServers: z.union([z.string(), z.array(z.string()), z.record(z.string(), jsonValueSchema)]).optional(),
  userConfig: jsonValueSchema.optional(),
  source: marketplacePluginSourceSchema
})

const marketplaceSourceSchema = z.union([
  z.object({
    source: z.literal('github'),
    repo: z.string().min(1),
    ref: z.string().optional(),
    path: z.string().optional()
  }),
  z.object({
    source: z.literal('git'),
    url: z.string().min(1),
    ref: z.string().optional(),
    path: z.string().optional()
  }),
  z.object({
    source: z.literal('directory'),
    path: z.string().min(1)
  }),
  z.object({
    source: z.literal('url'),
    url: z.string().min(1)
  }),
  z.object({
    source: z.literal('settings'),
    name: z.string().optional(),
    metadata: z.object({
      pluginRoot: z.string().optional()
    }).optional(),
    plugins: z.array(marketplacePluginDefinitionSchema)
  }),
  z.object({
    source: z.literal('hostPattern'),
    hostPattern: z.string().min(1)
  })
])

const marketplaceDeclaredPluginConfigSchema = z.union([
  z.boolean().transform(enabled => ({ enabled })),
  z.object({
    enabled: z.boolean().optional(),
    scope: z.string().optional()
  })
])

export const marketplaceConfigSchema = z.record(
  z.string(),
  z.object({
    type: z.literal('claude-code'),
    enabled: z.boolean().optional(),
    syncOnRun: z.boolean().optional(),
    plugins: z.record(z.string(), marketplaceDeclaredPluginConfigSchema).optional(),
    options: z.object({
      source: marketplaceSourceSchema
    }).optional()
  })
)

const mcpServerCommonSchema = z.object({
  enabled: z.boolean().optional().describe('Enable this MCP server'),
  env: z.record(z.string(), z.string()).optional().describe('Environment variables')
})

const mcpServerCommandSchema = mcpServerCommonSchema.extend({
  command: z.string().min(1).describe('Executable command'),
  args: z.array(z.string()).optional().describe('Command arguments')
})

const mcpServerSseSchema = mcpServerCommonSchema.extend({
  type: z.literal('sse'),
  url: z.string().min(1).describe('SSE endpoint URL'),
  headers: z.record(z.string(), z.string()).describe('HTTP headers')
})

const mcpServerHttpSchema = mcpServerCommonSchema.extend({
  type: z.literal('http'),
  url: z.string().min(1).describe('HTTP endpoint URL'),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers')
})

export const mcpServerConfigSchema = z.union([
  mcpServerCommandSchema,
  mcpServerSseSchema,
  mcpServerHttpSchema
])

export const generalConfigSectionSchema = z.object({
  baseDir: z.string().optional(),
  disableGlobalConfig: z.boolean().optional()
    .describe('Disable applying the global ~/.oneworks/.oo.config.json layer'),
  effort: effortLevelSchema.optional(),
  defaultAdapter: z.string().optional(),
  defaultModelService: z.string().optional(),
  defaultModel: z.string().optional(),
  recommendedModels: z.array(recommendedModelConfigSchema).optional(),
  interfaceLanguage: z.string().trim().min(1).optional(),
  modelLanguage: languageCodeSchema.optional(),
  announcements: z.array(z.string()).optional(),
  permissions: permissionsConfigSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  notifications: notificationConfigSchema.optional(),
  messageLinks: messageLinksConfigSchema.optional(),
  skills: skillsConfigSchema.optional(),
  skillsMeta: skillsMetaConfigSchema.optional(),
  skillRegistries: z.array(configuredSkillRegistrySchema).optional()
    .describe('Skills CLI sources shown in the Knowledge Base skill market'),
  webAuth: webAuthConfigSchema.optional()
})

export const pluginSectionSchema = z.object({
  plugins: pluginConfigSchema.optional(),
  marketplaces: marketplaceConfigSchema.optional()
})

export const mcpConfigSectionSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
  defaultIncludeMcpServers: z.array(z.string()).optional(),
  defaultExcludeMcpServers: z.array(z.string()).optional(),
  noDefaultOneworksMcpServer: z.boolean().optional()
})

export const experimentsConfigSchema = z.object({
  agentRoom: z.boolean().default(false).describe('Enable the experimental Agent Room multi-agent chat mode'),
  automation: z.boolean().default(false).describe('Enable the experimental automation tasks interface'),
  benchmark: z.boolean().default(false).describe('Enable the experimental benchmark interface'),
  sessionTimeline: z.boolean().default(false).describe('Enable the experimental session timeline view')
})

export const startupProfileDiagnosticsConfigSchema = z.object({
  enabled: z.boolean().optional().describe('Enable startup profiling'),
  console: z.boolean().optional().describe('Print startup profiling marks to stderr'),
  log: z.boolean().optional().describe('Write startup profiling marks to the project AI logs directory'),
  thresholdMs: z.number().nonnegative().optional().describe('Only record startup marks at or above this duration')
})

export const diagnosticsConfigSchema = z.object({
  startupProfile: z.union([
    z.boolean(),
    startupProfileDiagnosticsConfigSchema
  ]).optional().describe('Startup profiling diagnostics')
})

export const baseAdapterEntrySchema = adapterConfigCommonSchema.passthrough()
export const baseChannelEntrySchema = channelBaseSchema.passthrough()

export const configSectionSchemas = {
  general: generalConfigSectionSchema,
  conversation: conversationConfigSchema,
  models: z.record(z.string(), modelMetadataConfigSchema),
  modelServices: z.record(z.string(), modelServiceConfigSchema),
  channels: z.record(z.string(), baseChannelEntrySchema),
  server: serverConfigSchema,
  adapters: z.object({}).catchall(baseAdapterEntrySchema),
  appearance: appearanceConfigSchema,
  desktop: desktopConfigSchema,
  plugins: pluginSectionSchema,
  mcp: mcpConfigSectionSchema,
  auth: webAuthConfigSchema,
  voice: voiceConfigSchema,
  shortcuts: shortcutsConfigSchema,
  experiments: experimentsConfigSchema,
  diagnostics: diagnosticsConfigSchema
} as const

export const baseConfigFileSchema = z.object({
  $schema: z.string().optional().describe('JSON Schema URL'),
  extend: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  baseDir: z.string().optional(),
  disableGlobalConfig: z.boolean().optional()
    .describe('Disable applying the global ~/.oneworks/.oo.config.json layer'),
  effort: effortLevelSchema.optional(),
  adapters: z.object({}).catchall(baseAdapterEntrySchema).optional(),
  models: z.record(z.string(), modelMetadataConfigSchema).optional(),
  defaultAdapter: z.string().optional(),
  modelServices: z.record(z.string(), modelServiceConfigSchema).optional(),
  channels: z.record(z.string(), baseChannelEntrySchema).optional(),
  server: serverConfigSchema.optional(),
  defaultModelService: z.string().optional(),
  defaultModel: z.string().optional(),
  recommendedModels: z.array(recommendedModelConfigSchema).optional(),
  interfaceLanguage: z.string().trim().min(1).optional(),
  modelLanguage: languageCodeSchema.optional(),
  mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
  defaultIncludeMcpServers: z.array(z.string()).optional(),
  defaultExcludeMcpServers: z.array(z.string()).optional(),
  noDefaultOneworksMcpServer: z.boolean().optional(),
  permissions: permissionsConfigSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  announcements: z.array(z.string()).optional(),
  shortcuts: shortcutsConfigSchema.optional(),
  notifications: notificationConfigSchema.optional(),
  messageLinks: messageLinksConfigSchema.optional(),
  appearance: appearanceConfigSchema.optional(),
  desktop: desktopConfigSchema.optional(),
  skills: skillsConfigSchema.optional(),
  skillsMeta: skillsMetaConfigSchema.optional(),
  skillRegistries: z.array(configuredSkillRegistrySchema).optional()
    .describe('Skills CLI sources shown in the Knowledge Base skill market'),
  webAuth: webAuthConfigSchema.optional(),
  conversation: conversationConfigSchema.optional(),
  plugins: pluginConfigSchema.optional(),
  marketplaces: marketplaceConfigSchema.optional(),
  voice: voiceConfigSchema.optional(),
  experiments: experimentsConfigSchema.optional(),
  diagnostics: diagnosticsConfigSchema.optional()
}).strict()

const getZodTypeName = (schema: z.ZodTypeAny) => (
  (schema as { _def?: { typeName?: string } })._def?.typeName
)

const isZodType = (schema: z.ZodTypeAny, typeName: string) => getZodTypeName(schema) === typeName

const unwrapUiSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  if (isZodType(schema, 'ZodOptional') || isZodType(schema, 'ZodNullable')) {
    return unwrapUiSchema((schema as unknown as { unwrap: () => z.ZodTypeAny }).unwrap())
  }
  if (isZodType(schema, 'ZodDefault')) {
    return unwrapUiSchema((schema as unknown as { removeDefault: () => z.ZodTypeAny }).removeDefault())
  }
  if (isZodType(schema, 'ZodEffects')) {
    return unwrapUiSchema((schema as unknown as { innerType: () => z.ZodTypeAny }).innerType())
  }
  return schema
}

const getUiDefaultValue = (schema: z.ZodTypeAny): unknown => {
  if (isZodType(schema, 'ZodDefault')) {
    return (schema as unknown as { _def: { defaultValue: () => unknown } })._def.defaultValue()
  }
  if (isZodType(schema, 'ZodOptional')) return undefined
  if (isZodType(schema, 'ZodNullable')) return null

  const unwrapped = unwrapUiSchema(schema)
  if (isZodType(unwrapped, 'ZodLiteral')) return (unwrapped as unknown as { value: unknown }).value
  if (isZodType(unwrapped, 'ZodEnum')) return (unwrapped as unknown as { options: string[] }).options[0]
  if (isZodType(unwrapped, 'ZodNativeEnum')) {
    const values = Object.values((unwrapped as unknown as { enum: Record<string, unknown> }).enum)
    return values.length > 0 ? values[0] : undefined
  }
  if (isZodType(unwrapped, 'ZodString')) return ''
  if (isZodType(unwrapped, 'ZodNumber')) return 0
  if (isZodType(unwrapped, 'ZodBoolean')) return false
  if (isZodType(unwrapped, 'ZodArray')) return []
  if (isZodType(unwrapped, 'ZodObject') || isZodType(unwrapped, 'ZodRecord')) return {}
  return undefined
}

const inferUiFieldType = (schema: z.ZodTypeAny): ConfigUiFieldType => {
  const unwrapped = unwrapUiSchema(schema)
  if (isZodType(unwrapped, 'ZodString')) return 'string'
  if (isZodType(unwrapped, 'ZodNumber')) return 'number'
  if (isZodType(unwrapped, 'ZodBoolean')) return 'boolean'
  if (
    isZodType(unwrapped, 'ZodEnum') ||
    isZodType(unwrapped, 'ZodNativeEnum') ||
    isZodType(unwrapped, 'ZodLiteral')
  ) {
    return 'select'
  }
  if (isZodType(unwrapped, 'ZodArray')) {
    const element = unwrapUiSchema((unwrapped as unknown as { element: z.ZodTypeAny }).element)
    return isZodType(element, 'ZodString') ? 'string[]' : 'json'
  }
  return 'json'
}

const inferUiOptions = (schema: z.ZodTypeAny) => {
  const unwrapped = unwrapUiSchema(schema)
  if (isZodType(unwrapped, 'ZodLiteral')) {
    return [{ value: String((unwrapped as unknown as { value: unknown }).value) }]
  }
  if (isZodType(unwrapped, 'ZodEnum')) {
    return (unwrapped as unknown as { options: string[] }).options.map(value => ({ value }))
  }
  if (isZodType(unwrapped, 'ZodNativeEnum')) {
    return Object.values((unwrapped as unknown as { enum: Record<string, string | number> }).enum)
      .map(value => ({ value: String(value) }))
  }
  return undefined
}

export const buildConfigUiObjectSchema = (schema: z.ZodTypeAny): ConfigUiObjectSchema => {
  const unwrapped = unwrapUiSchema(schema)
  if (!isZodType(unwrapped, 'ZodObject')) {
    return { fields: [] }
  }

  const shapeEntries = Object.entries((unwrapped as unknown as { shape: Record<string, z.ZodTypeAny> }).shape) as Array<
    [string, z.ZodTypeAny]
  >
  const fields = shapeEntries.map(([key, value]) => {
    const uiField: ConfigUiField = {
      path: [key],
      type: inferUiFieldType(value),
      defaultValue: getUiDefaultValue(value),
      description: unwrapUiSchema(value).description,
      options: inferUiOptions(value)
    }
    return uiField
  })

  const recordFields = Object.fromEntries(
    shapeEntries.flatMap(([key, value]): Array<[string, ConfigUiRecordFieldSchema]> => {
      const recordSchema = unwrapUiSchema(value)
      if (!isZodType(recordSchema, 'ZodRecord')) {
        return []
      }

      const itemSchema = (recordSchema as unknown as { _def: { valueType: z.ZodTypeAny } })._def.valueType
      const itemObjectSchema = buildConfigUiObjectSchema(itemSchema)
      if ((itemObjectSchema.fields.length === 0) && itemObjectSchema.recordFields == null) {
        return []
      }

      return [[key, {
        itemSchema: itemObjectSchema
      }]]
    })
  )

  return {
    fields,
    ...(Object.keys(recordFields).length > 0 ? { recordFields } : {})
  }
}
