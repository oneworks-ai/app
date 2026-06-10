import type Koa from 'koa'

const PUBLIC_CHANNEL_WEBHOOK_PATH = '/channels/*/*/webhook'

export interface PublicAccessOptions {
  publicPaths?: readonly string[]
}

const stripHostPort = (host: string) => {
  const trimmed = host.trim().toLowerCase()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end >= 0 ? trimmed.slice(0, end + 1) : trimmed
  }
  return trimmed.split(':')[0] ?? ''
}

const firstForwardedValue = (value: string) => value.split(',')[0]?.trim() ?? ''

const isLocalHost = (host: string) => {
  const normalized = stripHostPort(firstForwardedValue(host))
  return normalized === '' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.startsWith('127.')
}

const getRequestHost = (ctx: Koa.Context) => (
  ctx.get('x-forwarded-host') || ctx.get('host')
)

const matchesPublicPath = (path: string, publicPath: string) => {
  if (publicPath.endsWith('/*')) {
    const prefix = publicPath.slice(0, -1)
    return path.startsWith(prefix)
  }
  if (publicPath.includes('*')) {
    const pathSegments = path.split('/').filter(Boolean)
    const publicPathSegments = publicPath.split('/').filter(Boolean)
    return pathSegments.length === publicPathSegments.length &&
      publicPathSegments.every((segment, index) => segment === '*' || segment === pathSegments[index])
  }
  return path === publicPath
}

const resolvePublicPaths = (options: PublicAccessOptions) => [
  PUBLIC_CHANNEL_WEBHOOK_PATH,
  ...(options.publicPaths ?? []).filter(path => path.startsWith('/'))
]

export const publicAccessMiddleware = (options: PublicAccessOptions = {}): Koa.Middleware => {
  const publicPaths = resolvePublicPaths(options)
  return async (ctx, next) => {
    const host = getRequestHost(ctx)
    if (isLocalHost(host) || publicPaths.some(publicPath => matchesPublicPath(ctx.path, publicPath))) {
      await next()
      return
    }

    ctx.status = 404
    ctx.body = 'Not Found'
  }
}
