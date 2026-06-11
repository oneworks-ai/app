import { describe, expect, it } from 'vitest'

import {
  createSsoProviderInputFromFormData,
  updateSsoProviderInputFromFormData
} from '../src/features/sso/ssoProviderForm'
import { buildSsoProviderCallbackUrl, getSsoProviderPreset } from '../src/features/sso/ssoProviderPresets'
import { createSsoProvider, formDataOf } from './helpers'

describe('sso provider form parsing', () => {
  it('builds create input and defaults scope', () => {
    expect(createSsoProviderInputFromFormData(formDataOf({
      id: ' Acme ',
      name: ' Acme SSO ',
      type: 'oidc',
      authorizationUrl: ' https://sso.acme.example/oauth2/authorize ',
      tokenUrl: ' https://sso.acme.example/oauth2/token ',
      userInfoUrl: ' https://sso.acme.example/oauth2/userinfo ',
      scope: ' ',
      enabled: 'on',
      clientId: ' acme-client ',
      clientSecret: ' acme-secret '
    }))).toEqual({
      id: 'acme',
      name: 'Acme SSO',
      type: 'oidc',
      authorizationUrl: 'https://sso.acme.example/oauth2/authorize',
      tokenUrl: 'https://sso.acme.example/oauth2/token',
      userInfoUrl: 'https://sso.acme.example/oauth2/userinfo',
      scope: 'openid email profile',
      enabled: true,
      clientId: 'acme-client',
      clientSecret: 'acme-secret'
    })
  })

  it('omits blank secret from update input', () => {
    const provider = createSsoProvider({ id: 'acme' })

    expect(updateSsoProviderInputFromFormData(
      provider,
      formDataOf({
        name: 'Acme Workforce',
        type: 'oauth2',
        authorizationUrl: 'https://sso.acme.example/authorize',
        tokenUrl: 'https://sso.acme.example/token',
        userInfoUrl: 'https://sso.acme.example/userinfo',
        scope: 'email profile',
        clientId: 'acme-client',
        clientSecret: ''
      })
    )).toEqual({
      id: 'acme',
      name: 'Acme Workforce',
      type: 'oauth2',
      authorizationUrl: 'https://sso.acme.example/authorize',
      tokenUrl: 'https://sso.acme.example/token',
      userInfoUrl: 'https://sso.acme.example/userinfo',
      scope: 'email profile',
      enabled: false,
      clientId: 'acme-client'
    })
  })

  it('returns undefined for incomplete create input', () => {
    expect(createSsoProviderInputFromFormData(formDataOf({
      id: 'acme',
      name: 'Acme SSO'
    }))).toBeUndefined()
  })

  it('provides a Google SSO preset and callback URL', () => {
    const preset = getSsoProviderPreset('google')

    expect(preset?.values).toMatchObject({
      id: 'google-sso',
      name: 'Google',
      type: 'oidc',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile'
    })
    expect(buildSsoProviderCallbackUrl('http://127.0.0.1:48888/', 'google-sso')).toBe(
      'http://127.0.0.1:48888/api/auth/oauth/google-sso/callback'
    )
  })
})
