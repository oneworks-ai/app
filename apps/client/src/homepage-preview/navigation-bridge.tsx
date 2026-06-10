import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { isHomepagePreviewRuntimeEnabled } from '#~/homepage-preview/mock-runtime'
import { resolveQueryParamPathname } from '#~/hooks/useQueryParams'
import { getClientBase } from '#~/runtime-config'

const HOMEPAGE_PREVIEW_MESSAGE = 'oneworks:homepage-preview'
const HOMEPAGE_PREVIEW_SOURCE = 'oneworks-homepage'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isLocalPreviewOrigin = (origin: string) => {
  try {
    const originUrl = new URL(origin)
    const currentUrl = new URL(window.location.origin)
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    return localHosts.has(originUrl.hostname) && localHosts.has(currentUrl.hostname)
  } catch {
    return false
  }
}

const isAllowedPreviewOrigin = (origin: string) => {
  if (origin === window.location.origin) return true
  if (isLocalPreviewOrigin(origin)) return true
  try {
    const originUrl = new URL(origin)
    return originUrl.hostname === 'oneworks-ai.github.io'
  } catch {
    return false
  }
}

const readNavigationUrl = (data: unknown) => {
  if (!isRecord(data) || data.type !== HOMEPAGE_PREVIEW_MESSAGE) {
    return undefined
  }
  if (data.source != null && data.source !== HOMEPAGE_PREVIEW_SOURCE) {
    return undefined
  }
  if (!isRecord(data.payload) || typeof data.payload.navigationUrl !== 'string') {
    return undefined
  }

  const trimmed = data.payload.navigationUrl.trim()
  if (trimmed === '') return undefined

  try {
    const url = new URL(trimmed, window.location.origin)
    if (url.origin !== window.location.origin) return undefined
    return url
  } catch {
    return undefined
  }
}

export function HomepagePreviewNavigationBridge() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isHomepagePreviewRuntimeEnabled()) return

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isAllowedPreviewOrigin(event.origin)) return

      const url = readNavigationUrl(event.data)
      if (url == null) return

      const pathname = resolveQueryParamPathname(url.pathname, getClientBase())
      const search = url.search
      if (pathname === location.pathname && search === location.search) return

      void navigate({ pathname, search }, { replace: true })
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [location.pathname, location.search, navigate])

  return null
}
