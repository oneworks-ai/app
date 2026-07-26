import process from 'node:process'

const origin = (process.env.RELAY_ORIGIN ?? process.env.RELAY_DEV_ORIGIN ?? '').trim().replace(/\/+$/, '')
const expectedVersion = (
  process.env.RELAY_EXPECTED_VERSION ??
    process.env.RELAY_DEV_EXPECTED_VERSION ??
    ''
).trim()
const expectedBuildSha = (process.env.RELAY_EXPECTED_BUILD_SHA ?? '').trim()
const expectedProviders = (
  process.env.RELAY_EXPECTED_SSO_PROVIDERS ??
    process.env.RELAY_DEV_EXPECTED_SSO_PROVIDERS ??
    ''
)
  .split(',')
  .map(item => item.trim())
  .filter(Boolean)

if (origin === '') {
  throw new Error('Set RELAY_ORIGIN for the Relay deployment smoke check.')
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const fetchText = async (path, input) => {
  const url = new URL(path, `${origin}/`)
  assert(url.origin === origin, `Refusing to smoke check cross-origin asset ${url.toString()}.`)
  const response = await fetch(url, input)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${url.pathname} returned ${response.status}: ${text.slice(0, 500)}`)
  }
  return { response, text }
}

const fetchJson = async path => {
  const { text } = await fetchText(path)
  return JSON.parse(text)
}

const health = await fetchJson('/health')
assert(health.ok === true, `/health did not return ok=true: ${JSON.stringify(health)}`)
if (expectedVersion !== '') {
  assert(
    health.version === expectedVersion,
    `/health.version should be "${expectedVersion}", got "${String(health.version ?? '')}".`
  )
}
if (expectedBuildSha !== '') {
  assert(
    health.buildSha === expectedBuildSha,
    `/health.buildSha should be "${expectedBuildSha}", got "${String(health.buildSha ?? '')}".`
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

const admin = await fetchText('/admin')
const adminScript = admin.text.match(/<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/iu)?.[1] ?? ''
const adminStyle = admin.text.match(/<link[^>]+href=["']([^"']+\.css(?:\?[^"']*)?)["']/iu)?.[1] ?? ''
assert(adminScript !== '', '/admin did not reference a JavaScript asset.')
assert(adminStyle !== '', '/admin did not reference a CSS asset.')
const [scriptAsset, styleAsset] = await Promise.all([
  fetchText(adminScript),
  fetchText(adminStyle)
])
assert(scriptAsset.text.trim() !== '', `${adminScript} returned an empty JavaScript asset.`)
assert(styleAsset.text.trim() !== '', `${adminStyle} returned an empty CSS asset.`)
const scriptContentType = scriptAsset.response.headers.get('content-type')?.toLowerCase() ?? ''
const styleContentType = styleAsset.response.headers.get('content-type')?.toLowerCase() ?? ''
assert(
  (scriptContentType.includes('javascript') || scriptContentType.includes('ecmascript')) &&
    !scriptContentType.includes('text/html'),
  `${adminScript} returned unexpected Content-Type "${scriptContentType || '(missing)'}".`
)
assert(
  styleContentType.includes('text/css') && !styleContentType.includes('text/html'),
  `${adminStyle} returned unexpected Content-Type "${styleContentType || '(missing)'}".`
)

const unauthorized = await fetch(`${origin}/api/admin/users`)
assert(
  unauthorized.status === 401,
  `/api/admin/users should return 401 without auth, got ${unauthorized.status}`
)

// Match the desktop client's real login handoff. A web URL on the Relay's custom
// domain is not necessarily an allowed client origin (for example, Vercel uses
// its canonical project origin), so using one here can turn a healthy deployment
// into a false-negative smoke result.
const redirectUri = 'oneworks://relay/auth?workspace=%2Fsmoke&scope=relay&serverId=smoke'
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
      adminAssets: {
        script: adminScript,
        style: adminStyle
      },
      providers: providerIds
    },
    null,
    2
  )
)
