import { getClientBase, mergeRuntimeEnv, normalizeServerBaseUrl } from '#~/runtime-config.js'

interface DesktopRuntimeIdentity {
  clientMode: 'desktop'
  serverRole: 'manager' | 'workspace'
}

export const resolveClientRoutePathname = (pathname: string, clientBase: string) => {
  if (clientBase === '/') return pathname
  if (pathname === clientBase) return '/'
  if (pathname.startsWith(`${clientBase}/`)) return pathname.slice(clientBase.length)
  return pathname
}

const isDesktopManagerRoutePathname = (pathname: string, clientBase: string) => {
  const routePathname = resolveClientRoutePathname(pathname, clientBase)
  return (
    routePathname === '/launcher' ||
    routePathname.startsWith('/launcher/') ||
    routePathname === '/standalone' ||
    routePathname.startsWith('/standalone/')
  )
}

export const resolveDesktopRuntimeIdentity = (
  pathname: string,
  clientBase: string,
  hasDesktopBridge: boolean
): DesktopRuntimeIdentity | undefined => {
  if (!hasDesktopBridge) return undefined
  return {
    clientMode: 'desktop',
    serverRole: isDesktopManagerRoutePathname(pathname, clientBase) ? 'manager' : 'workspace'
  }
}

const isDesktopManagerRuntimeDocument = () => (
  isDesktopManagerRoutePathname(window.location.pathname, getClientBase())
)

interface ConnectDesktopManagerRuntimeOptions {
  requireCoreReadyAcknowledgement?: boolean
}

export const installDesktopRuntimeIdentityIfAvailable = () => {
  const identity = resolveDesktopRuntimeIdentity(
    window.location.pathname,
    getClientBase(),
    window.oneworksDesktop != null
  )
  if (identity == null) return undefined

  mergeRuntimeEnv({
    __ONEWORKS_PROJECT_CLIENT_MODE__: identity.clientMode,
    __ONEWORKS_PROJECT_SERVER_ROLE__: identity.serverRole
  })
  return identity
}

export const connectDesktopManagerRuntimeIfAvailable = async (
  options: ConnectDesktopManagerRuntimeOptions = {}
) => {
  if (!isDesktopManagerRuntimeDocument() || window.oneworksDesktop == null) return undefined
  const connection = await window.oneworksDesktop?.getManagerConnection?.()
    .catch((error) => {
      console.warn('[desktop] failed to load manager connection', error)
      return undefined
    })
  const managerServerBaseUrl = normalizeServerBaseUrl(connection?.serverBaseUrl)
  if (managerServerBaseUrl == null) return undefined

  mergeRuntimeEnv({
    __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
    __ONEWORKS_PROJECT_MANAGER_SERVER_BASE_URL__: managerServerBaseUrl,
    __ONEWORKS_PROJECT_SERVER_BASE_URL__: managerServerBaseUrl,
    __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager'
  })
  const markDesktopCoreReady = window.oneworksDesktop?.markDesktopCoreReady
  const coreReadyAcknowledged = markDesktopCoreReady == null
    ? false
    : await markDesktopCoreReady()
      .then(() => true)
      .catch((error) => {
        console.warn('[desktop] failed to report manager core readiness', error)
        return false
      })
  if (options.requireCoreReadyAcknowledgement && !coreReadyAcknowledged) return undefined
  return managerServerBaseUrl
}

export const markDesktopManagerInteractiveWhenReady = async (
  isCurrent: () => boolean = () => true
) => {
  const managerServerBaseUrl = await connectDesktopManagerRuntimeIfAvailable({
    requireCoreReadyAcknowledgement: true
  })
  const markDesktopInteractive = window.oneworksDesktop?.markDesktopInteractive
  if (managerServerBaseUrl == null || markDesktopInteractive == null || !isCurrent()) return false

  markDesktopInteractive()
  return true
}
