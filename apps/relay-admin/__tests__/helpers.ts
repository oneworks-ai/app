import type { RelayAdminInvite, RelayAdminSsoProvider, RelayAdminUser } from '../src/shared/model/adminTypes'

export const createUser = (overrides: Partial<RelayAdminUser> = {}): RelayAdminUser => ({
  avatarUrl: null,
  createdAt: '2026-05-29T00:00:00.000Z',
  disabled: false,
  disabledAt: null,
  email: 'user@example.com',
  id: 'user-1',
  name: 'User',
  passwordEnabled: false,
  provider: null,
  role: 'member',
  updatedAt: null,
  ...overrides
})

export const createInvite = (overrides: Partial<RelayAdminInvite> = {}): RelayAdminInvite => ({
  code: 'invite-1',
  createdAt: '2026-05-29T00:00:00.000Z',
  expiresAt: null,
  maxUses: 1,
  revokedAt: null,
  role: 'member',
  updatedAt: null,
  used: 0,
  userId: null,
  ...overrides
})

export const createSsoProvider = (overrides: Partial<RelayAdminSsoProvider> = {}): RelayAdminSsoProvider => ({
  id: 'acme',
  name: 'Acme SSO',
  type: 'oidc',
  authorizationUrl: 'https://sso.acme.example/oauth2/authorize',
  tokenUrl: 'https://sso.acme.example/oauth2/token',
  userInfoUrl: 'https://sso.acme.example/oauth2/userinfo',
  scope: 'openid email profile',
  enabled: true,
  clientId: 'acme-client',
  clientSecret: '********',
  createdAt: '2026-05-29T00:00:00.000Z',
  updatedAt: null,
  ...overrides
})

export const formDataOf = (entries: Record<string, string>) => {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value)
  }
  return formData
}
