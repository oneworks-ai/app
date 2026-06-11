/* eslint-disable max-lines -- JSON schema conversion keeps localization, enum, and field inference together. */
import type {
  ConfigJsonSchema,
  ConfigUiField,
  ConfigUiFieldOption,
  ConfigUiFieldType,
  ConfigUiObjectSchema,
  PluginConfigManifest
} from '@oneworks/types'

type JsonSchemaRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonSchemaRecord => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeLanguage = (value: string | undefined) => value?.replace(/_/g, '-').toLowerCase()

const getLanguageCandidates = (language: string) => {
  const normalized = normalizeLanguage(language)
  const base = normalized?.split('-')[0]
  return [normalized, base, 'en'].filter((item, index, list): item is string =>
    item != null && item !== '' && list.indexOf(item) === index
  )
}

const resolveLocalizedText = (value: unknown, language: string): string | undefined => {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined

  const entries = Object.entries(value)
    .map(([key, entryValue]) =>
      [normalizeLanguage(key), typeof entryValue === 'string' ? entryValue : undefined] as const
    )
    .filter((entry): entry is readonly [string, string] => entry[0] != null && entry[1] != null)
  if (entries.length === 0) return undefined

  for (const candidate of getLanguageCandidates(language)) {
    const exact = entries.find(([key]) => key === candidate)
    if (exact != null) return exact[1]

    const base = entries.find(([key]) => key.split('-')[0] === candidate)
    if (base != null) return base[1]
  }
  return entries[0][1]
}

const resolveSchemaI18nField = (
  schema: JsonSchemaRecord,
  field: 'description' | 'title',
  language: string
) => {
  const direct = resolveLocalizedText(schema[`${field}I18n`], language)
  if (direct != null) return direct

  if (isRecord(schema.i18n)) {
    const byLanguage = Object.fromEntries(
      Object.entries(schema.i18n).map(([key, value]) => [
        key,
        isRecord(value) && typeof value[field] === 'string' ? value[field] : undefined
      ])
    )
    const localized = resolveLocalizedText(byLanguage, language)
    if (localized != null) return localized
  }

  return resolveLocalizedText(schema[field], language)
}

const getUiOptions = (schema: JsonSchemaRecord) => {
  const ui = schema['x-oneworks-ui'] ?? schema['x-ui'] ?? schema.ui
  return isRecord(ui) ? ui : {}
}

const firstString = (...values: unknown[]) =>
  values.find((value): value is string => typeof value === 'string' && value.trim() !== '')

const normalizeType = (schema: JsonSchemaRecord) => {
  const type = schema.type
  if (typeof type === 'string') return type
  if (Array.isArray(type)) {
    return type.find((item): item is string => typeof item === 'string' && item !== 'null')
  }
  if (isRecord(schema.properties)) return 'object'
  if (Array.isArray(schema.enum) || Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) return 'string'
  return undefined
}

const getSchemaProperties = (schema: JsonSchemaRecord) => (
  isRecord(schema.properties) ? schema.properties : undefined
)

const getArrayItemSchema = (schema: JsonSchemaRecord) => (
  isRecord(schema.items) ? schema.items : undefined
)

const isStringEnum = (values: unknown[]): values is string[] => values.every(value => typeof value === 'string')

const getEnumOptions = (
  schema: JsonSchemaRecord,
  language: string
): ConfigUiFieldOption[] | undefined => {
  if (Array.isArray(schema.enum) && isStringEnum(schema.enum)) {
    const enumNames = Array.isArray(schema.enumNames) ? schema.enumNames : []
    return schema.enum.map((value, index) => ({
      value,
      label: typeof enumNames[index] === 'string' ? enumNames[index] : value
    }))
  }

  const choiceSchemas = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
    ? schema.anyOf
    : []
  const options = choiceSchemas.flatMap((choice): ConfigUiFieldOption[] => {
    if (!isRecord(choice) || typeof choice.const !== 'string') return []
    return [{
      value: choice.const,
      label: resolveSchemaI18nField(choice, 'title', language) ?? choice.const,
      description: resolveSchemaI18nField(choice, 'description', language)
    }]
  })
  return options.length > 0 ? options : undefined
}

const inferFieldType = (schema: JsonSchemaRecord): ConfigUiFieldType => {
  const ui = getUiOptions(schema)
  const uiControl = firstString(ui.control, ui.type, ui.widget)
  if (uiControl === 'textarea' || uiControl === 'multiline') return 'multiline'
  if (uiControl === 'json') return 'json'

  if (getEnumOptions(schema, 'en') != null) return 'select'

  const type = normalizeType(schema)
  if (type === 'boolean') return 'boolean'
  if (type === 'integer' || type === 'number') return 'number'
  if (type === 'array') {
    const itemSchema = getArrayItemSchema(schema)
    return itemSchema != null && normalizeType(itemSchema) === 'string' ? 'string[]' : 'json'
  }
  if (type === 'string') {
    const format = firstString(schema.format)
    return format === 'textarea' || format === 'multiline' ? 'multiline' : 'string'
  }
  return 'json'
}

const inferIcon = (fieldType: ConfigUiFieldType) => {
  if (fieldType === 'boolean') return 'toggle_on'
  if (fieldType === 'number') return 'numbers'
  if (fieldType === 'string[]') return 'view_list'
  if (fieldType === 'select') return 'checklist'
  if (fieldType === 'multiline') return 'notes'
  if (fieldType === 'json') return 'data_object'
  return 'text_fields'
}

const collectSchemaFields = (
  schema: JsonSchemaRecord,
  path: string[],
  language: string,
  fields: ConfigUiField[]
) => {
  const properties = getSchemaProperties(schema)
  const type = normalizeType(schema)
  const ui = getUiOptions(schema)
  const forceJson = firstString(ui.control, ui.type, ui.widget) === 'json'

  if (type === 'object' && properties != null && !forceJson) {
    for (const [key, childSchema] of Object.entries(properties)) {
      if (isRecord(childSchema)) {
        collectSchemaFields(childSchema, [...path, key], language, fields)
      }
    }
    return
  }

  if (path.length === 0) return

  const fieldType = inferFieldType(schema)
  const icon = firstString(ui.icon) ?? inferIcon(fieldType)
  fields.push({
    path,
    type: fieldType,
    defaultValue: schema.default,
    label: resolveSchemaI18nField(schema, 'title', language),
    description: resolveSchemaI18nField(schema, 'description', language),
    icon,
    placeholder: firstString(ui.placeholder, schema.placeholder),
    sensitive: schema.writeOnly === true || schema.format === 'password' || ui.sensitive === true,
    options: getEnumOptions(schema, language)
  })
}

export const resolvePluginConfigJsonSchema = (
  config: PluginConfigManifest | undefined
): ConfigJsonSchema | undefined => {
  const schema = config?.schema ?? config?.jsonSchema
  return isRecord(schema) ? schema : undefined
}

export const buildPluginConfigUiSchema = (
  config: PluginConfigManifest | undefined,
  language: string
): ConfigUiObjectSchema | undefined => {
  if (config?.uiSchema != null) return config.uiSchema

  const jsonSchema = resolvePluginConfigJsonSchema(config)
  if (!isRecord(jsonSchema)) return undefined

  const fields: ConfigUiField[] = []
  collectSchemaFields(jsonSchema, [], language, fields)
  return fields.length === 0 ? undefined : { fields }
}
