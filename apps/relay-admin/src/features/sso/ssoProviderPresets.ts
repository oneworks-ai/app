import type { CreateSsoProviderInput } from '../../shared/model/adminTypes'

export type SsoProviderPresetId = 'google'

export interface SsoProviderPreset {
  id: SsoProviderPresetId
  label: string
  values: Omit<CreateSsoProviderInput, 'clientId' | 'clientSecret' | 'enabled'>
}

export const ssoProviderPresets: SsoProviderPreset[] = [
  {
    id: 'google',
    label: 'Google',
    values: {
      id: 'google-sso',
      name: 'Google',
      type: 'oidc',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile'
    }
  }
]

export const getSsoProviderPreset = (id: string) => (
  ssoProviderPresets.find(preset => preset.id === id)
)

export const buildSsoProviderCallbackUrl = (origin: string, providerId: string) => {
  const cleanOrigin = origin.trim().replace(/\/+$/, '')
  const cleanProviderId = providerId.trim()
  if (cleanOrigin === '' || cleanProviderId === '') return ''
  return `${cleanOrigin}/api/auth/oauth/${encodeURIComponent(cleanProviderId)}/callback`
}
