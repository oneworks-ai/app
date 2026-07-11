/* eslint-disable max-lines -- the workflow runtime keeps its bounded in-memory run state cohesive. */
const { Buffer } = require('node:buffer')
const { randomUUID } = require('node:crypto')

const workflowToolDefinitions = [
  {
    name: 'execute_workflow',
    description: `Execute a serial native-app workflow in one tool call. Prefer this over repeated low-level click/type calls whenever two or more steps are known in advance. The runner refreshes window state before semantic actions, resolves targets by accessibility id/role/title/description/text, and stops only on completion, failure, or an explicit checkpoint. Use contexts to identify apps and windows. Use sleep for fixed delays, wait_for for state-driven waiting, assert for postconditions, checkpoint for agent/user decisions, and on_missing/on_timeout for skip, successful exit, failure, or pause behavior. Short workflows inline step results; longer workflows return step ids for progressive lookup.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['steps'],
      properties: {
        workflow_id: { type: 'string', description: 'Optional stable workflow name for diagnostics.' },
        cursor_color: {
          type: 'string',
          pattern: '^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$',
          description: 'Optional Agent pointer color for this session, for example #625BF6. The plugin validates it and dynamically generates the SVG.'
        },
        contexts: {
          type: 'object',
          description: 'Named native-app contexts resolved lazily. Each value needs bundle_id and may include window_id or window_title.',
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            required: ['bundle_id'],
            properties: {
              bundle_id: { type: 'string' },
              urls: { type: 'array', items: { type: 'string' } },
              window_id: { type: 'integer' },
              window_title: { type: 'string' }
            }
          }
        },
        detail_mode: {
          type: 'string',
          enum: ['auto', 'inline', 'references'],
          description: 'Default auto inlines up to three small step results; longer results return step ids.'
        },
        max_duration_ms: { type: 'integer', minimum: 1000, maximum: 300000 },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['op'],
            properties: {
              node_id: { type: 'string', description: 'Stable author-defined node name.' },
              op: {
                type: 'string',
                enum: ['launch_app', 'click', 'double_click', 'right_click', 'type_text', 'press_key', 'set_value', 'scroll', 'sleep', 'wait_for', 'assert', 'checkpoint', 'exit']
              },
              context: { type: 'string' },
              target: {
                type: 'object',
                description: 'Semantic target using id/role/description/title/text, or ordered any_of alternatives for state-dependent controls.'
              },
              state: { type: 'string', enum: ['exists', 'not_exists'] },
              on_missing: { type: 'string', enum: ['fail', 'skip', 'exit_success', 'pause'] },
              on_timeout: { type: 'string', enum: ['fail', 'skip', 'exit_success', 'pause'] },
              timeout_ms: { type: 'integer', minimum: 0, maximum: 60000 },
              poll_ms: { type: 'integer', minimum: 50, maximum: 5000 },
              retries: { type: 'integer', minimum: 0, maximum: 3 }
            }
          }
        }
      }
    }
  },
  {
    name: 'resume_workflow',
    description: 'Resume a paused workflow from its checkpoint. Use continue to advance, retry to execute the paused step again, skip to advance without retrying, or cancel to end the run.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['run_id', 'decision'],
      properties: {
        run_id: { type: 'string' },
        checkpoint_id: { type: 'string' },
        decision: { type: 'string', enum: ['continue', 'retry', 'skip', 'cancel'] }
      }
    }
  },
  {
    name: 'get_workflow_step_results',
    description: 'Fetch selected step execution details by run id and step ids. Use only when the compact workflow result is insufficient. The default projection returns status, output, and error; request attempts or timing explicitly.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['run_id', 'step_ids'],
      properties: {
        run_id: { type: 'string' },
        step_ids: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
        select: {
          type: 'array',
          maxItems: 8,
          items: { type: 'string', enum: ['node_id', 'op', 'status', 'output', 'error', 'attempts', 'timing'] }
        }
      }
    }
  }
]

const workflowToolNames = new Set(workflowToolDefinitions.map(tool => tool.name))
const actionOps = new Set(['click', 'double_click', 'right_click', 'type_text', 'set_value', 'scroll'])
const supportedOps = new Set(workflowToolDefinitions[0].inputSchema.properties.steps.items.properties.op.enum)
const outcomeActions = new Set(['fail', 'skip', 'exit_success', 'pause'])
const defaultSelectedFields = ['status', 'output', 'error']
const maxStoredRuns = 50
const maxInlineBytes = 8 * 1024

class WorkflowInputError extends Error {
  constructor(message, code = 'INVALID_WORKFLOW') {
    super(message)
    this.code = code
  }
}

function compactId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function asInteger(value, fallback) {
  return Number.isInteger(value) ? value : fallback
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').trim()
}

function parseTreeElements(treeMarkdown) {
  if (typeof treeMarkdown !== 'string') return []
  const elements = []
  for (const line of treeMarkdown.split(/\r?\n/)) {
    const marker = line.match(/-\s+/)
    if (marker?.index == null) continue
    let remaining = line.slice(marker.index + marker[0].length)
    let elementIndex
    if (remaining.startsWith('[')) {
      const closingBracket = remaining.indexOf(']')
      const indexText = closingBracket < 0 ? '' : remaining.slice(1, closingBracket)
      if (!/^\d+$/.test(indexText)) continue
      elementIndex = Number.parseInt(indexText, 10)
      remaining = remaining.slice(closingBracket + 1).trimStart()
    }
    const roleEnd = remaining.search(/\s/)
    const role = roleEnd < 0 ? remaining : remaining.slice(0, roleEnd)
    if (!/^AX\w+$/.test(role)) continue
    const rest = roleEnd < 0 ? '' : remaining.slice(roleEnd)
    const description = rest.match(/^\s*\(([^)]*)\)/)?.[1]
    const title = rest.match(/^\s*"([^"]*)"/)?.[1]
    const value = rest.match(/=\s*"([^"]*)"/)?.[1]
    const idStart = rest.search(/\bid=/)
    let identifier
    if (idStart >= 0) {
      const idValue = rest.slice(idStart + 3)
      const boundaries = [' actions=', ' help=']
        .map(boundary => idValue.indexOf(boundary))
        .filter(position => position >= 0)
      const idEnd = boundaries.length === 0 ? idValue.length : Math.min(...boundaries)
      identifier = idValue.slice(0, idEnd).replace(/,$/, '').trim()
    }
    elements.push({
      description,
      id: identifier,
      index: elementIndex,
      line: line.trim(),
      role,
      title,
      value
    })
  }
  return elements
}

function elementMatches(element, target) {
  if (!isObject(target)) return false
  const mode = target.match === 'contains' ? 'contains' : 'exact'
  const compare = (actual, expected) => {
    const left = normalizeText(actual)
    const right = normalizeText(expected)
    return mode === 'contains' ? left.includes(right) : left === right
  }
  if (target.id != null && !compare(element.id, target.id)) return false
  if (target.role != null && !compare(element.role, target.role)) return false
  if (target.description != null && !compare(element.description, target.description)) return false
  if (target.title != null && !compare(element.title, target.title)) return false
  if (target.text != null) {
    const candidates = [element.value, element.title, element.description, element.id, element.line]
    if (!candidates.some(candidate => compare(candidate, target.text))) return false
  }
  return ['id', 'role', 'description', 'title', 'text'].some(key => target[key] != null)
}

function findTarget(treeMarkdown, target, options = {}) {
  const elements = parseTreeElements(treeMarkdown)
  const candidates = Array.isArray(target?.any_of) && target.any_of.length > 0 ? target.any_of : [target]
  const attemptedMatches = []
  for (const candidate of candidates) {
    const matches = elements.filter(element => elementMatches(element, candidate))
    const actionable = options.actionable === true
      ? matches.filter(element => Number.isInteger(element.index))
      : matches
    attemptedMatches.push(...actionable)
    if (actionable.length === 1) return { element: actionable[0], matches: actionable }
    if (actionable.length > 1) return { element: undefined, matches: actionable }
  }
  return { element: undefined, matches: attemptedMatches }
}

function structuredToolData(result) {
  if (result?.isError === true) {
    const message = result.content?.find(item => item?.type === 'text')?.text ?? 'Cua Driver tool call failed.'
    throw new Error(message)
  }
  if (isObject(result?.structuredContent)) return result.structuredContent
  if (isObject(result) && result.content == null) return result
  return {}
}

function chooseWindow(windows, context, appName) {
  if (!Array.isArray(windows)) return undefined
  if (Number.isInteger(context.window_id)) {
    return windows.find(window => window?.window_id === context.window_id)
  }
  if (typeof context.window_title === 'string') {
    return windows.find(window => normalizeText(window?.title) === normalizeText(context.window_title))
  }
  const appWindow = windows.find(window => normalizeText(window?.title) === normalizeText(appName))
  if (appWindow != null) return appWindow
  const byVisibleArea = (left, right) => {
    const leftArea = Number(left?.bounds?.width ?? 0) * Number(left?.bounds?.height ?? 0)
    const rightArea = Number(right?.bounds?.width ?? 0) * Number(right?.bounds?.height ?? 0)
    return rightArea - leftArea
  }
  return windows.filter(window => window?.is_on_screen === true && window?.on_current_space === true && normalizeText(window?.title) !== '').sort(byVisibleArea)[0]
    ?? windows.filter(window => window?.is_on_screen === true && normalizeText(window?.title) !== '').sort(byVisibleArea)[0]
    ?? windows.find(window => Number.isInteger(window?.window_id))
}

function validateWorkflowInput(input) {
  if (!isObject(input)) throw new WorkflowInputError('execute_workflow requires an object input.')
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new WorkflowInputError('execute_workflow requires at least one step.')
  }
  if (input.steps.length > 100) throw new WorkflowInputError('A workflow may contain at most 100 steps.')
  for (const [index, step] of input.steps.entries()) {
    if (!isObject(step) || typeof step.op !== 'string' || !supportedOps.has(step.op)) {
      throw new WorkflowInputError(`Step ${index + 1} has an unsupported op.`)
    }
    for (const key of ['on_missing', 'on_timeout']) {
      if (step[key] != null && !outcomeActions.has(step[key])) {
        throw new WorkflowInputError(`Step ${index + 1} has an unsupported ${key} value.`)
      }
    }
  }
}

function mcpToolResult(value, summary) {
  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: value
  }
}

function mcpToolError(code, message, data) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: {
      code,
      ...(data == null ? {} : data)
    }
  }
}

function publicElement(element) {
  if (element == null) return undefined
  return {
    ...(element.description == null ? {} : { description: element.description }),
    ...(element.id == null ? {} : { id: element.id }),
    ...(element.index == null ? {} : { element_index: element.index }),
    role: element.role,
    ...(element.title == null ? {} : { title: element.title }),
    ...(element.value == null ? {} : { value: normalizeText(element.value) })
  }
}

function publicStepResult(step, select) {
  const selected = new Set(select ?? defaultSelectedFields)
  const result = { step_id: step.step_id }
  if (selected.has('node_id') && step.node_id != null) result.node_id = step.node_id
  if (selected.has('op')) result.op = step.op
  if (selected.has('status')) result.status = step.status
  if (selected.has('output') && step.output != null) result.output = step.output
  if (selected.has('error') && step.error != null) result.error = step.error
  if (selected.has('attempts')) result.attempts = step.attempts
  if (selected.has('timing')) {
    result.timing = {
      duration_ms: step.duration_ms,
      started_at: step.started_at
    }
  }
  return result
}

function createWorkflowService(options) {
  if (typeof options?.callTool !== 'function') throw new TypeError('createWorkflowService requires callTool.')
  const callTool = options.callTool
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? (duration => new Promise(resolve => setTimeout(resolve, duration)))
  const createId = options.createId ?? compactId
  const runs = new Map()
  let captureModeReady = false

  async function ensureAxCaptureMode() {
    if (captureModeReady) return
    const config = structuredToolData(await callTool('get_config', {}))
    const captureMode = config.capture_mode ?? config.config?.capture_mode
    if (captureMode !== 'ax') {
      structuredToolData(await callTool('set_config', {
        key: 'capture_mode',
        value: 'ax'
      }))
    }
    captureModeReady = true
  }

  function storeRun(run) {
    runs.set(run.run_id, run)
    while (runs.size > maxStoredRuns) runs.delete(runs.keys().next().value)
  }

  function checkDeadline(run) {
    if (now() <= run.deadline_at) return
    const error = new Error('Workflow exceeded its maximum duration.')
    error.code = 'WORKFLOW_TIMEOUT'
    throw error
  }

  async function ensureContext(run, contextName) {
    if (typeof contextName !== 'string' || contextName === '') {
      throw new WorkflowInputError('Native-app steps require a named context.', 'CONTEXT_REQUIRED')
    }
    const current = run.contexts[contextName]
    if (current == null) throw new WorkflowInputError(`Unknown workflow context: ${contextName}`, 'CONTEXT_NOT_FOUND')
    if (Number.isInteger(current.pid) && Number.isInteger(current.window_id)) return current

    const data = structuredToolData(await callTool('launch_app', {
      bundle_id: current.bundle_id,
      ...(Array.isArray(current.urls) ? { urls: current.urls } : {})
    }))
    const window = chooseWindow(data.windows, current, data.name)
    if (!Number.isInteger(data.pid) || !Number.isInteger(window?.window_id)) {
      throw new WorkflowInputError(`No usable window was found for context ${contextName}.`, 'WINDOW_NOT_FOUND')
    }
    Object.assign(current, {
      pid: data.pid,
      window_id: window.window_id,
      resolved_window_title: window.title ?? ''
    })
    return current
  }

  async function observe(run, contextName) {
    checkDeadline(run)
    const context = await ensureContext(run, contextName)
    const data = structuredToolData(await callTool('get_window_state', {
      pid: context.pid,
      window_id: context.window_id
    }))
    return { context, data }
  }

  function missingDecision(step, kind, message) {
    const action = step[kind] ?? 'fail'
    if (action === 'skip') return { control: 'continue', output: { skipped: true, reason: message } }
    if (action === 'exit_success') return { control: 'exit', outcome: 'skipped', output: { reason: message } }
    if (action === 'pause') return {
      control: 'pause',
      checkpoint: {
        kind: 'agent_decision',
        prompt: message,
        choices: ['continue', 'retry', 'cancel']
      },
      output: { reason: message }
    }
    const error = new Error(message)
    error.code = kind === 'on_timeout' ? 'WAIT_TIMEOUT' : 'TARGET_NOT_FOUND'
    throw error
  }

  async function resolveActionTarget(run, step) {
    const observation = await observe(run, step.context)
    const found = findTarget(observation.data.tree_markdown, step.target, { actionable: true })
    if (found.element != null) return { ...observation, element: found.element }
    const reason = found.matches.length > 1
      ? `Target is ambiguous for step ${step.node_id ?? step.op}.`
      : `Target was not found for step ${step.node_id ?? step.op}.`
    return { decision: missingDecision(step, 'on_missing', reason) }
  }

  async function evaluateCondition(run, step) {
    const observation = await observe(run, step.context)
    const found = findTarget(observation.data.tree_markdown, step.target)
    const state = step.state ?? 'exists'
    const matched = state === 'not_exists' ? found.matches.length === 0 : found.matches.length > 0
    return {
      matched,
      output: {
        matched,
        state,
        ...(found.element == null ? {} : { target: publicElement(found.element) })
      }
    }
  }

  async function waitForCondition(run, step) {
    const timeoutMs = asInteger(step.timeout_ms, 5000)
    const pollMs = Math.max(50, asInteger(step.poll_ms, 250))
    const deadline = now() + timeoutMs
    do {
      const result = await evaluateCondition(run, step)
      if (result.matched) return result.output
      if (now() >= deadline) break
      await sleep(Math.min(pollMs, Math.max(0, deadline - now())))
      checkDeadline(run)
    } while (true)
    return missingDecision(step, 'on_timeout', `Condition timed out for step ${step.node_id ?? step.op}.`)
  }

  async function executeAction(run, step) {
    const resolved = await resolveActionTarget(run, step)
    if (resolved.decision != null) return resolved.decision
    const { context, element } = resolved
    const base = {
      pid: context.pid,
      window_id: context.window_id,
      element_index: element.index
    }
    const args = step.op === 'type_text'
      ? { ...base, text: String(step.text ?? ''), ...(step.delay_ms == null ? {} : { delay_ms: step.delay_ms }) }
      : step.op === 'set_value'
        ? { ...base, value: String(step.value ?? '') }
        : step.op === 'scroll'
          ? {
              ...base,
              direction: step.direction,
              ...(step.amount == null ? {} : { amount: step.amount }),
              ...(step.by == null ? {} : { by: step.by })
            }
          : base
    structuredToolData(await callTool(step.op, args))
    let verified
    if (isObject(step.postcondition)) {
      const postcondition = {
        ...step.postcondition,
        context: step.postcondition.context ?? step.context,
        node_id: step.node_id,
        op: 'wait_for'
      }
      const result = await waitForCondition(run, postcondition)
      if (result?.control != null) return result
      verified = result
    }
    return {
      output: {
        target: publicElement(element),
        ...(verified == null ? {} : { verified })
      }
    }
  }

  async function executeStep(run, step) {
    checkDeadline(run)
    if (step.op === 'sleep') {
      const duration = Math.min(30000, Math.max(0, asInteger(step.duration_ms, 0)))
      await sleep(duration)
      return { output: { duration_ms: duration } }
    }
    if (step.op === 'launch_app') {
      const contextName = step.save_as ?? step.context ?? step.node_id ?? 'default'
      run.contexts[contextName] = {
        bundle_id: step.bundle_id,
        urls: step.urls,
        window_id: step.window_id,
        window_title: step.window_title
      }
      const context = await ensureContext(run, contextName)
      return { output: { context: contextName, pid: context.pid, window_id: context.window_id } }
    }
    if (actionOps.has(step.op)) return executeAction(run, step)
    if (step.op === 'press_key') {
      const context = await ensureContext(run, step.context)
      structuredToolData(await callTool('press_key', { pid: context.pid, key: step.key }))
      return { output: { key: step.key } }
    }
    if (step.op === 'wait_for') return waitForCondition(run, step)
    if (step.op === 'assert') {
      const result = await evaluateCondition(run, step)
      if (!result.matched) {
        const error = new Error(`Assertion failed for step ${step.node_id ?? step.op}.`)
        error.code = 'ASSERTION_FAILED'
        throw error
      }
      return { output: result.output }
    }
    if (step.op === 'checkpoint') {
      return {
        control: 'pause',
        checkpoint: {
          kind: step.kind === 'user_confirmation' ? 'user_confirmation' : 'agent_decision',
          prompt: String(step.prompt ?? 'Continue the workflow?'),
          choices: Array.isArray(step.choices) && step.choices.length > 0 ? step.choices : ['continue', 'cancel']
        }
      }
    }
    if (step.op === 'exit') {
      return {
        control: 'exit',
        outcome: step.outcome === 'skipped' ? 'skipped' : 'succeeded',
        output: { reason: String(step.reason ?? 'Workflow exited.') }
      }
    }
    throw new WorkflowInputError(`Unsupported workflow op: ${step.op}`)
  }

  async function executeStepWithRetries(run, step, existingResult) {
    const retries = asInteger(step.retries, 0)
    const result = existingResult ?? {
      step_id: createId('step'),
      node_id: step.node_id,
      op: step.op,
      status: 'running',
      attempts: 0,
      started_at: new Date(now()).toISOString()
    }
    const startedAt = now()
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      result.attempts += 1
      try {
        const execution = await executeStep(run, step)
        result.status = execution?.control === 'pause' ? 'paused' : 'completed'
        result.output = execution?.output
        result.error = undefined
        result.duration_ms = now() - startedAt
        return { execution, result }
      } catch (error) {
        result.error = {
          code: error.code ?? 'STEP_FAILED',
          message: error.message
        }
        if (attempt >= retries) {
          result.status = 'failed'
          result.duration_ms = now() - startedAt
          return { error, result }
        }
      }
    }
  }

  function finalizeResult(run) {
    const executed = run.step_order.map(id => run.step_results.get(id)).filter(Boolean)
    const lastStep = executed.at(-1)
    const base = {
      run_id: run.run_id,
      status: run.status,
      ...(run.outcome == null ? {} : { outcome: run.outcome }),
      ...(lastStep?.output == null ? {} : { output: lastStep.output })
    }
    if (run.status === 'paused') {
      return {
        ...base,
        checkpoint_id: run.checkpoint.checkpoint_id,
        kind: run.checkpoint.kind,
        prompt: run.checkpoint.prompt,
        choices: run.checkpoint.choices,
        step: publicStepResult(lastStep, ['node_id', 'op', 'status', 'output', 'error'])
      }
    }
    if (run.status === 'failed') {
      return {
        ...base,
        code: lastStep?.error?.code ?? 'WORKFLOW_FAILED',
        step_id: lastStep?.step_id,
        retryable: false,
        step: publicStepResult(lastStep, ['node_id', 'op', 'status', 'output', 'error', 'attempts'])
      }
    }
    if (run.exit != null) base.exit = run.exit

    const inlineSteps = executed.map(step => publicStepResult(step, ['node_id', 'op', 'status', 'output', 'error']))
    const canInline = run.detail_mode === 'inline'
      || (run.detail_mode === 'auto' && inlineSteps.length <= 3 && Buffer.byteLength(JSON.stringify(inlineSteps)) <= maxInlineBytes)
    if (canInline && run.detail_mode !== 'references') base.steps = inlineSteps
    else {
      base.steps = {
        ids: executed.slice(0, 50).map(step => step.step_id),
        total: executed.length,
        ...(executed.length > 50 ? { next_cursor: '50' } : {})
      }
    }
    return base
  }

  async function continueRun(run, retryPausedStep = false) {
    run.status = 'running'
    run.checkpoint = undefined
    while (run.current_index < run.steps.length) {
      const step = run.steps[run.current_index]
      const existingResult = retryPausedStep ? run.step_results.get(run.step_order.at(-1)) : undefined
      retryPausedStep = false
      const { error, execution, result } = await executeStepWithRetries(run, step, existingResult)
      if (existingResult == null) {
        run.step_order.push(result.step_id)
        run.step_results.set(result.step_id, result)
      }
      if (error != null) {
        run.status = 'failed'
        run.outcome = 'failed'
        return finalizeResult(run)
      }
      if (execution?.control === 'pause') {
        run.status = 'paused'
        run.checkpoint = {
          checkpoint_id: createId('checkpoint'),
          step_id: result.step_id,
          ...execution.checkpoint
        }
        return finalizeResult(run)
      }
      run.current_index += 1
      if (execution?.control === 'exit') {
        run.status = 'completed'
        run.outcome = execution.outcome
        run.exit = {
          step_id: result.step_id,
          reason: execution.output?.reason ?? 'Workflow exited.'
        }
        return finalizeResult(run)
      }
    }
    run.status = 'completed'
    run.outcome = 'succeeded'
    return finalizeResult(run)
  }

  async function executeWorkflow(input) {
    validateWorkflowInput(input)
    await ensureAxCaptureMode()
    const createdAt = now()
    const run = {
      contexts: Object.fromEntries(Object.entries(input.contexts ?? {}).map(([key, value]) => [key, { ...value }])),
      current_index: 0,
      deadline_at: createdAt + Math.min(300000, Math.max(1000, asInteger(input.max_duration_ms, 120000))),
      detail_mode: ['inline', 'references'].includes(input.detail_mode) ? input.detail_mode : 'auto',
      run_id: createId('run'),
      status: 'running',
      step_order: [],
      step_results: new Map(),
      steps: input.steps.map(step => ({ ...step })),
      workflow_id: input.workflow_id
    }
    storeRun(run)
    const result = await continueRun(run)
    return mcpToolResult(result, `Workflow ${result.status}: ${result.run_id}`)
  }

  async function resumeWorkflow(input) {
    const run = runs.get(input?.run_id)
    if (run == null) return mcpToolError('RUN_NOT_FOUND', 'Workflow run was not found.')
    if (run.status !== 'paused' || run.checkpoint == null) {
      return mcpToolError('RUN_NOT_PAUSED', 'Workflow run is not paused.', { run_id: run.run_id })
    }
    if (input.checkpoint_id != null && input.checkpoint_id !== run.checkpoint.checkpoint_id) {
      return mcpToolError('CHECKPOINT_MISMATCH', 'Checkpoint id does not match the paused workflow.', { run_id: run.run_id })
    }
    const decision = input.decision
    const pausedStep = run.step_results.get(run.checkpoint.step_id)
    if (decision === 'cancel') {
      run.status = 'cancelled'
      run.outcome = 'cancelled'
      const result = finalizeResult(run)
      return mcpToolResult(result, `Workflow cancelled: ${run.run_id}`)
    }
    if (decision === 'retry') {
      if (pausedStep != null) pausedStep.status = 'running'
      const result = await continueRun(run, true)
      return mcpToolResult(result, `Workflow ${result.status}: ${run.run_id}`)
    }
    if (pausedStep != null) {
      pausedStep.status = 'completed'
      pausedStep.output = {
        ...(pausedStep.output ?? {}),
        checkpoint_decision: decision
      }
    }
    run.current_index += 1
    const result = await continueRun(run)
    return mcpToolResult(result, `Workflow ${result.status}: ${run.run_id}`)
  }

  function getWorkflowStepResults(input) {
    const run = runs.get(input?.run_id)
    if (run == null) return mcpToolError('RUN_NOT_FOUND', 'Workflow run was not found.')
    if (!Array.isArray(input.step_ids) || input.step_ids.length === 0 || input.step_ids.length > 50) {
      return mcpToolError('INVALID_STEP_IDS', 'Provide between 1 and 50 step ids.', { run_id: run.run_id })
    }
    const select = Array.isArray(input.select) && input.select.length > 0 ? input.select : defaultSelectedFields
    const items = input.step_ids.map(stepId => {
      const step = run.step_results.get(stepId)
      return step == null ? { step_id: stepId, status: 'not_found' } : publicStepResult(step, select)
    })
    const result = { run_id: run.run_id, items }
    return mcpToolResult(result, `Returned ${items.length} workflow step result(s).`)
  }

  async function call(name, input) {
    try {
      if (name === 'execute_workflow') return await executeWorkflow(input)
      if (name === 'resume_workflow') return await resumeWorkflow(input)
      if (name === 'get_workflow_step_results') return getWorkflowStepResults(input)
      return mcpToolError('TOOL_NOT_FOUND', `Unknown workflow tool: ${name}`)
    } catch (error) {
      return mcpToolError(error.code ?? 'WORKFLOW_FAILED', error.message)
    }
  }

  return { call, runs }
}

module.exports = {
  createWorkflowService,
  elementMatches,
  findTarget,
  parseTreeElements,
  structuredToolData,
  workflowToolDefinitions,
  workflowToolNames
}
