import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { applyHotTranslationUpdates, buildTranslationResources, getLocaleCodeFromPath } from './i18n-resources'
import type { LocaleModule, LocaleModuleMap } from './i18n-resources'

const localeModules = import.meta.glob('./resources/locales/*.json', {
  eager: true
}) as LocaleModuleMap
const localeModulePaths = Object.keys(localeModules).sort()
const appLanguageOverrideKey = 'oneworks.interfaceLanguageOverride'

export interface AppLanguageOption {
  label: string
  searchKeywords: string[]
  shortLabel: string
  value: string
}

export const supportedAppLanguages = localeModulePaths.map(getLocaleCodeFromPath)
const supportedLanguageLookup = new Map(
  supportedAppLanguages.map(language => [language.toLowerCase(), language])
)
const supportedBaseLanguageLookup = new Map<string, string>()

for (const language of supportedAppLanguages) {
  const baseLanguage = language.toLowerCase().split('-')[0]
  if (baseLanguage != null && !supportedBaseLanguageLookup.has(baseLanguage)) {
    supportedBaseLanguageLookup.set(baseLanguage, language)
  }
}

const fallbackAppLanguage = supportedLanguageLookup.get('zh') ?? supportedAppLanguages[0] ?? 'zh'
const knownLanguageLabels: Record<string, string> = {
  en: 'English',
  zh: '简体中文'
}
const knownLanguageShortLabels: Record<string, string> = {
  en: 'EN',
  zh: '中'
}

const normalizeLanguageCode = (value?: string | null) => {
  const language = value?.trim().replaceAll('_', '-').toLowerCase()
  if (language == null || language === '') return undefined
  return language
}

export const normalizeAppLanguage = (value?: string | null) => {
  const language = normalizeLanguageCode(value)
  if (language == null) return undefined
  return supportedLanguageLookup.get(language) ??
    supportedBaseLanguageLookup.get(language.split('-')[0] ?? '') ??
    undefined
}

export const getAppLanguageDisplayName = (language: string) => {
  const normalizedLanguage = normalizeLanguageCode(language) ?? language
  const knownLabel = knownLanguageLabels[normalizedLanguage]
  if (knownLabel != null) return knownLabel

  try {
    return new Intl.DisplayNames([language], { type: 'language' }).of(language) ?? language
  } catch {
    return language
  }
}

const getAppLanguageShortLabel = (language: string) => {
  const normalizedLanguage = normalizeLanguageCode(language) ?? language
  const knownLabel = knownLanguageShortLabels[normalizedLanguage]
  if (knownLabel != null) return knownLabel

  return language
    .split('-')
    .map(part => part.slice(0, 2).toUpperCase())
    .join('-')
}

export const appLanguageOptions: AppLanguageOption[] = supportedAppLanguages.map(language => {
  const label = getAppLanguageDisplayName(language)
  return {
    label,
    searchKeywords: [language, label],
    shortLabel: getAppLanguageShortLabel(language),
    value: language
  }
})

export const getActiveAppLanguageOption = (language?: string | null) => {
  const normalizedLanguage = normalizeAppLanguage(language)
  return appLanguageOptions.find(option => option.value === normalizedLanguage) ?? appLanguageOptions[0]
}

const getNavigatorLanguage = () => {
  for (const language of globalThis.navigator?.languages ?? []) {
    const normalizedLanguage = normalizeAppLanguage(language)
    if (normalizedLanguage != null) return normalizedLanguage
  }
  return normalizeAppLanguage(globalThis.navigator?.language)
}

const readLocalStorageItem = (key: string) => {
  try {
    return globalThis.localStorage?.getItem(key)
  } catch {
    return undefined
  }
}

const removeLocalStorageItem = (key: string) => {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    // Ignore unavailable storage in non-browser test environments.
  }
}

const writeLocalStorageItem = (key: string, value: string) => {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Ignore unavailable storage in non-browser test environments.
  }
}

const getInitialLanguage = () => {
  const userOverride = normalizeAppLanguage(readLocalStorageItem(appLanguageOverrideKey))
  if (userOverride != null) return userOverride

  removeLocalStorageItem('i18nextLng')

  return normalizeAppLanguage(globalThis.window?.oneworksDesktop?.systemLocale) ??
    getNavigatorLanguage() ??
    fallbackAppLanguage
}

export const getDefaultAppLanguage = () =>
  normalizeAppLanguage(globalThis.window?.oneworksDesktop?.systemLocale) ??
    getNavigatorLanguage() ??
    fallbackAppLanguage

export const clearAppLanguageOverride = () => {
  removeLocalStorageItem(appLanguageOverrideKey)
  removeLocalStorageItem('i18nextLng')
}

export const changeAppLanguage = (
  language: string,
  options: { persistLocalOverride?: boolean } = {}
) => {
  const nextLanguage = normalizeAppLanguage(language) ?? fallbackAppLanguage
  if (options.persistLocalOverride === true) {
    writeLocalStorageItem(appLanguageOverrideKey, nextLanguage)
  } else {
    clearAppLanguageOverride()
  }
  return i18n.changeLanguage(nextLanguage)
}

void i18n
  .use(initReactI18next)
  .init({
    lng: getInitialLanguage(),
    resources: buildTranslationResources(localeModules),
    fallbackLng: fallbackAppLanguage,
    interpolation: {
      escapeValue: false
    },
    react: {
      bindI18nStore: 'added'
    }
  })

if (import.meta.hot) {
  import.meta.hot.accept(localeModulePaths, (nextModules) => {
    applyHotTranslationUpdates({
      instance: i18n,
      modulePaths: localeModulePaths,
      nextModules: nextModules as Array<LocaleModule | undefined>
    })
  })
}

export default i18n
