import { getAdvancedAccessPolicy } from './security.js'
import { EXTENSION_VERSION, PROTOCOL_VERSION } from './shared.js'

const optionalPermissions = [
  'bookmarks',
  'browsingData',
  'contentSettings',
  'cookies',
  'downloads',
  'downloads.open',
  'history',
  'management',
  'pageCapture',
  'privacy',
  'readingList',
  'scripting',
  'sessions',
  'system.display',
  'tabGroups',
  'tabs',
  'webNavigation'
]

export async function discoverCapabilities() {
  const granted = await chrome.permissions.getAll()
  const advancedAccess = await getAdvancedAccessPolicy()
  const has = permission => granted.permissions?.includes(permission) === true
  return {
    protocol_version: PROTOCOL_VERSION,
    extension_version: EXTENSION_VERSION,
    browser: navigator.userAgent,
    permissions: granted,
    optional_permissions: optionalPermissions,
    constraints: {
      tab_metadata: { permission: 'tabs', requestable: true },
      downloads_open: { user_gesture: true, direct_agent_execution: false },
      management_set_enabled: { user_gesture: true, direct_agent_execution: false },
      desktop_capture: {
        supported: false,
        reason: 'Chrome requires a native picker and MediaStream consumer; no bounded result model is exposed.'
      },
      file_urls: { user_toggle_required: true },
      incognito: { user_toggle_required: true },
      advanced_access: {
        scope: 'browser_session',
        user_toggle_required: true,
        per_operation_confirmation: true,
        raw_debugger_browser_wide: true,
        raw_debugger_global_serialization: true,
        raw_debugger_initial_target_guard: ['tab_id', 'expected_origin'],
        raw_debugger_includes: ['cookie_values', 'sensitive_fields'],
        host_file_escape_blocked: true
      },
      page_action_indicator: {
        cursor: 'oneworks-standard',
        cursor_size_px: 28,
        cursor_lifecycle: 'connection-session',
        cursor_transition: 'smooth',
        tab_favicon: 'temporary-agent-cursor'
      },
      large_artifacts: { transport: 'chunked', max_bytes: 52428800 }
    },
    advanced_access: advancedAccess,
    modules: {
      windows: true,
      tabs: true,
      groups: has('tabGroups'),
      sessions: has('sessions'),
      history: has('history'),
      bookmarks: has('bookmarks'),
      downloads: has('downloads'),
      reading_list: has('readingList') && chrome.readingList != null,
      management: has('management'),
      displays: has('system.display'),
      frames: has('webNavigation'),
      page: has('scripting'),
      debug: chrome.debugger != null,
      cookies: has('cookies'),
      content_settings: has('contentSettings'),
      browsing_data: has('browsingData'),
      proxy: chrome.proxy != null,
      privacy: has('privacy'),
      raw: chrome.debugger != null
    },
    risk_tiers: {
      0: 'capability and audit discovery',
      1: 'metadata and semantic reads',
      2: 'reversible scoped control',
      3: 'sensitive or destructive scoped action',
      4: 'browser-wide privileged action'
    },
    unsupported: [
      'Chrome password-manager export or saved-password reads',
      'host file-system paths or host-process code execution',
      'cross-origin frame policy bypass outside raw debugger access',
      'silent extension installation or permission grants',
      'unbounded response body capture',
      'desktop capture picker and ChromeOS-only printing APIs'
    ]
  }
}
