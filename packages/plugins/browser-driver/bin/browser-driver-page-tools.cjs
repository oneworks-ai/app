const { pageProperties } = require('./browser-driver-workflow-schema.cjs')

module.exports = [
  {
    name: 'in_app_browser_list_pages',
    description: 'List controllable OneWorks internal browser pages for the current Agent session.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'in_app_browser_open',
    description: 'Open or reuse an HTTP/HTTPS page in this OneWorks session internal browser panel.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', minLength: 1 },
        title: { type: 'string' },
        placement: {
          enum: ['right', 'bottom'],
          default: 'right',
          description: 'Where to open the internal browser panel. Defaults to the right side.'
        },
        timeout_ms: { type: 'number', minimum: 0, maximum: 30000, default: 10000 },
        open_mode: {
          enum: ['reuse-or-create', 'new-tab'],
          default: 'reuse-or-create',
          description: 'Reuse a matching URL by default, or always create a new internal tab.'
        }
      }
    }
  },
  {
    name: 'in_app_browser_show_page',
    description: 'Reveal an existing internal browser page and make its panel tab active without navigating it.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: pageProperties }
  },
  {
    name: 'in_app_browser_close_page',
    description: 'Close an internal browser tab.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: pageProperties }
  },
  {
    name: 'in_app_browser_duplicate_page',
    description: 'Duplicate an internal browser tab, optionally into another panel area.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id'],
      properties: { ...pageProperties, placement: { enum: ['right', 'bottom'] } }
    }
  },
  {
    name: 'in_app_browser_move_page',
    description: 'Move an internal browser tab between the right and bottom panel areas.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'placement'],
      properties: { ...pageProperties, placement: { enum: ['right', 'bottom'] } }
    }
  },
  {
    name: 'in_app_browser_reload',
    description: 'Reload an internal browser page, optionally bypassing cache.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id'],
      properties: { ...pageProperties, ignore_cache: { type: 'boolean', default: false } }
    }
  },
  {
    name: 'in_app_browser_stop_loading',
    description: 'Stop the current internal browser page navigation.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: pageProperties }
  },
  {
    name: 'in_app_browser_navigate_history',
    description: 'Navigate to exactly one relative, absolute, backward, or forward entry in this tab history.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id'],
      oneOf: [{ required: ['offset'] }, { required: ['index'] }, { required: ['direction'] }],
      properties: {
        ...pageProperties,
        direction: { enum: ['back', 'forward'] },
        index: { type: 'integer', minimum: 0 },
        offset: { type: 'integer', minimum: -100, maximum: 100 }
      }
    }
  },
  {
    name: 'in_app_browser_get_navigation_state',
    description: 'Return compact loading and navigation state for one internal browser tab.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: pageProperties }
  },
  {
    name: 'in_app_browser_get_navigation_entries',
    description: 'Return a paginated slice of the current tab navigation history.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id'],
      properties: {
        ...pageProperties,
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
      }
    }
  },
  {
    name: 'in_app_browser_clear_navigation_history',
    description: 'Clear back/forward history while keeping the current page.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: pageProperties }
  },
  {
    name: 'in_app_browser_get_page_view_state',
    description: 'Return compact panel, device-mode, DevTools, URL, and zoom state.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: pageProperties }
  },
  {
    name: 'in_app_browser_list_device_presets',
    description: 'List the device viewport presets supported by this internal browser page.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: pageProperties }
  },
  {
    name: 'in_app_browser_set_device_mode',
    description: 'Enable or disable the device toolbar and configure its viewport.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'enabled'],
      properties: {
        ...pageProperties,
        enabled: { type: 'boolean' },
        preset_id: { type: 'string', minLength: 1 },
        width: { type: 'integer', minimum: 1, maximum: 4096 },
        height: { type: 'integer', minimum: 1, maximum: 4096 },
        device_pixel_ratio: { type: 'number', minimum: 1, maximum: 3 },
        device_type: { enum: ['mobile', 'desktop'] },
        zoom: { anyOf: [{ const: 'auto' }, { type: 'number', minimum: 0.25, maximum: 2 }] }
      }
    }
  },
  {
    name: 'in_app_browser_set_embedded_devtools',
    description: 'Open or close embedded page DevTools and optionally select its dock side.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'enabled'],
      properties: {
        ...pageProperties,
        enabled: { type: 'boolean' },
        dock_side: { enum: ['left', 'right', 'bottom'] }
      }
    }
  },
  {
    name: 'in_app_browser_set_page_zoom',
    description: 'Set the native page zoom factor.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'factor'],
      properties: { ...pageProperties, factor: { type: 'number', minimum: 0.25, maximum: 5 } }
    }
  }
]
