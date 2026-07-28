const targetProperties = {
  tab_id: { type: 'integer', minimum: 0, description: 'Explicit Chrome tab id from chrome_tabs.' },
  frame_id: { type: 'integer', minimum: 0 },
  document_id: { type: 'string', minLength: 1 }
}

const workflowOperationNames = [
  'navigate',
  'back',
  'forward',
  'reload',
  'snapshot',
  'click',
  'type',
  'select',
  'press_key',
  'scroll',
  'wait',
  'screenshot',
  'checkpoint'
]

const workflowStepSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['node_id', 'op'],
  properties: {
    node_id: { type: 'string', minLength: 1 },
    op: { enum: workflowOperationNames },
    missing: { enum: ['stop', 'skip', 'succeed'], default: 'stop' },
    timeout: { enum: ['stop', 'skip', 'succeed'], default: 'stop' },
    url: { type: 'string' },
    ref: { type: 'string' },
    text: { type: 'string' },
    value: { type: 'string' },
    key: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    duration_ms: { type: 'number', minimum: 0, maximum: 30000 },
    timeout_ms: { type: 'number', minimum: 0, maximum: 30000 },
    condition: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { enum: ['exists', 'not_exists', 'url_matches'] },
        ref: { type: 'string' },
        pattern: { type: 'string' },
        if_false: { enum: ['stop', 'skip', 'succeed'] }
      }
    },
    checkpoint: { enum: ['continue', 'pause', 'confirm'] }
  }
}

const workflowProperties = {
  workflow_id: { type: 'string' },
  ...targetProperties,
  background: { type: 'boolean', description: 'Return a run id immediately and query progress later.' },
  max_duration_ms: { type: 'integer', minimum: 1, maximum: 300000 },
  steps: { type: 'array', minItems: 1, maxItems: 100, items: workflowStepSchema }
}

module.exports = { targetProperties, workflowOperationNames, workflowProperties, workflowStepSchema }
