const pageProperties = {
  page_id: {
    type: 'string',
    minLength: 1,
    description:
      'Explicit page id from in_app_browser_open, in_app_browser_list_pages, or in_app_browser_snapshot. Use in_app_browser_show_page only when the user needs that page revealed in the UI.'
  }
}

const workflowOperationNames = [
  'navigate',
  'navigate_history',
  'reload',
  'stop_loading',
  'get_navigation_state',
  'get_page_view_state',
  'set_device_mode',
  'set_devtools',
  'set_zoom',
  'snapshot',
  'click',
  'type',
  'select',
  'press_key',
  'scroll',
  'wait',
  'screenshot'
]

const workflowStepSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['node_id', 'op'],
  properties: {
    node_id: { type: 'string', minLength: 1 },
    op: { enum: workflowOperationNames },
    missing: { enum: ['stop', 'skip', 'succeed'], default: 'stop' },
    url: { type: 'string' },
    ref: { type: 'string' },
    text: { type: 'string' },
    value: { type: 'string' },
    key: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    duration_ms: { type: 'number', minimum: 0, maximum: 30000 },
    timeout_ms: { type: 'number', minimum: 0, maximum: 30000 },
    direction: { enum: ['back', 'forward'] },
    index: { type: 'integer', minimum: 0 },
    offset: { type: 'integer', minimum: -100, maximum: 100 },
    ignore_cache: { type: 'boolean' },
    enabled: { type: 'boolean' },
    preset_id: { type: 'string', minLength: 1 },
    width: { type: 'integer', minimum: 1, maximum: 4096 },
    height: { type: 'integer', minimum: 1, maximum: 4096 },
    device_pixel_ratio: { type: 'number', minimum: 1, maximum: 3 },
    device_type: { enum: ['desktop', 'mobile'] },
    zoom: { anyOf: [{ const: 'auto' }, { type: 'number', minimum: 0.25, maximum: 2 }] },
    dock_side: { enum: ['left', 'right', 'bottom'] },
    factor: { type: 'number', minimum: 0.25, maximum: 5 }
  }
}

const workflowProperties = {
  workflow_id: { type: 'string' },
  page_id: pageProperties.page_id,
  steps: { type: 'array', minItems: 1, maxItems: 100, items: workflowStepSchema }
}

module.exports = { pageProperties, workflowOperationNames, workflowProperties }
