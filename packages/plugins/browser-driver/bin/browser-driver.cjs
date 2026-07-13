#!/usr/bin/env node
/* eslint-disable max-lines -- the MCP entry keeps transport routing, page queues, and lifecycle wiring together. */
const { Buffer } = require('node:buffer')
const { randomUUID } = require('node:crypto')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const process = require('node:process')

const createAgentLifecycle = require('./browser-driver-agent-lifecycle.cjs')
const { contentResult, operationFromTool, tools } = require('./browser-driver-contract.cjs')
const readBridgeCredentials = require('./browser-driver-credentials.cjs')
const createStdioServer = require('./browser-driver-stdio.cjs')
const createWorkflowController = require('./browser-driver-workflows.cjs')

const serverInfo = { name: 'oneworks-browser-driver', version: '0.1.0' }
const sessionId = process.env.__ONEWORKS_PROJECT_SESSION_ID__ ??
  process.env.__ONEWORKS_CODEX_TASK_SESSION_ID__ ??
  process.env.__ONEWORKS_CLAUDE_TASK_SESSION_ID__ ??
  process.env.__ONEWORKS_GEMINI_TASK_SESSION_ID__ ??
  process.env.__ONEWORKS_KIMI_TASK_SESSION_ID__ ??
  process.env.__ONEWORKS_OPENCODE_TASK_SESSION_ID__ ??
  process.env.__ONEWORKS_COPILOT_TASK_SESSION_ID__

const agentLifecycle = createAgentLifecycle(async operationId => {
  try {
    return await callBridge({
      op: 'release_agent_action_state',
      ...(operationId == null ? {} : { agent_operation_id: operationId })
    }, { ignoreRequestSignal: true })
  } catch (error) {
    process.stderr.write(
      `[browser-driver] failed to release Agent tab state: ${error instanceof Error ? error.message : String(error)}\n`
    )
    return { ok: false, restored_pages: 0 }
  }
})

const pageTails = new Map()

function pageId(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function enqueueForPage(id, task) {
  const key = pageId(id)
  if (!key) {
    const error = new Error('A page_id is required for queued browser operations.')
    error.code = 'PAGE_ID_REQUIRED'
    throw error
  }
  const previous = pageTails.get(key) ?? Promise.resolve()
  const result = previous.then(task, task)
  const tail = result.then(() => undefined, () => undefined)
  pageTails.set(key, tail)
  void tail.then(() => {
    if (pageTails.get(key) === tail) pageTails.delete(key)
  })
  return result
}

async function callBridge(payload, options = {}) {
  const { bridgeToken, bridgeUrl } = readBridgeCredentials()
  if (!bridgeUrl || !bridgeToken) {
    const error = new Error(
      'Browser control is available only in the OneWorks desktop app. Open this workspace in the desktop app and retry the task.'
    )
    error.code = 'DESKTOP_BROWSER_UNAVAILABLE'
    throw error
  }
  const timeoutMs = Math.min(35_000, Math.max(5_000, Number(payload.timeout_ms) + 5_000 || 35_000))
  let response
  try {
    response = await fetch(new URL('/v1/control', bridgeUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bridgeToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        ...payload,
        driver_instance_id: agentLifecycle.driverInstanceId,
        ...(sessionId == null ? {} : { session_id: sessionId })
      }),
      signal: (() => {
        const timeoutSignal = AbortSignal.timeout(timeoutMs)
        const requestSignal = options.ignoreRequestSignal ? undefined : agentLifecycle.requestSignal()
        return requestSignal == null ? timeoutSignal : AbortSignal.any([requestSignal, timeoutSignal])
      })()
    })
  } catch (cause) {
    const error = new Error(
      cause?.name === 'TimeoutError'
        ? 'The OneWorks browser-control service timed out.'
        : cause?.name === 'AbortError'
        ? 'The OneWorks browser-control operation was cancelled.'
        : 'The OneWorks browser-control service is unavailable.'
    )
    error.code = cause?.name === 'TimeoutError'
      ? 'BROWSER_CONTROL_TIMEOUT'
      : cause?.name === 'AbortError'
      ? 'BROWSER_CONTROL_CANCELLED'
      : 'BROWSER_BRIDGE_UNAVAILABLE'
    throw error
  }
  let body
  try {
    body = await response.json()
  } catch {
    const error = new Error('The OneWorks browser-control service returned an invalid response.')
    error.code = 'BROWSER_BRIDGE_INVALID_RESPONSE'
    throw error
  }
  if (!response.ok || body?.ok !== true) {
    const error = new Error(body?.error?.message || `Browser control failed with HTTP ${response.status}.`)
    error.code = body?.error?.code || 'BROWSER_CONTROL_FAILED'
    throw error
  }
  return body.result ?? body
}

function screenshotPath(dataBase64) {
  const dir = join(tmpdir(), 'oneworks-browser-driver', sessionId || `process-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  const output = join(dir, `screenshot-${Date.now()}-${randomUUID().slice(0, 8)}.png`)
  writeFileSync(output, Buffer.from(dataBase64, 'base64'), { mode: 0o600 })
  return output
}

async function callOperation(op, args) {
  const result = await callBridge({ op, ...agentLifecycle.decorateOperation(op, args) })
  if (op !== 'screenshot') return result
  return {
    page: result.page,
    mime_type: result.mime_type,
    path: screenshotPath(result.data_base64)
  }
}

const { executeWorkflow, getWorkflowSteps, validateWorkflow } = createWorkflowController(callOperation)

let shutdownPromise

async function shutdown() {
  if (shutdownPromise != null) return await shutdownPromise
  shutdownPromise = (async () => {
    const tails = [...pageTails.values()]
    await agentLifecycle.releaseAll()
    await Promise.allSettled(tails)
    if (tails.length > 0) await agentLifecycle.releaseAll()
  })()
  return await shutdownPromise
}

function compactWorkflowRun(result) {
  const run = result.structuredContent
  return {
    run_id: run.run_id,
    ...(run.workflow_id == null ? {} : { workflow_id: run.workflow_id }),
    page_id: run.page_id,
    status: run.status,
    outcome: run.outcome,
    steps: { total: run.steps.total, ids: run.steps.ids }
  }
}

async function executeWorkflows(args) {
  if (!Array.isArray(args.workflows) || args.workflows.length === 0) {
    throw new Error('At least one browser workflow is required.')
  }
  args.workflows.forEach(validateWorkflow)
  const settled = await Promise.allSettled(args.workflows.map(workflow => (
    enqueueForPage(workflow.page_id, () => executeWorkflow(workflow).then(compactWorkflowRun))
  )))
  const runs = settled.map((entry, index) =>
    entry.status === 'fulfilled'
      ? entry.value
      : {
        workflow_id: args.workflows[index].workflow_id,
        page_id: args.workflows[index].page_id,
        status: 'failed',
        outcome: 'failed',
        error: {
          code: entry.reason?.code ?? 'BROWSER_WORKFLOW_FAILED',
          message: entry.reason?.message ?? String(entry.reason)
        }
      }
  )
  const succeeded = runs.filter(run => run.outcome === 'succeeded').length
  const outcome = succeeded === runs.length ? 'succeeded' : succeeded === 0 ? 'failed' : 'partial'
  return contentResult(
    { status: 'completed', outcome, runs },
    `In-app browser workflows ${outcome}: ${runs.length} run(s).`
  )
}

async function callTool(name, args, context) {
  return await agentLifecycle.withRequest(context, async () => await dispatchTool(name, args))
}

async function dispatchTool(name, args) {
  if (name === 'in_app_browser_list_pages') {
    const result = await callBridge({ op: 'list_pages' })
    const pages = Array.isArray(result.pages) ? result.pages : []
    return contentResult({ pages }, `Found ${pages.length} controllable internal browser page(s).`)
  }
  if (name === 'execute_in_app_browser_workflow') {
    return await enqueueForPage(args.page_id, () => executeWorkflow(args))
  }
  if (name === 'execute_in_app_browser_workflows') return await executeWorkflows(args)
  if (name === 'get_in_app_browser_workflow_steps') return getWorkflowSteps(args)
  const operation = operationFromTool(name)
  if (!operation) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'TOOL_NOT_FOUND' })
  if (operation === 'open_page') {
    return contentResult(await callOperation(operation, args), `${name} completed.`)
  }
  const result = await enqueueForPage(args.page_id, () => callOperation(operation, args))
  return contentResult(result, `${name} completed.`)
}

const stdioServer = createStdioServer({
  callTool,
  onCancel: ({ requestId }) => agentLifecycle.cancelRequest(requestId),
  onClose: shutdown,
  serverInfo,
  tools
})

module.exports = {
  callBridge,
  callTool,
  executeWorkflows,
  executeWorkflow,
  getQueuedPageCount: () => pageTails.size,
  getWorkflowSteps,
  handleRequest: stdioServer.handleRequest,
  readBridgeCredentials,
  shutdown,
  tools
}

if (require.main === module) {
  stdioServer.start()
  const stop = () => void stdioServer.cancelAll().then(shutdown).finally(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
