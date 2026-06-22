import type { CreateSsoProviderInput } from '../../shared/model/adminTypes'

export type SsoProviderPresetId = 'feishu' | 'google'

export interface SsoProviderPreset {
  id: SsoProviderPresetId
  label: string
  values: Omit<CreateSsoProviderInput, 'clientId' | 'clientSecret' | 'enabled'>
}

export const ssoProviderPresets: SsoProviderPreset[] = [
  {
    id: 'feishu',
    label: '飞书',
    values: {
      id: 'feishu',
      name: '飞书',
      type: 'oauth2',
      authorizationUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
      tokenUrl: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      userInfoUrl: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
      scope: 'contact:user.email:readonly'
    }
  },
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
