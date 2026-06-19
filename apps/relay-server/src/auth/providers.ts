import type { RelayOAuthClient } from '../types.js'
import { isRecord } from '../utils.js'

type BuiltInAuthProvider = 'github' | 'google'

interface OAuthProfile {
  avatarUrl?: string
  email: string
  emailVerified: boolean
  id: string
  loginId?: string
  name: string
}

const providerMeta = {
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    emailUrl: 'https://api.github.com/user/emails',
    scope: 'read:user user:email',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user'
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo'
  }
} as const

const builtInProviders = new Set<string>(['github', 'google'])

const isBuiltInProvider = (provider: string): provider is BuiltInAuthProvider => (
  builtInProviders.has(provider)
)

export const enabledAuthProviders = (oauth: Record<string, RelayOAuthClient | undefined> | undefined) => (
  Object.entries(oauth ?? {})
    .filter((entry): entry is [string, RelayOAuthClient] => entry[1] != null)
    .map(([provider]) => provider)
)

export const authProviderSummary = (
  provider: string,
  oauth: Record<string, RelayOAuthClient | undefined> | undefined
) => ({
  id: provider,
  ...(oauth?.[provider]?.displayName != null ? { displayName: oauth[provider].displayName } : {})
})

const providerConfig = (provider: string, client: RelayOAuthClient) => {
  const meta = isBuiltInProvider(provider) ? providerMeta[provider] : undefined
  const authUrl = client.authorizationUrl ?? meta?.authUrl
  const tokenUrl = client.tokenUrl ?? meta?.tokenUrl
  const userUrl = client.userInfoUrl ?? meta?.userUrl
  if (authUrl == null || tokenUrl == null || userUrl == null) {
    throw new Error(`OAuth provider "${provider}" is missing endpoint configuration.`)
  }
  return {
    authUrl,
    scope: client.scope ?? meta?.scope ?? 'openid email profile',
    tokenUrl,
    userUrl
  }
}

export const buildOAuthAuthorizeUrl = (params: {
  client: RelayOAuthClient
  loginHint?: string
  prompt?: string
  provider: string
  redirectUri: string
  state: string
}) => {
  const config = providerConfig(params.provider, params.client)
  const url = new URL(config.authUrl)
  url.searchParams.set('client_id', params.client.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', params.state)
  if (params.loginHint != null && params.loginHint.trim() !== '') {
    url.searchParams.set('login_hint', params.loginHint.trim())
  }
  if (params.prompt != null && params.prompt.trim() !== '') {
    url.searchParams.set('prompt', params.prompt.trim())
  }
  return url.toString()
}

const fetchAccessToken = async (provider: string, client: RelayOAuthClient, code: string, redirectUri: string) => {
  const config = providerConfig(provider, client)
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !isRecord(body) || typeof body.access_token !== 'string') {
    throw new Error('OAuth token exchange failed.')
  }
  return body.access_token
}

const fetchJson = async (url: string, token: string) => {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`
    }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !isRecord(body)) {
    throw new Error('OAuth profile fetch failed.')
  }
  return body
}

const readGithubEmail = async (token: string) => {
  const response = await fetch(providerMeta.github.emailUrl, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`
    }
  })
  const emails = await response.json().catch(() => [])
  if (!Array.isArray(emails)) return ''
  const primary = emails.find(email => isRecord(email) && email.primary === true && email.verified === true)
  return isRecord(primary) && typeof primary.email === 'string' ? primary.email : ''
}

const readProviderEmail = async (provider: string, token: string, profile: Record<string, unknown>) => {
  if (provider === 'github') {
    const email = await readGithubEmail(token)
    return {
      email,
      verified: email !== ''
    }
  }
  const email = typeof profile.email === 'string' ? profile.email.trim() : ''
  const verified = profile.email_verified === true
  return {
    email: verified ? email : '',
    verified
  }
}

export const fetchOAuthProfile = async (params: {
  client: RelayOAuthClient
  code: string
  provider: string
  redirectUri: string
}): Promise<OAuthProfile> => {
  const token = await fetchAccessToken(params.provider, params.client, params.code, params.redirectUri)
  const config = providerConfig(params.provider, params.client)
  const profile = await fetchJson(config.userUrl, token)
  const email = await readProviderEmail(params.provider, token, profile)
  if (email.email === '') throw new Error('OAuth profile did not include a verified email address.')
  return {
    id: String(params.provider === 'github' ? profile.id : profile.sub ?? profile.id),
    email: email.email,
    emailVerified: email.verified,
    loginId: typeof profile.login === 'string' && profile.login.trim() !== ''
      ? profile.login.trim()
      : typeof profile.preferred_username === 'string' && profile.preferred_username.trim() !== ''
      ? profile.preferred_username.trim()
      : undefined,
    name: typeof profile.name === 'string' && profile.name.trim() !== ''
      ? profile.name.trim()
      : typeof profile.preferred_username === 'string' && profile.preferred_username.trim() !== ''
      ? profile.preferred_username.trim()
      : email.email,
    avatarUrl: typeof profile.avatar_url === 'string'
      ? profile.avatar_url
      : typeof profile.picture === 'string'
      ? profile.picture
      : undefined
  }
}
