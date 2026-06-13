declare const process: { env?: Record<string, string | undefined> } | undefined

const proxyOriginEnvKeys = [
  'ONEWORKS_RELAY_ADMIN_PROXY_TARGET',
  'RELAY_ADMIN_PROXY_TARGET',
  'RELAY_API_ORIGIN'
]

const hopByHopHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

const responseHeadersToDrop = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding'
])

const readGlobalEnv = (key: string) => {
  if (typeof process === 'undefined') return undefined
  return process.env?.[key]
}

const cleanPath = (value: string) => {
  const path = value.trim() === '' ? '/' : value.trim()
  return path.startsWith('/') ? path : `/${path}`
}

export const resolveRelayProxyOrigin = (env: Record<string, unknown> = {}) => {
  for (const key of proxyOriginEnvKeys) {
    const value = env[key] ?? readGlobalEnv(key)
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim().replace(/\/+$/, '')
    }
  }
  throw new Error(
    `Relay Admin proxy target is not configured. Set one of: ${proxyOriginEnvKeys.join(', ')}.`
  )
}

export const buildRelayProxyUrl = (
  path: string,
  requestUrl: string,
  env?: Record<string, unknown>
) => {
  const target = new URL(cleanPath(path), `${resolveRelayProxyOrigin(env)}/`)
  const source = new URL(requestUrl)
  for (const [key, value] of source.searchParams.entries()) {
    if (key !== 'relay_path') target.searchParams.append(key, value)
  }
  return target
}

export const createRelayProxyHeaders = (headers: Headers) => {
  const next = new Headers()
  for (const [key, value] of headers.entries()) {
    if (!hopByHopHeaders.has(key.toLowerCase())) next.set(key, value)
  }
  return next
}

export const createRelayProxyResponseHeaders = (headers: Headers) => {
  const next = new Headers()
  for (const [key, value] of headers.entries()) {
    if (!responseHeadersToDrop.has(key.toLowerCase())) next.set(key, value)
  }
  return next
}

export const proxyRelayRequest = async (
  request: Request,
  path: string,
  env?: Record<string, unknown>
) => {
  const method = request.method.toUpperCase()
  const target = buildRelayProxyUrl(path, request.url, env)
  const upstream = await fetch(target, {
    body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
    headers: createRelayProxyHeaders(request.headers),
    method,
    redirect: 'manual'
  })
  return new Response(upstream.body, {
    headers: createRelayProxyResponseHeaders(upstream.headers),
    status: upstream.status,
    statusText: upstream.statusText
  })
}
