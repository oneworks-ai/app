import { atom } from 'jotai'

import type { AppearanceThemePack, AppearanceThemePackConfigMap } from '@oneworks/types'

export type ThemePack = AppearanceThemePack

export const THEME_PACK_STORAGE_KEY = 'oneworks_theme_pack'
export const THEME_PACK_SETTINGS_STORAGE_KEY = 'oneworks_theme_pack_settings'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const normalizeThemePack = (value: unknown): ThemePack => (
  typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)
    ? value
    : 'default'
)

const normalizeThemePackSettingsMap = (value: unknown): AppearanceThemePackConfigMap => {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, Record<string, unknown>] => (
        normalizeThemePack(entry[0]) === entry[0] && isRecord(entry[1])
      ))
  )
}

const getInitialThemePack = (): ThemePack => {
  if (typeof window === 'undefined') return 'default'

  try {
    return normalizeThemePack(localStorage.getItem(THEME_PACK_STORAGE_KEY))
  } catch {
    return 'default'
  }
}

export const getStoredThemePackSettings = (): AppearanceThemePackConfigMap => {
  if (typeof window === 'undefined') return {}

  try {
    const storedSettings = localStorage.getItem(THEME_PACK_SETTINGS_STORAGE_KEY)
    return storedSettings == null
      ? {}
      : normalizeThemePackSettingsMap(JSON.parse(storedSettings))
  } catch {
    return {}
  }
}

const themePackBaseAtom = atom<ThemePack>(getInitialThemePack())
const themePackSettingsBaseAtom = atom<AppearanceThemePackConfigMap>(getStoredThemePackSettings())

export const themePackAtom = atom(
  get => get(themePackBaseAtom),
  (_get, set, value: ThemePack) => {
    const nextValue = normalizeThemePack(value)
    set(themePackBaseAtom, nextValue)

    try {
      localStorage.setItem(THEME_PACK_STORAGE_KEY, nextValue)
    } catch {}
  }
)

export const themePackSettingsAtom = atom(
  get => get(themePackSettingsBaseAtom),
  (_get, set, value: AppearanceThemePackConfigMap) => {
    const nextValue = normalizeThemePackSettingsMap(value)
    set(themePackSettingsBaseAtom, nextValue)

    try {
      localStorage.setItem(THEME_PACK_SETTINGS_STORAGE_KEY, JSON.stringify(nextValue))
    } catch {}
  }
)
