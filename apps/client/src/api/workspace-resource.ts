import { resolveWorkspaceIdFromPathname } from '#~/runtime-config.js'

export const routeWorkspaceResourceUrlThroughLauncher = (
  directUrl: URL,
  options: { path: string; sessionId?: string }
) => {
  if (typeof window === 'undefined') return directUrl

  const workspaceId = resolveWorkspaceIdFromPathname(window.location.pathname)
  if (workspaceId == null || directUrl.origin === window.location.origin) return directUrl
  if (!/^https?:$/.test(window.location.protocol)) return directUrl

  const url = new URL(
    `/api/launcher/workspaces/${encodeURIComponent(workspaceId)}/resource`,
    window.location.origin
  )
  url.searchParams.set('path', options.path)
  if (options.sessionId != null && options.sessionId !== '') {
    url.searchParams.set('sessionId', options.sessionId)
  }
  return url
}
