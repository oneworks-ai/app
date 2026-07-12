const { randomUUID } = require('node:crypto')

const { workflowOperationNames } = require('./browser-driver-workflow-schema.cjs')

const maxStoredRuns = 20
const text = value => typeof value === 'string' ? value.trim() : ''
const isRecord = value => value != null && typeof value === 'object' && !Array.isArray(value)
const contentResult = (structuredContent, summary) => ({
  content: [{ type: 'text', text: summary }],
  structuredContent
})
const stepId = () => `step_${randomUUID().replaceAll('-', '').slice(0, 16)}`
const runId = () => `run_${randomUUID().replaceAll('-', '').slice(0, 16)}`
const isMissingError = error => (
  ['NO_BROWSER_PAGE', 'PAGE_NOT_FOUND', 'TARGET_NOT_FOUND', 'WAIT_TIMEOUT'].includes(error?.code)
)
const workflowOperations = new Set(workflowOperationNames)

function summaryForOutput(op, output) {
  if (op === 'snapshot') {
    return {
      page_id: output?.page?.id,
      title: output?.page?.title,
      url: output?.page?.url,
      element_count: output?.snapshot?.elements?.length ?? 0
    }
  }
  if (op === 'screenshot') return { path: output?.path, page_id: output?.page?.id }
  return isRecord(output)
    ? Object.fromEntries(Object.entries(output).filter(([key]) => key !== 'data_base64').slice(0, 8))
    : output
}

function validateWorkflowSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('Workflow steps are required.')
  const nodeIds = new Set()
  for (const step of steps) {
    const nodeId = text(step?.node_id)
    if (!nodeId) throw new Error('Every workflow step requires a non-empty node_id.')
    if (nodeIds.has(nodeId)) throw new Error(`Duplicate workflow node_id: ${nodeId}`)
    nodeIds.add(nodeId)
    if (!workflowOperations.has(step?.op)) {
      throw new Error(`Unsupported browser workflow operation: ${String(step?.op)}`)
    }
    if (step.op === 'navigate' && !text(step.url)) throw new Error(`${nodeId} requires url.`)
    if ((step.op === 'click' || step.op === 'type' || step.op === 'select') && !text(step.ref)) {
      throw new Error(`${nodeId} requires ref.`)
    }
    if (step.op === 'select' && !text(step.value)) throw new Error(`${nodeId} requires value.`)
    if (step.op === 'press_key' && !text(step.key)) throw new Error(`${nodeId} requires key.`)
    if (step.op === 'navigate_history') {
      const targets = [step.index, step.offset, step.direction].filter(value => value != null)
      if (targets.length !== 1) throw new Error(`${nodeId} requires exactly one of index, offset, or direction.`)
    }
    if ((step.op === 'set_device_mode' || step.op === 'set_devtools') && typeof step.enabled !== 'boolean') {
      throw new Error(`${nodeId} requires enabled.`)
    }
    if (step.op === 'set_zoom' && !(typeof step.factor === 'number' && Number.isFinite(step.factor))) {
      throw new Error(`${nodeId} requires factor.`)
    }
  }
}

function validateWorkflow(args) {
  if (!isRecord(args) || !text(args.page_id)) throw new Error('Every browser workflow requires a page_id.')
  validateWorkflowSteps(args.steps)
}

module.exports = function createWorkflowController(callOperation) {
  const runs = new Map()
  const rememberRun = run => {
    while (runs.size >= maxStoredRuns) {
      const terminal = [...runs.values()].find(candidate => candidate.status === 'completed')
      if (terminal == null) break
      runs.delete(terminal.run_id)
    }
    runs.set(run.run_id, run)
  }

  const executeWorkflow = async args => {
    validateWorkflow(args)
    const run = {
      run_id: runId(),
      workflow_id: text(args.workflow_id) || undefined,
      page_id: text(args.page_id),
      status: 'running',
      outcome: undefined,
      started_at: new Date().toISOString(),
      completed_at: undefined,
      steps: []
    }
    rememberRun(run)
    for (const step of args.steps) {
      const record = {
        step_id: stepId(),
        node_id: text(step.node_id),
        op: step.op,
        status: 'running',
        started_at: new Date().toISOString()
      }
      run.steps.push(record)
      try {
        record.output = await callOperation(step.op, {
          ...step,
          page_id: args.page_id,
          node_id: undefined,
          missing: undefined
        })
        record.status = 'completed'
      } catch (error) {
        const missing = step.missing ?? 'stop'
        if (isMissingError(error) && (missing === 'skip' || missing === 'succeed')) {
          record.status = missing === 'skip' ? 'skipped' : 'completed'
          record.output = { condition: 'target_missing', code: error.code }
          record.completed_at = new Date().toISOString()
          if (missing === 'succeed') break
          continue
        }
        record.status = 'failed'
        record.error = { code: error.code || 'BROWSER_STEP_FAILED', message: error.message }
        run.outcome = 'failed'
      }
      record.completed_at = new Date().toISOString()
      if (record.status === 'failed') break
    }
    run.status = 'completed'
    run.outcome = run.outcome ?? 'succeeded'
    run.completed_at = new Date().toISOString()
    const ids = run.steps.map(step => step.step_id)
    const steps = {
      total: run.steps.length,
      ids,
      ...(run.steps.length <= 3
        ? {
          results: run.steps.map(step => ({
            step_id: step.step_id,
            node_id: step.node_id,
            op: step.op,
            status: step.status,
            ...(step.output == null ? {} : { output: summaryForOutput(step.op, step.output) }),
            ...(step.error == null ? {} : { error: step.error })
          }))
        }
        : {})
    }
    return contentResult({
      run_id: run.run_id,
      ...(run.workflow_id == null ? {} : { workflow_id: run.workflow_id }),
      page_id: run.page_id,
      status: run.status,
      outcome: run.outcome,
      steps
    }, `Browser workflow ${run.outcome}: ${run.run_id}; ${run.steps.length} step(s).`)
  }

  const getWorkflowSteps = args => {
    const run = runs.get(text(args.run_id))
    if (!run) {
      throw Object.assign(new Error('Browser workflow run was not found in this MCP session.'), {
        code: 'RUN_NOT_FOUND'
      })
    }
    const requested = Array.isArray(args.step_ids) ? new Set(args.step_ids.map(text).filter(Boolean)) : undefined
    const steps = run.steps.filter(step => requested == null || requested.has(step.step_id))
    return contentResult(
      { run_id: run.run_id, page_id: run.page_id, status: run.status, outcome: run.outcome, steps },
      `Returned ${steps.length} browser workflow step result(s).`
    )
  }

  return { executeWorkflow, getWorkflowSteps, validateWorkflow }
}
