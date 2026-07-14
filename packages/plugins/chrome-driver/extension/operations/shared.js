export const PROTOCOL_VERSION = 1
export const EXTENSION_VERSION = '0.1.0'

export const error = (code, message, extras = {}) => Object.assign(new Error(message), { code, ...extras })

const sensitiveText =
  /((?:bearer|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|authorization)\s*[:=]\s*)[^\s,;]+/giu
const bearerText = /\bbearer\s+[\w.~+/=-]+/giu
const sensitiveQueryKey =
  /^(?:access_token|api_key|apikey|auth|authorization|code|id_token|key|password|refresh_token|secret|token)$/iu

export function redactUrl(value) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQueryKey.test(key)) url.searchParams.set(key, '[redacted]')
    }
    url.hash = ''
    return url.toString()
  } catch {
    return value
  }
}

export function sanitizeResult(value, key = '') {
  if (Array.isArray(value)) return value.map(item => sanitizeResult(item, key))
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([childKey]) => !(key === 'pacScript' && childKey === 'data'))
        .map(([childKey, childValue]) => [childKey, sanitizeResult(childValue, childKey)])
    )
  }
  if (typeof value !== 'string' || key === 'data_base64') return value
  const sanitized = /(?:url|uri)$/iu.test(key) || key === 'href' ? redactUrl(value) : value
  return sanitized.replace(bearerText, 'Bearer [redacted]').replace(sensitiveText, '$1[redacted]')
}

export function sanitizeSensitiveSnapshotResult(value) {
  const sanitized = sanitizeResult(value)
  if (value == null || typeof value !== 'object' || sanitized == null || typeof sanitized !== 'object') return sanitized
  if (!Array.isArray(value.elements) || !Array.isArray(sanitized.elements)) return sanitized
  for (let index = 0; index < value.elements.length; index += 1) {
    const source = value.elements[index]
    const target = sanitized.elements[index]
    if (
      source?.sensitive === true && typeof source.value === 'string' && target != null && typeof target === 'object'
    ) {
      target.value = source.value
    }
  }
  return sanitized
}

export async function requirePermissions(permissions = [], origins = []) {
  const request = {
    ...(permissions.length === 0 ? {} : { permissions }),
    ...(origins.length === 0 ? {} : { origins })
  }
  if (Object.keys(request).length === 0 || await chrome.permissions.contains(request)) return
  throw error('MISSING_PERMISSION', 'This Chrome operation needs an optional permission.', {
    missing_permissions: [...permissions, ...origins],
    user_action: 'Open the OneWorks Chrome extension and grant only the requested capability.'
  })
}

export function cleanTab(tab) {
  if (tab == null) return tab
  return {
    id: tab.id,
    window_id: tab.windowId,
    index: tab.index,
    group_id: tab.groupId,
    active: tab.active,
    highlighted: tab.highlighted,
    pinned: tab.pinned,
    discarded: tab.discarded,
    auto_discardable: tab.autoDiscardable,
    audible: tab.audible,
    muted: tab.mutedInfo?.muted,
    incognito: tab.incognito,
    status: tab.status,
    title: tab.title,
    url: tab.url,
    pending_url: tab.pendingUrl,
    fav_icon_url: tab.favIconUrl,
    width: tab.width,
    height: tab.height
  }
}

export function cleanWindow(window) {
  if (window == null) return window
  return {
    id: window.id,
    focused: window.focused,
    incognito: window.incognito,
    type: window.type,
    state: window.state,
    always_on_top: window.alwaysOnTop,
    left: window.left,
    top: window.top,
    width: window.width,
    height: window.height,
    ...(window.tabs == null ? {} : { tabs: window.tabs.map(cleanTab) })
  }
}

export function isoToMs(value) {
  if (value == null) return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw error('INVALID_ARGUMENT', 'Expected an ISO date-time value.')
  return parsed
}

export function safeFilename(value, fallback) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '') return fallback
  if (name.startsWith('/') || name.includes('..') || name.includes('\\')) {
    throw error('INVALID_ARGUMENT', 'Filename must be relative and cannot escape Downloads.')
  }
  return name.replaceAll(/[^\w./ -]/g, '_').slice(0, 180)
}

export const contentSettingNames = new Set([
  'cookies',
  'images',
  'javascript',
  'location',
  'microphone',
  'camera',
  'notifications',
  'popups',
  'automaticDownloads',
  'clipboard',
  'sound'
])

export const privacySettings = new Map([
  ['network.networkPredictionEnabled', ['network', 'networkPredictionEnabled']],
  ['network.webRTCIPHandlingPolicy', ['network', 'webRTCIPHandlingPolicy']],
  ['services.autofillAddressEnabled', ['services', 'autofillAddressEnabled']],
  ['services.autofillCreditCardEnabled', ['services', 'autofillCreditCardEnabled']],
  ['websites.doNotTrackEnabled', ['websites', 'doNotTrackEnabled']],
  ['websites.hyperlinkAuditingEnabled', ['websites', 'hyperlinkAuditingEnabled']],
  ['websites.protectedContentEnabled', ['websites', 'protectedContentEnabled']]
])

export function namedSetting(root, name) {
  const path = privacySettings.get(name)
  if (path == null) throw error('UNSUPPORTED_SETTING', `Unsupported named privacy setting: ${name}`)
  const setting = root[path[0]]?.[path[1]]
  if (setting == null) throw error('UNAVAILABLE_CAPABILITY', `Chrome does not expose ${name} in this build.`)
  return setting
}
