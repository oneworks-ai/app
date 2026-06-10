/* eslint-disable max-lines -- plugin localization helpers keep contribution schema text in one resolver. */
import i18n from '#~/i18n'

export interface LocalizedPluginContribution {
  description?: unknown
  descriptionI18n?: Record<string, string>
  i18n?: Record<string, {
    description?: string
    title?: string
  }>
  title?: unknown
  titleI18n?: Record<string, string>
}

export interface PluginLocalizedTextOptions {
  allowAnyFallback?: boolean
  fallback?: string
  fallbackLanguage?: string
}

export type PluginI18nValueMap<T> = Partial<Record<string, T>>
export type PluginI18nText = string | PluginI18nValueMap<string>
export type PluginI18nParams = Record<string, string | number | boolean | null | undefined>

export interface PluginI18nDisposable {
  dispose: () => void
}

export interface PluginI18nChangeEvent {
  language: string
  resolvedLanguage: string
}

export interface PluginI18nContext {
  readonly language: string
  readonly resolvedLanguage: string
  getLanguage: () => string
  resolveText: (value: PluginI18nText | undefined, fallback?: string) => string
  select: <T>(values: PluginI18nValueMap<T>, fallbackLanguage?: string) => T | undefined
  subscribe: (listener: (event: PluginI18nChangeEvent) => void) => PluginI18nDisposable
  t: (message: PluginI18nText, params?: PluginI18nParams) => string
}

const normalizeLanguage = (value: string | null | undefined) => {
  const language = value?.trim().replace(/_/g, '-').toLowerCase()
  if (language == null || language === '') return undefined
  return language
}

export const getPluginLanguageCandidates = (language: string, fallbackLanguage = 'en') => {
  const normalized = normalizeLanguage(language)
  const base = normalized?.split('-')[0]
  const scriptAlias = base === 'zh' ? 'zh-hans' : undefined
  const regionAlias = base === 'zh' ? 'zh-cn' : undefined
  const fallback = normalizeLanguage(fallbackLanguage)
  return [normalized, scriptAlias, regionAlias, base, fallback, 'en'].filter((item, index, list): item is string =>
    item != null && list.indexOf(item) === index
  )
}

const getDocumentLanguage = () => globalThis.document?.documentElement.lang

const getNavigatorLanguage = () => globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language

const getHostLanguage = () => i18n.language ?? getDocumentLanguage() ?? getNavigatorLanguage() ?? 'en'

const getHostResolvedLanguage = () => i18n.resolvedLanguage ?? getHostLanguage()

const formatLocalizedTextValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const selectPluginI18nValue = <T>(
  values: PluginI18nValueMap<T>,
  language: string,
  fallbackLanguage?: string,
  options: { allowAnyFallback?: boolean } = {}
) => {
  const entries = Object.entries(values).filter((entry): entry is [string, T] => entry[1] !== undefined)
  const normalizedEntries = new Map(
    entries
      .map(([key, entryValue]) => [normalizeLanguage(key), entryValue] as const)
      .filter((entry): entry is readonly [string, T] => entry[0] != null)
  )

  for (const candidate of getPluginLanguageCandidates(language, fallbackLanguage)) {
    const value = normalizedEntries.get(candidate)
    if (value !== undefined) return value
  }

  return options.allowAnyFallback === false ? undefined : entries[0]?.[1]
}

const interpolatePluginI18nText = (text: string, params: PluginI18nParams = {}) =>
  text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = params[key]
    return value == null ? '' : String(value)
  })

export const createPluginI18nContext = (): PluginI18nContext => {
  const context: PluginI18nContext = {
    get language() {
      return getHostLanguage()
    },
    get resolvedLanguage() {
      return getHostResolvedLanguage()
    },
    getLanguage: () => getHostResolvedLanguage(),
    resolveText: (value, fallback) => resolvePluginLocalizedText(value, context, { fallback }) ?? fallback ?? '',
    select: (values, fallbackLanguage) => selectPluginI18nValue(values, getHostResolvedLanguage(), fallbackLanguage),
    subscribe: (listener) => {
      const handleLanguageChanged = () => {
        listener({
          language: getHostLanguage(),
          resolvedLanguage: getHostResolvedLanguage()
        })
      }
      i18n.on('languageChanged', handleLanguageChanged)
      return {
        dispose: () => i18n.off('languageChanged', handleLanguageChanged)
      }
    },
    t: (message, params) => {
      const text = typeof message === 'string'
        ? message
        : selectPluginI18nValue(message, getHostResolvedLanguage(), 'en') ?? ''
      return interpolatePluginI18nText(text, params)
    }
  }

  return context
}

export function resolvePluginLocalizedText(
  value: unknown,
  language: string,
  options?: PluginLocalizedTextOptions
): string | undefined
export function resolvePluginLocalizedText(
  value: unknown,
  context: PluginI18nContext,
  options?: PluginLocalizedTextOptions
): string | undefined
export function resolvePluginLocalizedText(
  value: unknown,
  languageOrContext: string | PluginI18nContext,
  options: PluginLocalizedTextOptions = {}
): string | undefined {
  const direct = formatLocalizedTextValue(value)
  if (direct != null) return direct
  if (!isRecord(value)) return options.fallback

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entryValue]) => [normalizeLanguage(key), formatLocalizedTextValue(entryValue)] as const)
    .filter((entry): entry is readonly [string, string] => entry[0] != null && entry[1] != null)
  if (entries.length === 0) return options.fallback

  const language = typeof languageOrContext === 'string'
    ? languageOrContext
    : languageOrContext.resolvedLanguage
  return selectPluginI18nValue(
    Object.fromEntries(entries),
    language,
    options.fallbackLanguage,
    { allowAnyFallback: options.allowAnyFallback }
  ) ?? options.fallback
}

export const resolvePluginContributionText = (
  contribution: LocalizedPluginContribution,
  field: 'description' | 'title',
  languageOrContext: string | PluginI18nContext
): string | undefined => {
  const resolveText = (value: unknown, options?: PluginLocalizedTextOptions) => (
    typeof languageOrContext === 'string'
      ? resolvePluginLocalizedText(value, languageOrContext, options)
      : resolvePluginLocalizedText(value, languageOrContext, options)
  )
  const suffixed = resolveText(contribution[`${field}I18n`], {
    allowAnyFallback: false,
    fallbackLanguage: 'en'
  })
  if (suffixed != null) return suffixed

  if (isRecord(contribution.i18n)) {
    const localized = resolveText(
      Object.fromEntries(
        Object.entries(contribution.i18n).map(([key, value]) => [
          key,
          value != null && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)[field]
            : undefined
        ])
      ),
      { allowAnyFallback: false, fallbackLanguage: 'en' }
    )
    if (localized != null) return localized
  }

  return resolveText(contribution[field])
}

export const resolvePluginI18nField = (
  record: Record<string, unknown>,
  field: string,
  context: PluginI18nContext
) => resolvePluginContributionText(record, field as 'description' | 'title', context)

export const localizePluginContributionItem = <T extends object>(
  item: T,
  context: PluginI18nContext
): T => {
  const record = item as Record<string, unknown>
  const title = resolvePluginI18nField(record, 'title', context)
  const description = resolvePluginI18nField(record, 'description', context)
  if (title == null && description == null) return item

  return {
    ...item,
    ...(title == null ? {} : { title }),
    ...(description == null ? {} : { description })
  }
}
