/* eslint-disable max-lines -- deployment smoke assertions intentionally remain in one executable script. */
import process from 'node:process'

import { assertExpectedRelayHealth, waitForExpectedRelayHealth } from './relay-release-readiness.mjs'

const origin = (process.env.RELAY_ORIGIN ?? process.env.RELAY_DEV_ORIGIN ?? '').trim().replace(/\/+$/, '')
const expectedVersion = (
  process.env.RELAY_EXPECTED_VERSION ??
    process.env.RELAY_DEV_EXPECTED_VERSION ??
    ''
).trim()
const expectedBuildSha = (process.env.RELAY_EXPECTED_BUILD_SHA ?? '').trim()
const readinessAttempts = Number(process.env.RELAY_SMOKE_READY_ATTEMPTS ?? '1')
const readinessIntervalMs = Number(process.env.RELAY_SMOKE_READY_INTERVAL_MS ?? '20000')
const expectedDeviceApiOrigin = (
  process.env.RELAY_EXPECTED_DEVICE_API_ORIGIN ??
    process.env.RELAY_DEV_CF_DEVICE_API_ORIGIN ??
    process.env.RELAY_PROD_CF_DEVICE_API_ORIGIN ??
    ''
).trim().replace(/\/+$/, '')
const expectedTransport = (process.env.RELAY_EXPECTED_TRANSPORT ?? '').trim()
const expectedTransportHeartbeatMs = Number(process.env.RELAY_EXPECTED_TRANSPORT_HEARTBEAT_MS ?? '')
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

const health = await waitForExpectedRelayHealth({
  attempts: readinessAttempts,
  expectedBuildSha,
  expectedVersion,
  fetchHealth: async () => await fetchJson('/health'),
  intervalMs: readinessIntervalMs,
  onRetry: ({ attempt, attempts, error }) => {
    console.warn(
      `Relay readiness attempt ${attempt}/${attempts} failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
})

let directDeviceHealth
let deviceTransport
const needsServiceInfo = expectedDeviceApiOrigin !== '' || expectedTransport !== ''
const serviceInfo = needsServiceInfo ? await fetchJson('/api/relay/info') : undefined
if (expectedTransport !== '') {
  deviceTransport = serviceInfo.deviceTransport
  if (expectedTransport === 'v1-websocket') {
    assert(deviceTransport?.version === 1, '/api/relay/info must advertise v1 WebSocket transport.')
    if (Number.isFinite(expectedTransportHeartbeatMs)) {
      assert(
        deviceTransport.heartbeatIntervalMs === expectedTransportHeartbeatMs,
        `/api/relay/info WebSocket heartbeat should be ${expectedTransportHeartbeatMs}ms, got ${
          String(
            deviceTransport.heartbeatIntervalMs ?? ''
          )
        }.`
      )
    }
  } else if (expectedTransport === 'v2-long-poll') {
    assert(
      deviceTransport?.version === 2 && deviceTransport.mode === 'long-poll',
      '/api/relay/info must advertise v2 long-poll transport.'
    )
    assert(
      deviceTransport.longPollMaxWaitMs === 50_000,
      `/api/relay/info long-poll wait should be 50000ms, got ${String(deviceTransport.longPollMaxWaitMs ?? '')}.`
    )
    assert(
      deviceTransport.idleRetryMs === 250_000,
      `/api/relay/info long-poll idle retry should be 250000ms, got ${String(deviceTransport.idleRetryMs ?? '')}.`
    )
  } else {
    throw new Error(`Unsupported RELAY_EXPECTED_TRANSPORT "${expectedTransport}".`)
  }
}

if (expectedDeviceApiOrigin !== '') {
  const deviceApiUrl = new URL(`${expectedDeviceApiOrigin}/`)
  assert(
    deviceApiUrl.protocol === 'https:' && deviceApiUrl.pathname === '/' && deviceApiUrl.search === '' &&
      deviceApiUrl.hash === '' && deviceApiUrl.username === '' && deviceApiUrl.password === '',
    'RELAY_EXPECTED_DEVICE_API_ORIGIN must be a credential-free HTTPS origin without a path.'
  )
  const directHealthResponse = await fetch(new URL('/health', deviceApiUrl))
  const directHealthText = await directHealthResponse.text()
  assert(
    directHealthResponse.ok,
    `Direct device /health returned ${directHealthResponse.status}: ${directHealthText.slice(0, 500)}`
  )
  directDeviceHealth = JSON.parse(directHealthText)
  assertExpectedRelayHealth(
    directDeviceHealth,
    { expectedBuildSha, expectedVersion },
    'Direct device /health'
  )

  deviceTransport = serviceInfo.deviceTransport
  const expectedControlUrl = new URL('/api/relay/devices/control', deviceApiUrl)
  expectedControlUrl.protocol = 'wss:'
  assert(deviceTransport?.version === 1, '/api/relay/info did not advertise deviceTransport.version=1.')
  assert(
    deviceTransport.apiBaseUrl === deviceApiUrl.toString(),
    `/api/relay/info device API should be ${deviceApiUrl.toString()}, got ${String(deviceTransport?.apiBaseUrl ?? '')}.`
  )
  assert(
    deviceTransport.controlWebSocketUrl === expectedControlUrl.toString(),
    `/api/relay/info control WebSocket should be ${expectedControlUrl.toString()}, got ${
      String(deviceTransport?.controlWebSocketUrl ?? '')
    }.`
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
      ...(directDeviceHealth == null ? {} : { directDeviceHealth, deviceTransport }),
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
