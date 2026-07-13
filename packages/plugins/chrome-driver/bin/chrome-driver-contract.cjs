/* eslint-disable max-lines -- Complete typed browser capability contract stays auditable in one registry. */
const { targetProperties, workflowProperties } = require('./chrome-driver-workflow-schema.cjs')

const actionTool = (name, description, variants, annotations = {}) => ({
  name,
  description,
  annotations,
  inputSchema: { oneOf: variants }
})

const object = (action, properties = {}, required = []) => ({
  type: 'object',
  additionalProperties: false,
  required: ['action', ...required],
  properties: { action: { const: action }, ...properties }
})

const pageTarget = { ...targetProperties }
const stablePageRequired = ['tab_id', 'document_id']
const tabRequired = ['tab_id']
const windowId = { window_id: { type: 'integer', minimum: 0 } }
const tabId = { tab_id: { type: 'integer', minimum: 0 } }
const groupId = { group_id: { type: 'integer', minimum: 0 } }
const bookmarkId = { bookmark_id: { type: 'string', minLength: 1 } }
const downloadId = { download_id: { type: 'integer', minimum: 0 } }
const maxResults = { max_results: { type: 'integer', minimum: 1, maximum: 100 } }
const expectedOrigin = { expected_origin: { type: 'string', format: 'uri' } }
const originScopedBrowsingDataTypes = {
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: {
    enum: ['cache', 'cacheStorage', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL']
  }
}

const tools = [
  {
    name: 'chrome_capabilities',
    description:
      'Discover the connected external Chrome version, negotiated modules, permissions, host access, risk tiers, and constraints.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  },
  actionTool('chrome_windows', 'List, inspect, create, update, or close explicit Chrome windows.', [
    object('list', { populate_tabs: { type: 'boolean' } }),
    object('get', windowId, ['window_id']),
    object('create', {
      urls: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      focused: { type: 'boolean' },
      incognito: { type: 'boolean' },
      type: { enum: ['normal', 'popup'] },
      left: { type: 'integer' },
      top: { type: 'integer' },
      width: { type: 'integer', minimum: 100 },
      height: { type: 'integer', minimum: 100 }
    }),
    object('update', {
      ...windowId,
      focused: { type: 'boolean' },
      state: { enum: ['normal', 'minimized', 'maximized', 'fullscreen'] },
      left: { type: 'integer' },
      top: { type: 'integer' },
      width: { type: 'integer', minimum: 100 },
      height: { type: 'integer', minimum: 100 }
    }, ['window_id']),
    object('close', windowId, ['window_id'])
  ]),
  actionTool('chrome_tabs', 'List and control explicit Chrome tabs without relying on an implicit current tab.', [
    object('list', {
      ...windowId,
      active: { type: 'boolean' },
      pinned: { type: 'boolean' },
      group_id: { type: 'integer' },
      url_patterns: { type: 'array', items: { type: 'string' }, maxItems: 20 }
    }),
    object('get', tabId, tabRequired),
    object('get_active', windowId, ['window_id']),
    object('create', {
      ...windowId,
      url: { type: 'string' },
      active: { type: 'boolean' },
      pinned: { type: 'boolean' },
      index: { type: 'integer', minimum: 0 },
      opener_tab_id: { type: 'integer', minimum: 0 }
    }),
    object('duplicate', tabId, tabRequired),
    object('update', {
      ...tabId,
      url: { type: 'string' },
      active: { type: 'boolean' },
      highlighted: { type: 'boolean' },
      pinned: { type: 'boolean' },
      muted: { type: 'boolean' },
      auto_discardable: { type: 'boolean' }
    }, tabRequired),
    object('move', { ...tabId, ...windowId, index: { type: 'integer', minimum: -1 } }, [
      'tab_id',
      'window_id',
      'index'
    ]),
    object('close', { tab_ids: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'integer', minimum: 0 } } }, [
      'tab_ids'
    ]),
    object('reload', { ...tabId, bypass_cache: { type: 'boolean' } }, tabRequired),
    object('back', tabId, tabRequired),
    object('forward', tabId, tabRequired),
    object('discard', tabId, tabRequired),
    object('group', {
      tab_ids: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'integer', minimum: 0 } },
      ...groupId,
      ...windowId
    }, ['tab_ids']),
    object(
      'ungroup',
      { tab_ids: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'integer', minimum: 0 } } },
      ['tab_ids']
    ),
    object('get_zoom', tabId, tabRequired),
    object('set_zoom', { ...tabId, factor: { type: 'number', minimum: 0.25, maximum: 5 } }, ['tab_id', 'factor'])
  ]),
  actionTool('chrome_tab_groups', 'List, inspect, update, or move explicit Chrome tab groups.', [
    object('list', windowId),
    object('get', groupId, ['group_id']),
    object('update', {
      ...groupId,
      collapsed: { type: 'boolean' },
      title: { type: 'string', maxLength: 100 },
      color: { enum: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] }
    }, ['group_id']),
    object('move', { ...groupId, ...windowId, index: { type: 'integer', minimum: 0 } }, [
      'group_id',
      'window_id',
      'index'
    ])
  ]),
  actionTool('chrome_sessions', 'Read recently closed or synced-device sessions and restore an explicit session.', [
    object('recent', maxResults),
    object('devices', maxResults),
    object('restore', { session_id: { type: 'string', minLength: 1 } }, ['session_id'])
  ]),
  actionTool(
    'chrome_history',
    'Search focused Chrome history, inspect visits, add a URL, or remove an explicitly bounded history scope.',
    [
      object('search', {
        query: { type: 'string' },
        start_time: { type: 'string', format: 'date-time' },
        end_time: { type: 'string', format: 'date-time' },
        ...maxResults
      }),
      object('visits', { url: { type: 'string' } }, ['url']),
      object('add', { url: { type: 'string' } }, ['url']),
      object('remove_url', { url: { type: 'string' } }, ['url']),
      object('remove_range', {
        start_time: { type: 'string', format: 'date-time' },
        end_time: { type: 'string', format: 'date-time' }
      }, ['start_time', 'end_time']),
      object('clear_all')
    ]
  ),
  actionTool('chrome_bookmarks', 'Query and manage Chrome bookmarks with explicit ids and bounded results.', [
    object('tree'),
    object('children', bookmarkId, ['bookmark_id']),
    object('recent', maxResults),
    object('search', { query: { type: 'string', minLength: 1 }, ...maxResults }, ['query']),
    object('create', {
      parent_id: { type: 'string' },
      index: { type: 'integer', minimum: 0 },
      title: { type: 'string' },
      url: { type: 'string' }
    }),
    object('update', { ...bookmarkId, title: { type: 'string' }, url: { type: 'string' } }, ['bookmark_id']),
    object('move', { ...bookmarkId, parent_id: { type: 'string' }, index: { type: 'integer', minimum: 0 } }, [
      'bookmark_id'
    ]),
    object('remove', { ...bookmarkId, recursive: { type: 'boolean' } }, ['bookmark_id'])
  ]),
  actionTool('chrome_downloads', 'Query and manage Chrome downloads without exposing arbitrary local paths.', [
    object('search', {
      query: { type: 'array', items: { type: 'string' }, maxItems: 10 },
      state: { enum: ['in_progress', 'interrupted', 'complete'] },
      ...maxResults
    }),
    object('start', {
      url: { type: 'string' },
      filename: { type: 'string' },
      save_as: { type: 'boolean' },
      conflict_action: { enum: ['uniquify', 'overwrite', 'prompt'] }
    }, ['url']),
    object('pause', downloadId, ['download_id']),
    object('resume', downloadId, ['download_id']),
    object('cancel', downloadId, ['download_id']),
    object('erase_record', downloadId, ['download_id']),
    object('remove_file', downloadId, ['download_id']),
    object('show', downloadId, ['download_id']),
    object('open', downloadId, ['download_id'])
  ]),
  actionTool('chrome_reading_list', 'Query and manage the Chrome Reading List.', [
    object('list', { read: { type: 'boolean' }, url: { type: 'string' }, title: { type: 'string' } }),
    object('add', { url: { type: 'string' }, title: { type: 'string' }, has_been_read: { type: 'boolean' } }, [
      'url',
      'title'
    ]),
    object('update', { url: { type: 'string' }, title: { type: 'string' }, has_been_read: { type: 'boolean' } }, [
      'url'
    ]),
    object('remove', { url: { type: 'string' } }, ['url'])
  ]),
  actionTool(
    'chrome_extensions',
    'Inspect installed extension metadata or perform a user-confirmed management action.',
    [
      object('list', {
        type: { enum: ['extension', 'theme', 'hosted_app', 'packaged_app'] },
        enabled: { type: 'boolean' }
      }),
      object('get', { extension_id: { type: 'string', minLength: 1 } }, ['extension_id']),
      object('set_enabled', { extension_id: { type: 'string', minLength: 1 }, enabled: { type: 'boolean' } }, [
        'extension_id',
        'enabled'
      ]),
      object('uninstall', { extension_id: { type: 'string', minLength: 1 }, show_confirm_dialog: { const: true } }, [
        'extension_id',
        'show_confirm_dialog'
      ])
    ]
  ),
  actionTool('chrome_devices', 'List local displays, synced browser devices, or available debugger targets.', [
    object('displays'),
    object('synced_devices', maxResults),
    object('debug_targets')
  ], { readOnlyHint: true }),
  actionTool('chrome_frames', 'List or inspect an explicit tab frame/document identity.', [
    object('list', tabId, tabRequired),
    object('get', { ...tabId, frame_id: { type: 'integer', minimum: 0 }, document_id: { type: 'string' } }, [
      'tab_id',
      'frame_id'
    ])
  ], { readOnlyHint: true }),
  actionTool(
    'chrome_page',
    'Perform semantic operations on an explicit Chrome tab/frame/document, with separately gated sensitive-field actions.',
    [
      object('snapshot', pageTarget, tabRequired),
      object('snapshot_sensitive', pageTarget, stablePageRequired),
      object('click', { ...pageTarget, ref: { type: 'string', minLength: 1 } }, [...stablePageRequired, 'ref']),
      object('type', {
        ...pageTarget,
        ref: { type: 'string', minLength: 1 },
        text: { type: 'string' },
        clear: { type: 'boolean' }
      }, [...stablePageRequired, 'ref', 'text']),
      object('type_sensitive', {
        ...pageTarget,
        ref: { type: 'string', minLength: 1 },
        text: { type: 'string' },
        clear: { type: 'boolean' }
      }, [...stablePageRequired, 'ref', 'text']),
      object('select', { ...pageTarget, ref: { type: 'string', minLength: 1 }, value: { type: 'string' } }, [
        ...stablePageRequired,
        'ref',
        'value'
      ]),
      object('press_key', { ...pageTarget, ref: { type: 'string' }, key: { type: 'string', minLength: 1 } }, [
        ...stablePageRequired,
        'key'
      ]),
      object('scroll', { ...pageTarget, ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, [
        ...stablePageRequired,
        'x',
        'y'
      ]),
      object('wait', {
        ...pageTarget,
        ref: { type: 'string' },
        state: { enum: ['exists', 'not_exists', 'visible', 'hidden'] },
        url_pattern: { type: 'string' },
        timeout_ms: { type: 'integer', minimum: 0, maximum: 30000 }
      }, ['tab_id']),
      object('check_url', { ...pageTarget, url_pattern: { type: 'string', minLength: 1 } }, ['tab_id', 'url_pattern']),
      object(
        'screenshot',
        { ...pageTarget, format: { enum: ['png', 'jpeg'] }, full_page: { type: 'boolean' } },
        tabRequired
      ),
      object('save_mhtml', { ...pageTarget, filename: { type: 'string' } }, tabRequired),
      object('print', pageTarget, tabRequired),
      object('print_to_pdf', {
        ...pageTarget,
        filename: { type: 'string' },
        landscape: { type: 'boolean' },
        print_background: { type: 'boolean' }
      }, tabRequired)
    ]
  ),
  actionTool(
    'chrome_debug',
    'Use bounded debugger operations; arbitrary CDP commands and response bodies are not available.',
    [
      object('attach', tabId, tabRequired),
      object('detach', tabId, tabRequired),
      object('status', tabId, tabRequired),
      object('events', {
        ...tabId,
        kinds: { type: 'array', items: { enum: ['console', 'exception', 'network'] } },
        cursor: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      }, tabRequired),
      object('dom_snapshot', tabId, tabRequired),
      object('performance', tabId, tabRequired),
      object('screenshot', { ...tabId, format: { enum: ['png', 'jpeg'] } }, tabRequired),
      object(
        'print_to_pdf',
        { ...tabId, landscape: { type: 'boolean' }, print_background: { type: 'boolean' } },
        tabRequired
      )
    ]
  ),
  actionTool(
    'chrome_cookies',
    'List cookie metadata, optionally return values when the session switch is enabled, or make an exact-site cookie change.',
    [
      object('list_metadata', {
        url: { type: 'string' },
        domain: { type: 'string' },
        name: { type: 'string' },
        store_id: { type: 'string' }
      }),
      object('list_with_values', {
        url: { type: 'string' },
        name: { type: 'string' },
        store_id: { type: 'string' },
        ...maxResults
      }, ['url']),
      object('set', {
        url: { type: 'string' },
        name: { type: 'string' },
        value: { type: 'string' },
        domain: { type: 'string' },
        path: { type: 'string' },
        secure: { type: 'boolean' },
        http_only: { type: 'boolean' },
        same_site: { enum: ['no_restriction', 'lax', 'strict', 'unspecified'] },
        expiration_date: { type: 'number' }
      }, ['url', 'name', 'value']),
      object('remove', { url: { type: 'string' }, name: { type: 'string' }, store_id: { type: 'string' } }, [
        'url',
        'name'
      ])
    ]
  ),
  actionTool('chrome_site_settings', 'Read or make an exact-pattern Chrome content setting change.', [
    object('get', {
      setting: { type: 'string' },
      primary_url: { type: 'string' },
      secondary_url: { type: 'string' },
      incognito: { type: 'boolean' }
    }, ['setting', 'primary_url']),
    object('set', {
      setting: { type: 'string' },
      primary_pattern: { type: 'string' },
      secondary_pattern: { type: 'string' },
      value: { type: 'string' },
      scope: { enum: ['regular', 'incognito_session_only'] }
    }, ['setting', 'primary_pattern', 'value']),
    object('clear_owned', { setting: { type: 'string' }, scope: { enum: ['regular', 'incognito_session_only'] } }, [
      'setting'
    ])
  ]),
  actionTool('chrome_browsing_data', 'Preview or remove explicitly scoped Chrome browsing data.', [
    object('preview_removal', {
      since: { type: 'string', format: 'date-time' },
      origins: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
      types: originScopedBrowsingDataTypes
    }, ['origins', 'types']),
    object('remove', {
      since: { type: 'string', format: 'date-time' },
      origins: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
      types: originScopedBrowsingDataTypes,
      protected_web: { type: 'boolean' },
      extension_origins: { type: 'boolean' }
    }, ['origins', 'types'])
  ]),
  actionTool('chrome_proxy', 'Read or user-confirm an explicit typed Chrome proxy configuration.', [
    object('get', { incognito: { type: 'boolean' } }),
    object('set', {
      mode: { enum: ['direct', 'auto_detect', 'system', 'fixed_servers', 'pac_script_url'] },
      scope: { enum: ['regular', 'incognito_persistent', 'incognito_session_only'] },
      host: { type: 'string' },
      port: { type: 'integer', minimum: 1, maximum: 65535 },
      scheme: { enum: ['http', 'https', 'socks4', 'socks5'] },
      bypass_list: { type: 'array', maxItems: 100, items: { type: 'string' } },
      pac_url: { type: 'string' }
    }, ['mode']),
    object('clear', { scope: { enum: ['regular', 'incognito_persistent', 'incognito_session_only'] } })
  ]),
  actionTool('chrome_privacy', 'Read or user-confirm a named Chrome privacy setting.', [
    object('get', { setting: { type: 'string', minLength: 1 }, incognito: { type: 'boolean' } }, ['setting']),
    object('set', {
      setting: { type: 'string', minLength: 1 },
      value: {},
      scope: { enum: ['regular', 'incognito_persistent', 'incognito_session_only'] }
    }, ['setting', 'value']),
    object('clear', {
      setting: { type: 'string', minLength: 1 },
      scope: { enum: ['regular', 'incognito_persistent', 'incognito_session_only'] }
    }, ['setting'])
  ]),
  actionTool(
    'chrome_raw',
    'Run broad CDP commands or Runtime.evaluate only when browser-session-wide Raw access is enabled. tab_id and expected_origin are pre-dispatch navigation guards, not a security boundary; host file-system primitives remain blocked.',
    [
      object('evaluate', {
        ...tabId,
        ...expectedOrigin,
        expression: { type: 'string', minLength: 1 },
        await_promise: { type: 'boolean' },
        return_by_value: { type: 'boolean' },
        user_gesture: { type: 'boolean' },
        execution_context_id: { type: 'integer', minimum: 0 }
      }, ['tab_id', 'expected_origin', 'expression']),
      object('cdp_command', {
        ...tabId,
        ...expectedOrigin,
        method: { type: 'string', minLength: 1 },
        params: { type: 'object', additionalProperties: true }
      }, ['tab_id', 'expected_origin', 'method'])
    ]
  ),
  actionTool('chrome_audit', 'Read redacted bridge audit entries or pending confirmation summaries.', [
    object('recent', maxResults),
    object('pending_confirmations')
  ], { readOnlyHint: true }),
  {
    name: 'execute_chrome_workflow',
    description:
      'Run a deterministic, explicit-target Chrome workflow. Long workflows may return immediately with a run id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id', 'steps'],
      properties: workflowProperties
    }
  },
  {
    name: 'execute_chrome_workflows',
    description: 'Run independent Chrome workflows concurrently while preserving serialization for shared targets.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workflows'],
      properties: {
        workflows: {
          type: 'array',
          minItems: 1,
          maxItems: 16,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['tab_id', 'steps'],
            properties: workflowProperties
          }
        }
      }
    }
  },
  {
    name: 'get_chrome_workflow_steps',
    description: 'Get current Chrome workflow status and selected progressive step results.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['run_id'],
      properties: {
        run_id: { type: 'string', minLength: 1 },
        step_ids: { type: 'array', maxItems: 100, items: { type: 'string' } }
      }
    }
  },
  {
    name: 'resume_chrome_workflow',
    description: 'Resume a paused Chrome workflow from its checkpoint.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['run_id'],
      properties: { run_id: { type: 'string', minLength: 1 }, action: { enum: ['continue', 'skip', 'cancel'] } }
    }
  }
]

const operationFromTool = name =>
  ({
    chrome_windows: 'windows',
    chrome_tabs: 'tabs',
    chrome_tab_groups: 'groups',
    chrome_sessions: 'sessions',
    chrome_history: 'history',
    chrome_bookmarks: 'bookmarks',
    chrome_downloads: 'downloads',
    chrome_reading_list: 'readingList',
    chrome_extensions: 'management',
    chrome_devices: 'devices',
    chrome_frames: 'frames',
    chrome_page: 'page',
    chrome_debug: 'debug',
    chrome_cookies: 'cookies',
    chrome_site_settings: 'contentSettings',
    chrome_browsing_data: 'browsingData',
    chrome_proxy: 'proxy',
    chrome_privacy: 'privacy',
    chrome_raw: 'raw',
    chrome_audit: 'audit'
  })[name]

module.exports = { operationFromTool, tools }
