const { pageProperties } = require('./browser-driver-workflow-schema.cjs')

module.exports = [
  {
    name: 'in_app_browser_snapshot',
    description:
      'Read a page title, URL, visible text, and interactive elements. Refs are scoped to this page and snapshot generation.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: pageProperties }
  },
  {
    name: 'in_app_browser_navigate',
    description: 'Navigate an internal browser page to an HTTP or HTTPS URL.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'url'],
      properties: {
        ...pageProperties,
        url: { type: 'string', minLength: 1 }
      }
    }
  },
  {
    name: 'in_app_browser_click',
    description: 'Click an element ref returned by in_app_browser_snapshot.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'ref'],
      properties: {
        ...pageProperties,
        ref: { type: 'string', minLength: 1 }
      }
    }
  },
  {
    name: 'in_app_browser_type',
    description: 'Replace an editable element value and dispatch input/change events.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'ref', 'text'],
      properties: {
        ...pageProperties,
        ref: { type: 'string', minLength: 1 },
        text: { type: 'string' }
      }
    }
  },
  {
    name: 'in_app_browser_select',
    description: 'Select a native HTML option by exact value or visible label.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'ref', 'value'],
      properties: {
        ...pageProperties,
        ref: { type: 'string', minLength: 1 },
        value: { type: 'string' }
      }
    }
  },
  {
    name: 'in_app_browser_press_key',
    description: 'Send a keyboard key to the focused internal browser page.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'key'],
      properties: {
        ...pageProperties,
        key: { type: 'string', minLength: 1 }
      }
    }
  },
  {
    name: 'in_app_browser_scroll',
    description: 'Scroll the internal browser viewport by a relative pixel delta.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id'],
      properties: {
        ...pageProperties,
        x: { type: 'number', default: 0 },
        y: { type: 'number', default: 0 }
      }
    }
  },
  {
    name: 'in_app_browser_wait',
    description: 'Wait a bounded duration, or wait until snapshot text/ref exists.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id'],
      properties: {
        ...pageProperties,
        duration_ms: { type: 'number', minimum: 0, maximum: 30000 },
        timeout_ms: { type: 'number', minimum: 0, maximum: 30000, default: 10000 },
        ref: { type: 'string' },
        text: { type: 'string' }
      }
    }
  },
  {
    name: 'in_app_browser_screenshot',
    description: 'Capture the current internal browser viewport and return a local PNG path.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: pageProperties }
  }
]
