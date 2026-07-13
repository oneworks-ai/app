/* eslint-disable max-lines -- Workflow lifecycle, checkpoint, and progressive result invariants stay in one reusable controller. */
const { randomUUID } = require('node:crypto')

const { workflowOperationNames: defaultWorkflowOperationNames } = require('./browser-driver-workflow-schema.cjs')

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
  ['NO_BROWSER_PAGE', 'PAGE_NOT_FOUND', 'TARGET_NOT_FOUND', 'WAIT_TIMEOUT', 'FRAME_NOT_FOUND', 'DOCUMENT_CHANGED']
    .includes(error?.code)
)

function summaryForOutput(op, output) {
  if (op === 'snapshot') {
    return {
      page_id: output?.page?.id,
      tab_id: output?.tab?.id ?? output?.tab_id,
      title: output?.page?.title ?? output?.title,
      url: output?.page?.url ?? output?.url,
      element_count: output?.snapshot?.elements?.length ?? output?.elements?.length ?? 0
    }
  }
  if (op === 'screenshot') return { path: output?.path, page_id: output?.page?.id, tab_id: output?.tab_id }
  return isRecord(output)
    ? Object.fromEntries(Object.entries(output).filter(([key]) => !['data_base64', 'value'].includes(key)).slice(0, 8))
    : output
}

function validateWorkflowSteps(steps, operationNames, validateStep) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('Workflow steps are required.')
  const nodeIds = new Set()
  for (const step of steps) {
    const nodeId = text(step?.node_id)
    if (!nodeId) throw new Error('Every workflow step requires a non-empty node_id.')
    if (nodeIds.has(nodeId)) throw new Error(`Duplicate workflow node_id: ${nodeId}`)
    nodeIds.add(nodeId)
    if (!operationNames.has(step?.op)) {
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
    validateStep?.(step)
  }
}

module.exports = function createWorkflowController(callOperation, options = {}) {
  const runs = new Map()
  const operationNames = new Set(options.operationNames ?? defaultWorkflowOperationNames)

  const validateWorkflow = args => {
    const targetId = options.targetId?.(args) ?? args?.page_id
    if (!isRecord(args) || !text(String(targetId ?? ''))) {
      throw new Error(options.targetRequiredMessage ?? 'Every browser workflow requires a page_id.')
    }
    validateWorkflowSteps(args.steps, operationNames, options.validateStep)
    options.validateWorkflow?.(args)
  }

  const rememberRun = run => {
    while (runs.size >= (options.maxStoredRuns ?? maxStoredRuns)) {
      const terminal = [...runs.values()].find(candidate => candidate.status === 'completed')
      if (terminal == null) break
      runs.delete(terminal.run_id)
    }
    runs.set(run.run_id, run)
  }

  const createRun = args => {
    const targetId = text(String(options.targetId?.(args) ?? args.page_id))
    const run = {
      run_id: runId(),
      workflow_id: text(args.workflow_id) || undefined,
      page_id: targetId,
      status: 'running',
      outcome: undefined,
      started_at: new Date().toISOString(),
      completed_at: undefined,
      next_step_index: 0,
      input: args,
      steps: []
    }
    rememberRun(run)
    return run
  }

  const finishRun = (run, outcome) => {
    run.status = 'completed'
    run.outcome = outcome
    run.completed_at = new Date().toISOString()
  }

  const runSteps = async (run, startIndex = run.next_step_index) => {
    const args = run.input
    const deadline = Date.now() + Math.min(300000, Math.max(1, Number(args.max_duration_ms) || 300000))
    run.status = 'running'
    run.outcome = undefined
    for (let index = startIndex; index < args.steps.length; index += 1) {
      if (Date.now() > deadline) {
        finishRun(run, 'failed')
        run.error = { code: 'WORKFLOW_TIMEOUT', message: 'Browser workflow exceeded max_duration_ms.' }
        break
      }
      const step = args.steps[index]
      const record = {
        step_id: stepId(),
        node_id: text(step.node_id),
        op: step.op,
        status: 'running',
        started_at: new Date().toISOString()
      }
      run.steps.push(record)
      try {
        if (step.condition != null && options.evaluateCondition != null) {
          const matched = await options.evaluateCondition(step.condition, args, step)
          if (!matched) {
            const behavior = step.condition.if_false ?? 'stop'
            record.status = behavior === 'skip' ? 'skipped' : 'completed'
            record.output = { condition: 'false', behavior }
            record.completed_at = new Date().toISOString()
            run.next_step_index = index + 1
            if (behavior === 'succeed') {
              finishRun(run, 'succeeded')
              break
            }
            if (behavior === 'stop') {
              finishRun(run, 'failed')
              run.error = { code: 'CONDITION_NOT_MET', message: `Condition failed at ${record.node_id}.` }
              break
            }
            continue
          }
        }
        if (step.op === 'checkpoint') {
          record.status = 'completed'
          record.output = { checkpoint: step.checkpoint ?? 'continue' }
          record.completed_at = new Date().toISOString()
          run.next_step_index = index + 1
          if (step.checkpoint === 'pause' || step.checkpoint === 'confirm') {
            run.status = 'paused'
            run.outcome = 'paused'
            run.checkpoint = { consumed: true, node_id: record.node_id, step_id: record.step_id, type: step.checkpoint }
            break
          }
          continue
        }
        record.output = await callOperation(step.op, {
          ...step,
          ...(options.operationArgs?.(args, step) ?? { page_id: args.page_id }),
          node_id: undefined,
          missing: undefined,
          timeout: undefined,
          condition: undefined,
          checkpoint: undefined
        })
        record.status = 'completed'
      } catch (error) {
        const missing = step.missing ?? 'stop'
        const timeout = step.timeout ?? 'stop'
        const behavior = error?.code === 'TIMEOUT' || error?.code === 'WAIT_TIMEOUT' ? timeout : missing
        if (isMissingError(error) || error?.code === 'TIMEOUT') {
          if (behavior === 'skip' || behavior === 'succeed') {
            record.status = behavior === 'skip' ? 'skipped' : 'completed'
            record.output = { condition: 'target_missing_or_timeout', code: error.code }
            record.completed_at = new Date().toISOString()
            run.next_step_index = index + 1
            if (behavior === 'succeed') {
              finishRun(run, 'succeeded')
              break
            }
            continue
          }
        }
        record.status = 'failed'
        record.error = { code: error.code || 'BROWSER_STEP_FAILED', message: error.message }
        if (error.code === 'CONFIRMATION_REQUIRED') {
          run.status = 'paused'
          run.outcome = 'paused'
          run.completed_at = undefined
          run.checkpoint = { consumed: false, node_id: record.node_id, step_id: record.step_id, type: 'confirm' }
          run.next_step_index = index
        } else {
          finishRun(run, 'failed')
        }
      }
      record.completed_at = new Date().toISOString()
      if (run.status !== 'paused') run.next_step_index = index + 1
      if (record.status === 'failed') break
    }
    if (run.status === 'running') finishRun(run, run.outcome ?? 'succeeded')
    return run
  }

  const projectRun = run => {
    const ids = run.steps.map(step => step.step_id)
    return {
      run_id: run.run_id,
      ...(run.workflow_id == null ? {} : { workflow_id: run.workflow_id }),
      page_id: run.page_id,
      status: run.status,
      outcome: run.outcome,
      ...(run.checkpoint == null ? {} : { checkpoint: run.checkpoint }),
      steps: {
        total: run.steps.length,
        ids,
        ...(run.steps.length <= (options.inlineStepLimit ?? 3)
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
    }
  }

  const executeWorkflow = async args => {
    validateWorkflow(args)
    const run = createRun(args)
    const runQueued = () =>
      options.enqueueTarget == null
        ? runSteps(run)
        : options.enqueueTarget(run.page_id, () => runSteps(run))
    if (args.background === true) {
      void runQueued().catch(error => {
        finishRun(run, 'failed')
        run.error = { code: error.code || 'BROWSER_WORKFLOW_FAILED', message: error.message }
      })
      return contentResult(projectRun(run), `Browser workflow started: ${run.run_id}.`)
    }
    await runQueued()
    return contentResult(
      projectRun(run),
      `Browser workflow ${run.outcome}: ${run.run_id}; ${run.steps.length} step(s).`
    )
  }

  const resumeWorkflow = async args => {
    const run = runs.get(text(args.run_id))
    if (run == null) {
      throw Object.assign(new Error('Browser workflow run was not found in this MCP session.'), {
        code: 'RUN_NOT_FOUND'
      })
    }
    if (run.status !== 'paused') {
      throw Object.assign(new Error('Browser workflow is not paused.'), { code: 'RUN_NOT_PAUSED' })
    }
    if (args.action === 'cancel') {
      finishRun(run, 'cancelled')
      return contentResult(projectRun(run), `Browser workflow cancelled: ${run.run_id}.`)
    }
    if (args.action === 'skip' && run.checkpoint?.consumed === false) run.next_step_index += 1
    run.checkpoint = undefined
    const runQueued = () =>
      options.enqueueTarget == null
        ? runSteps(run)
        : options.enqueueTarget(run.page_id, () => runSteps(run))
    if (run.input.background === true) {
      void runQueued().catch(error => {
        finishRun(run, 'failed')
        run.error = { code: error.code || 'BROWSER_WORKFLOW_FAILED', message: error.message }
      })
      return contentResult(projectRun(run), `Browser workflow resumed: ${run.run_id}.`)
    }
    await runQueued()
    return contentResult(projectRun(run), `Browser workflow ${run.outcome}: ${run.run_id}.`)
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
    return contentResult({
      run_id: run.run_id,
      page_id: run.page_id,
      status: run.status,
      outcome: run.outcome,
      ...(run.checkpoint == null ? {} : { checkpoint: run.checkpoint }),
      steps
    }, `Returned ${steps.length} browser workflow step result(s).`)
  }

  return { executeWorkflow, getWorkflowSteps, resumeWorkflow, validateWorkflow }
}
