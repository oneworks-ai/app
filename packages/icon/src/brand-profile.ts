import profile from '../brand-profile.json' with { type: 'json' }

import type {
  OneWorksIconAppearance,
  OneWorksIconMode,
  OneWorksIconTheme
} from './types.js'

export type OneWorksBrandSurfaceRecipe = 'composition' | 'solid' | 'transparent'
export type OneWorksRelayBrandProfile = 'cloudflare' | 'vercel'

export interface OneWorksBrandProfile {
  defaultAppearance: OneWorksIconAppearance
  defaultMode: OneWorksIconMode
  defaultTheme: OneWorksIconTheme
  relayProfiles: Record<OneWorksRelayBrandProfile, OneWorksIconTheme>
  schemaVersion: number
  surfaceRecipes: {
    application: OneWorksBrandSurfaceRecipe
    content: OneWorksBrandSurfaceRecipe
    social: OneWorksBrandSurfaceRecipe
  }
}

export const ONEWORKS_BRAND_PROFILE = profile as OneWorksBrandProfile
export const DEFAULT_BRAND_THEME = ONEWORKS_BRAND_PROFILE.defaultTheme
export const DEFAULT_BRAND_APPEARANCE = ONEWORKS_BRAND_PROFILE.defaultAppearance
export const DEFAULT_BRAND_MODE = ONEWORKS_BRAND_PROFILE.defaultMode
export const ONEWORKS_RELAY_BRAND_THEMES = ONEWORKS_BRAND_PROFILE.relayProfiles

export const resolveOneWorksRelayBrandProfile = (
  origin: string | null | undefined
): OneWorksRelayBrandProfile => {
  const normalizedOrigin = origin?.trim().toLowerCase() ?? ''
  return normalizedOrigin.includes('vc.oneworks.cloud') || normalizedOrigin.includes('vercel.app')
    ? 'vercel'
    : 'cloudflare'
}

export const resolveOneWorksRelayBrandTheme = (
  origin: string | null | undefined
): OneWorksIconTheme => ONEWORKS_RELAY_BRAND_THEMES[resolveOneWorksRelayBrandProfile(origin)]
