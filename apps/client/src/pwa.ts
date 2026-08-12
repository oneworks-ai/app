import { getClientCommitHash, getClientVersion } from '#~/client-build-info'

const CACHE_PREFIX = 'oneworks-web'
const DESKTOP_RESET_SESSION_KEY = 'oneworks-desktop-pwa-reset'

export const isPwaUpdaterAvailable = (input: {
  hasServiceWorker: boolean
  isDesktop: boolean
  isProd: boolean
}) => input.hasServiceWorker && input.isProd && !input.isDesktop

const normalizeBasePath = (clientBase: string) => {
  const trimmed = clientBase.trim()
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const getServiceWorkerRegistration = (clientBase: string) => {
  const scope = normalizeBasePath(clientBase)
  const cacheVersion = getClientCommitHash() ?? getClientVersion()
  return {
    scope,
    url: `${scope}sw.js?v=${encodeURIComponent(cacheVersion)}`
  }
}

const unregisterServiceWorker = async (scope: string) => {
  const scopeUrl = new URL(scope, window.location.origin).href
  if (typeof navigator.serviceWorker.getRegistrations !== 'function') {
    return false
  }

  const registrations = await navigator.serviceWorker.getRegistrations()
  const scopedRegistrations = registrations.filter(registration => registration.scope === scopeUrl)
  await Promise.all(scopedRegistrations.map(registration => registration.unregister()))
  return scopedRegistrations.length > 0
}

const clearPwaCaches = async () => {
  if (!('caches' in globalThis)) return

  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter(name => name.startsWith(CACHE_PREFIX))
      .map(name => caches.delete(name))
  )
}

const disableServiceWorker = async (scope: string, reloadControlledPage: boolean) => {
  const controlled = navigator.serviceWorker.controller != null
  const cleanupResults = await Promise.allSettled([
    unregisterServiceWorker(scope),
    clearPwaCaches()
  ])
  for (const result of cleanupResults) {
    if (result.status === 'rejected') {
      console.warn('[pwa] failed to remove stale service worker state', result.reason)
    }
  }

  if (!reloadControlledPage || !controlled) {
    return true
  }

  try {
    const resetScope = sessionStorage.getItem(DESKTOP_RESET_SESSION_KEY)
    if (resetScope === scope) {
      return true
    }
    sessionStorage.setItem(DESKTOP_RESET_SESSION_KEY, scope)
  } catch (error) {
    console.warn('[pwa] failed to track desktop service worker reset', error)
    return true
  }

  window.location.reload()
  return false
}

export const setupPwa = async (input: {
  clientBase: string
  isDesktop: boolean
  isProd: boolean
}) => {
  const hasServiceWorker = 'serviceWorker' in navigator
  if (!hasServiceWorker) return

  const registration = getServiceWorkerRegistration(input.clientBase)
  if (
    !isPwaUpdaterAvailable({
      hasServiceWorker,
      isDesktop: input.isDesktop,
      isProd: input.isProd
    })
  ) {
    return await disableServiceWorker(registration.scope, input.isDesktop)
  }

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(registration.url, { scope: registration.scope })
      .catch((error: unknown) => {
        console.warn('[pwa] service worker registration failed', error)
      })
  })
  return true
}
