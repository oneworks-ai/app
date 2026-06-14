import { WEB_DEBUG_CHII_BASE_PATH, WEB_DEBUG_CHII_ROUTE_PREFIX } from './chii-runtime.js'

export const getPathWithoutTrailingSlash = (path: string) => path.endsWith('/') ? path.slice(0, -1) : path

const isLegacyTokenPathSegment = (segment: string | undefined) => segment != null && /^[a-f0-9]{32}$/u.test(segment)

export const resolveChiiBasePath = (pathname: string) => {
  const routeRoot = getPathWithoutTrailingSlash(WEB_DEBUG_CHII_BASE_PATH)
  if (pathname === routeRoot || pathname === WEB_DEBUG_CHII_BASE_PATH) {
    return WEB_DEBUG_CHII_BASE_PATH
  }
  if (!pathname.startsWith(WEB_DEBUG_CHII_ROUTE_PREFIX)) {
    return undefined
  }

  const [firstSegment] = pathname
    .slice(WEB_DEBUG_CHII_ROUTE_PREFIX.length)
    .split('/')

  return isLegacyTokenPathSegment(firstSegment)
    ? `${WEB_DEBUG_CHII_ROUTE_PREFIX}${firstSegment}/`
    : WEB_DEBUG_CHII_BASE_PATH
}
