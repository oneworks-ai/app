const interactionTools = require('./browser-driver-interaction-tools.cjs')
const operationFromTool = require('./browser-driver-operations.cjs')
const pageTools = require('./browser-driver-page-tools.cjs')
const { workflowProperties } = require('./browser-driver-workflow-schema.cjs')

const contentResult = (structuredContent, summary) => ({
  content: [{ type: 'text', text: summary }],
  structuredContent
})

const workflowTools = [
  {
    name: 'execute_in_app_browser_workflow',
    description: 'Run deterministic in-app browser steps serially on one page.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['page_id', 'steps'],
      properties: workflowProperties
    }
  },
  {
    name: 'execute_in_app_browser_workflows',
    description: 'Run workflows concurrently across pages while preserving serial order within each page.',
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
            required: ['page_id', 'steps'],
            properties: workflowProperties
          }
        }
      }
    }
  },
  {
    name: 'get_in_app_browser_workflow_steps',
    description: 'Return stored details for selected workflow step ids.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['run_id'],
      properties: {
        run_id: { type: 'string', minLength: 1 },
        step_ids: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 100 }
      }
    }
  }
]

const tools = [...pageTools, ...interactionTools, ...workflowTools]

module.exports = { contentResult, operationFromTool, tools }
