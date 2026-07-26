import { getClientBase, mergeRuntimeEnv, normalizeServerBaseUrl } from '#~/runtime-config.js'

export const resolveClientRoutePathname = (pathname: string, clientBase: string) => {
  if (clientBase === '/') return pathname
  if (pathname === clientBase) return '/'
  if (pathname.startsWith(`${clientBase}/`)) return pathname.slice(clientBase.length)
  return pathname
}

const isDesktopManagerRuntimeDocument = () => {
  const routePathname = resolveClientRoutePathname(
    window.location.pathname,
    getClientBase()
  )
  return (
    routePathname === '/launcher' ||
    routePathname.startsWith('/launcher/') ||
    routePathname === '/standalone' ||
    routePathname.startsWith('/standalone/')
  )
}

export const installDesktopManagerRuntimeIfAvailable = async () => {
  if (!isDesktopManagerRuntimeDocument()) return
  const connection = await window.oneworksDesktop?.getManagerConnection?.()
    .catch((error) => {
      console.warn('[desktop] failed to load manager connection', error)
      return undefined
    })
  const managerServerBaseUrl = normalizeServerBaseUrl(connection?.serverBaseUrl)
  if (managerServerBaseUrl == null) return

  mergeRuntimeEnv({
    __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
    __ONEWORKS_PROJECT_MANAGER_SERVER_BASE_URL__: managerServerBaseUrl,
    __ONEWORKS_PROJECT_SERVER_BASE_URL__: managerServerBaseUrl,
    __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager'
  })
}
