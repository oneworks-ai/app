const CACHE_PREFIX = 'oneworks-web'
const serviceWorkerGlobal = globalThis
const scriptUrl = new URL(serviceWorkerGlobal.location.href)
const buildVersion = scriptUrl.searchParams.get('v')?.trim().replace(/[^\w.-]/g, '-')
const CACHE_VERSION = buildVersion ? `v5-${buildVersion}` : 'v5'
const APP_CACHE = `${CACHE_PREFIX}-app-${CACHE_VERSION}`
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`

const appScopeUrl = new URL(serviceWorkerGlobal.registration.scope)

const isSameOrigin = url => url.origin === serviceWorkerGlobal.location.origin

const isInsideAppScope = url => url.href.startsWith(appScopeUrl.href)

const isSkippableAssetUrl = value => /^(?:data|blob|javascript):/i.test(value.trim())

const createReloadRequest = request => new Request(request, { cache: 'reload' })

const resolveAppAssetUrl = (value, baseUrl = appScopeUrl.href) => {
  const trimmed = value.trim()
  if (trimmed === '' || isSkippableAssetUrl(trimmed)) return undefined

  try {
    const url = new URL(trimmed, baseUrl)
    return isSameOrigin(url) && isInsideAppScope(url) ? url : undefined
  } catch {
    return undefined
  }
}

const extractAppAssetUrls = (text, baseUrl) => {
  const urls = new Map()
  const addUrl = value => {
    const url = resolveAppAssetUrl(value, baseUrl)
    if (url != null) urls.set(url.href, url)
  }

  for (const match of text.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    addUrl(match[1])
  }

  for (const match of text.matchAll(/url\(([^)]*)\)/gi)) {
    addUrl(match[1].trim().replace(/^["']|["']$/g, ''))
  }

  return Array.from(urls.values())
}

const shouldParseNestedAssets = (url, response) => {
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('text/css') ||
    contentType.includes('text/html') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.html')
}

const shouldCacheNestedAssetUrl = url => {
  const pathname = url.pathname.toLowerCase()
  return pathname.endsWith('.woff') || pathname.endsWith('.woff2') || pathname.endsWith('.png') ||
    pathname.endsWith('.svg')
}

const isRequiredAppShellAsset = url => {
  const pathname = url.pathname.toLowerCase()
  return pathname.endsWith('.css') || pathname.endsWith('.js') || pathname.endsWith('.mjs')
}

const isStaticAssetRequest = url => (
  url.pathname.includes('/assets/') ||
  url.pathname.endsWith('/apple-touch-icon.png') ||
  url.pathname.endsWith('/favicon.svg') ||
  url.pathname.endsWith('/favicon-metal-dark.png') ||
  url.pathname.endsWith('/favicon-metal-dark.svg') ||
  url.pathname.endsWith('/favicon-metal-light.png') ||
  url.pathname.endsWith('/favicon-metal-light.svg') ||
  url.pathname.endsWith('/manifest.webmanifest') ||
  url.pathname.endsWith('/pwa-icon-192.png') ||
  url.pathname.endsWith('/pwa-icon-512.png')
)

const pruneOldCaches = async () => {
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== APP_CACHE && name !== STATIC_CACHE)
      .map(name => caches.delete(name))
  )
}

const cacheReferencedAssets = async (cache, response, baseUrl, depth = 0) => {
  const text = await response.clone().text()
  const assets = extractAppAssetUrls(text, baseUrl)
    .filter(url => depth === 0 || shouldCacheNestedAssetUrl(url))
    .map(url => ({
      required: depth === 0 && isRequiredAppShellAsset(url),
      url
    }))

  const results = await Promise.allSettled(
    assets.map(async ({ url }) => {
      const request = new Request(url.href, { cache: 'reload' })
      const assetResponse = await fetch(request)
      if (!assetResponse.ok) {
        throw new Error(`App shell asset "${url.href}" returned HTTP ${assetResponse.status}.`)
      }

      await cache.put(request, assetResponse.clone())
      if (depth < 1 && shouldParseNestedAssets(url, assetResponse)) {
        await cacheReferencedAssets(cache, assetResponse, url.href, depth + 1)
      }
    })
  )
  for (const [index, result] of results.entries()) {
    if (assets[index]?.required === true && result.status === 'rejected') {
      throw result.reason
    }
  }
}

const cacheAppShell = async () => {
  const appCache = await caches.open(APP_CACHE)
  const staticCache = await caches.open(STATIC_CACHE)

  try {
    const request = new Request(appScopeUrl.href, { cache: 'reload' })
    const response = await fetch(request)
    if (!response.ok) {
      throw new Error(`App shell warmup returned HTTP ${response.status}.`)
    }

    await appCache.put(appScopeUrl.href, response.clone())
    await cacheReferencedAssets(staticCache, response, appScopeUrl.href)
  } catch (error) {
    await Promise.allSettled([
      caches.delete(APP_CACHE),
      caches.delete(STATIC_CACHE)
    ])
    throw error
  }
}

const networkFirstNavigation = async request => {
  const cache = await caches.open(APP_CACHE)
  try {
    const response = await fetch(createReloadRequest(request))
    if (response.ok) {
      await cache.put(appScopeUrl.href, response.clone())
    }
    return response
  } catch (error) {
    const cached = await cache.match(appScopeUrl.href)
    if (cached != null) {
      return cached
    }
    throw error
  }
}

const staleWhileRevalidate = async request => {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  const networkResponse = fetch(createReloadRequest(request))
    .then(async response => {
      if (response.ok) {
        await cache.put(request, response.clone())
      }
      return response
    })
    .catch(error => {
      if (cached != null) {
        return cached
      }
      throw error
    })

  return cached ?? networkResponse
}

serviceWorkerGlobal.addEventListener('install', event => {
  event.waitUntil(
    cacheAppShell()
      .then(() => serviceWorkerGlobal.skipWaiting())
  )
})

serviceWorkerGlobal.addEventListener('activate', event => {
  event.waitUntil(
    pruneOldCaches()
      .then(() => serviceWorkerGlobal.clients.claim())
  )
})

serviceWorkerGlobal.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (!isSameOrigin(url) || !isInsideAppScope(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (isStaticAssetRequest(url)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})
