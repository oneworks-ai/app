/* eslint-disable max-lines -- Relay share drafts need one boundary for extraction, sanitization, and preview metadata. */
import { filterRelayConfigPatch, isRecord, normalizeRelayConfigSafeFields, unique } from './config-assignment-patch.js'
import { RELAY_CONFIG_SAFE_FIELDS } from './config-assignment-types.js'
import type { RelayConfigPatch, RelayConfigSafeField } from './config-assignment-types.js'

export type RelayConfigShareDraftIssueCode =
  | 'invalid_value'
  | 'local_path_rejected'
  | 'model_service_not_visible'
  | 'rejected_root'
  | 'secret_detected'

export type RelayConfigShareDraftIssueSeverity = 'error' | 'info' | 'warning'

export interface RelayConfigShareDraftIssue {
  code: RelayConfigShareDraftIssueCode
  message: string
  path: string
  severity: RelayConfigShareDraftIssueSeverity
}

export interface RelayConfigShareDraftSecretItem {
  displayName: string
  path: string
  ref: string
  uploadRequired: true
}

export interface RelayConfigShareDraftPendingSecretRef {
  displayName: string
  sourcePath: string
  uploadRequired: true
}

export interface RelayConfigShareDraft {
  allowedFields: RelayConfigSafeField[]
  configPatch?: RelayConfigPatch
  fieldSummaries: Array<{
    field: RelayConfigSafeField
    itemCount: number
    secretCount: number
  }>
  issues: RelayConfigShareDraftIssue[]
  pendingSecretRefs: Record<string, RelayConfigShareDraftPendingSecretRef>
  rejectedFields: string[]
  secretItems: RelayConfigShareDraftSecretItem[]
}

export interface RelayConfigShareDraftInput {
  allowedFields?: unknown
  config?: unknown
  pluginSchemas?: Record<string, unknown>
}

type RelayConfigShareDraftExtracted = Partial<Record<RelayConfigSafeField, unknown>>

const SAFE_FIELD_SET = new Set<string>(RELAY_CONFIG_SAFE_FIELDS)
const rejectedRootNames = new Set([
  'adapters',
  'adapterNativeSecrets',
  'auth',
  'baseDir',
  'channels',
  'desktop',
  'diagnostics',
  'env',
  'experiments',
  'extend',
  'hooks',
  'mcp',
  'mcpServers',
  'permissions',
  'server',
  'shortcuts',
  'shell',
  'webAuth',
  'workspaces'
])

const rejectedGeneralFields = new Set([
  'baseDir',
  'disableGlobalConfig',
  'env',
  'permissions',
  'webAuth'
])

const secretLikeKeyPattern =
  /(?:^|[_-])(?:api[_-]?key|secret|token|password|credential|private[_-]?key)(?:$|[_-])|apiKey|accessToken|refreshToken/iu

const localPathKeyPattern =
  /(?:^|[_-])(?:baseDir|cwd|directory|dir|file|home|path|paths|root|roots|workspaceFolder)(?:$|[_-])/iu

const looksLikeLocalPath = (value: string) => {
  const text = value.trim()
  if (text === '') return false
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(text)) return false
  return text.startsWith('/') ||
    text.startsWith('./') ||
    text.startsWith('../') ||
    text.startsWith('~/') ||
    /^[a-z]:[\\/]/iu.test(text) ||
    text.includes('\\')
}

const cleanText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const pathToString = (path: Array<number | string>) =>
  path.map(segment => typeof segment === 'number' ? `[${segment}]` : segment).join('.').replaceAll('.[', '[')

const escapePointerSegment = (value: string) => value.replace(/~/gu, '~0').replace(/\//gu, '~1')

const pathToSecretRef = (path: Array<number | string>) => (
  path.some(segment => typeof segment === 'number')
    ? `/${path.map(segment => escapePointerSegment(String(segment))).join('/')}`
    : path.join('.')
)

const pluginKey = (entry: unknown, index: number) => {
  if (!isRecord(entry)) return String(index)
  return cleanText(entry.scope) ?? cleanText(entry.id) ?? cleanText(entry.name) ?? String(index)
}

const itemCount = (value: unknown) => {
  if (Array.isArray(value)) return value.length
  if (isRecord(value)) return Object.keys(value).length
  return value == null ? 0 : 1
}

const childSchema = (schema: unknown, key: number | string) => {
  if (!isRecord(schema)) return undefined
  if (typeof key === 'number') return schema.items
  return isRecord(schema.properties) ? schema.properties[key] : undefined
}

const schemaUi = (schema: Record<string, unknown>) => {
  const ui = schema['x-oneworks-ui'] ?? schema['x-ui'] ?? schema.ui
  return isRecord(ui) ? ui : undefined
}

const schemaMarksSecret = (schema: unknown) => {
  if (!isRecord(schema)) return false
  const ui = schemaUi(schema)
  return schema.writeOnly === true ||
    schema.format === 'password' ||
    schema.sensitive === true ||
    ui?.sensitive === true
}

const addIssue = (
  issues: RelayConfigShareDraftIssue[],
  issue: RelayConfigShareDraftIssue
) => {
  if (issues.some(item => item.code === issue.code && item.path === issue.path && item.message === issue.message)) {
    return
  }
  issues.push(issue)
}

const addRejectedField = (fields: string[], path: Array<number | string>) => {
  const text = pathToString(path)
  if (text !== '' && !fields.includes(text)) fields.push(text)
}

const createSecretDisplayName = (path: Array<number | string>) => {
  const leaf = String(path.at(-1) ?? 'secret')
  const parent = path.length > 1 ? String(path.at(-2)) : undefined
  return parent == null || /^\d+$/u.test(parent) ? leaf : `${parent} ${leaf}`
}

const sanitizeDraftValue = (
  value: unknown,
  path: Array<number | string>,
  params: {
    issues: RelayConfigShareDraftIssue[]
    rejectedFields: string[]
    schema?: unknown
    secrets: RelayConfigShareDraftSecretItem[]
  }
): unknown => {
  const leaf = path.at(-1)
  const pathText = pathToString(path)
  if (
    (typeof leaf === 'string' && secretLikeKeyPattern.test(leaf)) ||
    schemaMarksSecret(params.schema)
  ) {
    if (value !== undefined && value !== null && value !== '') {
      const ref = pathToSecretRef(path)
      if (!params.secrets.some(item => item.ref === ref)) {
        params.secrets.push({
          displayName: createSecretDisplayName(path),
          path: pathText,
          ref,
          uploadRequired: true
        })
      }
      addIssue(params.issues, {
        code: 'secret_detected',
        message: 'Field is treated as a secret and must be uploaded through Relay secret storage before publishing.',
        path: pathText,
        severity: 'warning'
      })
    }
    return undefined
  }

  if (
    typeof leaf === 'string' &&
    localPathKeyPattern.test(leaf) &&
    (
      (typeof value === 'string' && looksLikeLocalPath(value)) ||
      (Array.isArray(value) && value.some(item => typeof item === 'string' && looksLikeLocalPath(item)))
    )
  ) {
    addRejectedField(params.rejectedFields, path)
    addIssue(params.issues, {
      code: 'local_path_rejected',
      message: 'Local filesystem paths are not shareable team configuration.',
      path: pathText,
      severity: 'warning'
    })
    return undefined
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .map((item, index) =>
        sanitizeDraftValue(item, [...path, index], {
          ...params,
          schema: childSchema(params.schema, index)
        })
      )
      .filter(item => item !== undefined)
    return sanitized.length > 0 ? sanitized : undefined
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) =>
        [
          key,
          sanitizeDraftValue(item, [...path, key], {
            ...params,
            schema: childSchema(params.schema, key)
          })
        ] as const
      )
      .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }

  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  addRejectedField(params.rejectedFields, path)
  addIssue(params.issues, {
    code: 'invalid_value',
    message: 'Only JSON-serializable config values can be shared.',
    path: pathText,
    severity: 'warning'
  })
  return undefined
}

const readPluginSchemas = (value: unknown) => (
  isRecord(value) ? value : {}
)

const sanitizePluginEntry = (
  value: unknown,
  path: Array<number | string>,
  params: {
    issues: RelayConfigShareDraftIssue[]
    pluginSchemas: Record<string, unknown>
    rejectedFields: string[]
    secrets: RelayConfigShareDraftSecretItem[]
  },
  keyHint: string
) =>
  sanitizeDraftValue(value, path, {
    issues: params.issues,
    rejectedFields: params.rejectedFields,
    schema: params.pluginSchemas[keyHint],
    secrets: params.secrets
  })

const sanitizePlugins = (
  value: unknown,
  params: {
    issues: RelayConfigShareDraftIssue[]
    pluginSchemas: Record<string, unknown>
    rejectedFields: string[]
    secrets: RelayConfigShareDraftSecretItem[]
  }
) => {
  if (Array.isArray(value)) {
    const plugins = value
      .map((entry, index) => sanitizePluginEntry(entry, ['plugins', index], params, pluginKey(entry, index)))
      .filter(item => item !== undefined)
    return plugins.length > 0 ? plugins : undefined
  }
  if (!isRecord(value)) return undefined
  const plugins = Object.entries(value)
    .map(([key, entry]) => [key, sanitizePluginEntry(entry, ['plugins', key], params, key)] as const)
    .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
  return plugins.length > 0 ? Object.fromEntries(plugins) : undefined
}

const extractShareableConfig = (
  source: Record<string, unknown>,
  params: {
    issues: RelayConfigShareDraftIssue[]
    pluginSchemas: Record<string, unknown>
    rejectedFields: string[]
    secrets: RelayConfigShareDraftSecretItem[]
  }
) => {
  const general = isRecord(source.general) ? source.general : {}
  const pluginSection = isRecord(source.plugins) && (
      Object.hasOwn(source.plugins, 'plugins') ||
      Object.hasOwn(source.plugins, 'marketplaces')
    )
    ? source.plugins
    : undefined

  for (const [key, value] of Object.entries(source)) {
    if (SAFE_FIELD_SET.has(key)) continue
    if (key === 'general' || key === 'plugins') continue
    if (value === undefined) continue
    addRejectedField(params.rejectedFields, [key])
    addIssue(params.issues, {
      code: 'rejected_root',
      message: rejectedRootNames.has(key)
        ? 'This config root is intentionally excluded from team sharing.'
        : 'Unknown config roots are not shareable in the first Relay team config version.',
      path: key,
      severity: rejectedRootNames.has(key) ? 'error' : 'warning'
    })
  }

  for (const [key, value] of Object.entries(general)) {
    if (['defaultModelService', 'recommendedModels', 'skills', 'skillsMeta', 'skillRegistries'].includes(key)) continue
    if (value === undefined) continue
    addRejectedField(params.rejectedFields, ['general', key])
    addIssue(params.issues, {
      code: 'rejected_root',
      message: rejectedGeneralFields.has(key)
        ? 'This general config field is intentionally excluded from team sharing.'
        : 'This general config field is not shareable in the first Relay team config version.',
      path: pathToString(['general', key]),
      severity: rejectedGeneralFields.has(key) ? 'error' : 'warning'
    })
  }

  return {
    defaultModelService: source.defaultModelService ?? general.defaultModelService,
    marketplaces: source.marketplaces ?? pluginSection?.marketplaces,
    modelServices: source.modelServices,
    plugins: pluginSection?.plugins ?? source.plugins,
    recommendedModels: source.recommendedModels ?? general.recommendedModels,
    skillRegistries: source.skillRegistries ?? general.skillRegistries,
    skills: source.skills ?? general.skills,
    skillsMeta: source.skillsMeta ?? general.skillsMeta
  } satisfies RelayConfigShareDraftExtracted
}

const sanitizeShareableConfig = (
  extracted: RelayConfigShareDraftExtracted,
  params: {
    issues: RelayConfigShareDraftIssue[]
    pluginSchemas: Record<string, unknown>
    rejectedFields: string[]
    secrets: RelayConfigShareDraftSecretItem[]
  }
): RelayConfigPatch => {
  const sanitized: RelayConfigPatch = {}
  for (const field of RELAY_CONFIG_SAFE_FIELDS) {
    const value = extracted[field]
    if (value === undefined) continue
    const nextValue = field === 'plugins'
      ? sanitizePlugins(value, params)
      : sanitizeDraftValue(value, [field], {
        issues: params.issues,
        rejectedFields: params.rejectedFields,
        secrets: params.secrets
      })
    if (nextValue !== undefined) {
      ;(sanitized as Record<string, unknown>)[field] = nextValue
    }
  }
  return sanitized
}

const validateModelServiceReferences = (
  patch: RelayConfigPatch | undefined,
  issues: RelayConfigShareDraftIssue[]
) => {
  if (patch == null) return patch
  const serviceKeys = new Set(Object.keys(isRecord(patch.modelServices) ? patch.modelServices : {}))
  if (typeof patch.defaultModelService === 'string' && !serviceKeys.has(patch.defaultModelService)) {
    addIssue(issues, {
      code: 'model_service_not_visible',
      message: 'defaultModelService must reference a model service included in the same share draft.',
      path: 'defaultModelService',
      severity: 'error'
    })
    delete patch.defaultModelService
  }
  if (Array.isArray(patch.recommendedModels)) {
    patch.recommendedModels = patch.recommendedModels.filter((item, index) => {
      if (!isRecord(item) || typeof item.service !== 'string') return true
      if (serviceKeys.has(item.service)) return true
      addIssue(issues, {
        code: 'model_service_not_visible',
        message: 'recommendedModels.service must reference a model service included in the same share draft.',
        path: `recommendedModels[${index}].service`,
        severity: 'error'
      })
      return false
    })
    if (patch.recommendedModels.length === 0) delete patch.recommendedModels
  }
  return Object.keys(patch).length > 0 ? patch : undefined
}

const resolveInput = (input: RelayConfigShareDraftInput | unknown): RelayConfigShareDraftInput => {
  if (!isRecord(input)) return { config: input }
  if (
    Object.hasOwn(input, 'config') ||
    Object.hasOwn(input, 'allowedFields') ||
    Object.hasOwn(input, 'pluginSchemas')
  ) {
    return input
  }
  return { config: input }
}

const countSecretsForField = (field: RelayConfigSafeField, secrets: RelayConfigShareDraftSecretItem[]) =>
  secrets.filter(secret =>
    secret.ref === field || secret.ref.startsWith(`${field}.`) || secret.ref.startsWith(`/${field}/`)
  )
    .length

export const buildRelayConfigShareDraft = (input: RelayConfigShareDraftInput | unknown): RelayConfigShareDraft => {
  const body = resolveInput(input)
  const source = isRecord(body.config) ? body.config : {}
  const issues: RelayConfigShareDraftIssue[] = []
  const rejectedFields: string[] = []
  const secretItems: RelayConfigShareDraftSecretItem[] = []
  const pluginSchemas = readPluginSchemas(body.pluginSchemas)
  const allowedFields = normalizeRelayConfigSafeFields(body.allowedFields)
  const sanitized = sanitizeShareableConfig(
    extractShareableConfig(source, {
      issues,
      pluginSchemas,
      rejectedFields,
      secrets: secretItems
    }),
    {
      issues,
      pluginSchemas,
      rejectedFields,
      secrets: secretItems
    }
  )
  const filtered = validateModelServiceReferences(
    filterRelayConfigPatch(sanitized, allowedFields),
    issues
  )
  const presentFields = RELAY_CONFIG_SAFE_FIELDS.filter(field => filtered?.[field] !== undefined)
  const fieldSummaries = presentFields.map(field => ({
    field,
    itemCount: itemCount(filtered?.[field]),
    secretCount: countSecretsForField(field, secretItems)
  }))
  const effectiveAllowedFields = unique(presentFields.length === 0 ? allowedFields : presentFields)
  const pendingSecretRefs = Object.fromEntries(
    secretItems.map(secret => [
      secret.ref,
      {
        displayName: secret.displayName,
        sourcePath: secret.path,
        uploadRequired: true as const
      }
    ])
  )

  return {
    allowedFields: effectiveAllowedFields,
    ...(filtered == null ? {} : { configPatch: filtered }),
    fieldSummaries,
    issues,
    pendingSecretRefs,
    rejectedFields,
    secretItems
  }
}
