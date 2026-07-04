import process from 'node:process'

const origin = (process.env.RELAY_DEV_ORIGIN ?? '').trim().replace(/\/+$/, '')
const expectedVersion = (process.env.RELAY_DEV_EXPECTED_VERSION ?? '').trim()
const expectedProviders = (process.env.RELAY_DEV_EXPECTED_SSO_PROVIDERS ?? '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean)

if (origin === '') {
  throw new Error('Set RELAY_DEV_ORIGIN for the Relay dev smoke check.')
}

const fetchText = async (path, input) => {
  const response = await fetch(`${origin}${path}`, input)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 500)}`)
  }
  return { response, text }
}

const fetchJson = async path => {
  const { text } = await fetchText(path)
  return JSON.parse(text)
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const health = await fetchJson('/health')
assert(health.ok === true, `/health did not return ok=true: ${JSON.stringify(health)}`)
if (expectedVersion !== '') {
  assert(
    health.version === expectedVersion,
    `/health.version should be "${expectedVersion}", got "${String(health.version ?? '')}".`
  )
}

const providerPayload = await fetchJson('/api/auth/providers')
const providerIds = Array.isArray(providerPayload.providers)
  ? providerPayload.providers.map(provider => String(provider.id ?? ''))
  : []
for (const provider of expectedProviders) {
  assert(
    providerIds.includes(provider),
    `Expected SSO provider "${provider}" in /api/auth/providers, got: ${providerIds.join(', ') || '(none)'}`
  )
}

const unauthorized = await fetch(`${origin}/api/admin/users`)
assert(
  unauthorized.status === 401,
  `/api/admin/users should return 401 without auth, got ${unauthorized.status}`
)

const redirectUri = `${origin}/admin/devices`
const loginUrl = `/login?redirect_uri=${encodeURIComponent(redirectUri)}&lang=zh-CN`
const login = await fetchText(loginUrl)
assert(
  login.text.includes('id="relay-login-config"'),
  '/login did not include the Relay login config script.'
)
for (const provider of expectedProviders) {
  assert(
    login.text.includes(`"id":"${provider}"`),
    `/login config did not include expected provider "${provider}".`
  )
}

console.log(
  JSON.stringify(
    {
      health,
      origin,
      providers: providerIds
    },
    null,
    2
  )
)
