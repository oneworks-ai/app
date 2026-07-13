#!/usr/bin/env node
/* eslint-disable max-lines -- Typed dispatch, shared target scheduling, and workflow integration remain one MCP entrypoint. */
const { Buffer } = require('node:buffer')
const { randomUUID } = require('node:crypto')
const { mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const process = require('node:process')

const createStdioServer = require('@oneworks/plugin-browser-driver/runtime/stdio')
const createWorkflowController = require('@oneworks/plugin-browser-driver/runtime/workflows')
const { operationFromTool, tools } = require('./chrome-driver-contract.cjs')
const readBridgeCredentials = require('./chrome-driver-credentials.cjs')
const { workflowOperationNames } = require('./chrome-driver-workflow-schema.cjs')

const serverInfo = { name: 'oneworks-chrome-driver', version: '0.1.0' }
const sessionId = process.env.__ONEWORKS_PROJECT_SESSION_ID__ ?? `process-${process.pid}`
const artifactDirectory = join(tmpdir(), 'oneworks-chrome-driver', sessionId, String(process.pid))
const artifactTtlMs = 30 * 60_000
const contentResult = (structuredContent, summary) => ({
  content: [{ type: 'text', text: summary }],
  structuredContent
})
const destructiveHistoryActions = new Set(['remove_url', 'remove_range', 'clear_all'])
const destructiveDownloadActions = new Set(['erase_record', 'remove_file', 'open'])
const destructiveBookmarkActions = new Set(['remove'])
const modifyingManagementActions = new Set(['set_enabled', 'uninstall'])

function riskFor(module, action, args = {}) {
  if (module === 'audit' || module === 'capabilities') return 0
  if (module === 'raw') return 4
  if (['devices', 'frames'].includes(module)) return 1
  if (
    ['windows', 'tabs', 'groups', 'sessions', 'bookmarks', 'history', 'downloads', 'readingList', 'management']
      .includes(module)
  ) {
    if (module === 'history' && destructiveHistoryActions.has(action)) return action === 'clear_all' ? 4 : 3
    if (module === 'downloads' && destructiveDownloadActions.has(action)) return 3
    if (module === 'downloads' && action === 'start' && args.conflict_action === 'overwrite') return 3
    if (module === 'bookmarks' && destructiveBookmarkActions.has(action)) return 3
    if (module === 'management' && modifyingManagementActions.has(action)) return 4
    if ((module === 'tabs' || module === 'windows') && action === 'close') return 3
    if (module === 'readingList' && action === 'remove') return 3
    return ['list', 'get', 'get_active', 'tree', 'children', 'recent', 'search', 'visits', 'devices', 'status']
        .includes(action)
      ? 1
      : 2
  }
  if (module === 'page') {
    if (['snapshot_sensitive', 'type_sensitive'].includes(action)) return 4
    return ['snapshot', 'wait'].includes(action) ? 1 : ['print', 'print_to_pdf', 'save_mhtml'].includes(action) ? 3 : 2
  }
  if (module === 'debug') return action === 'status' ? 1 : 3
  if (module === 'cookies') return action === 'list_metadata' ? 3 : 4
  if (['contentSettings', 'browsingData', 'proxy', 'privacy'].includes(module)) {
    return ['get', 'preview_removal'].includes(action) ? 3 : 4
  }
  return 2
}

function targetKey(module, args) {
  if (Number.isInteger(args.tab_id)) return `tab:${args.tab_id}`
  if (Array.isArray(args.tab_ids)) return `tabs:${[...args.tab_ids].sort((a, b) => a - b).join(',')}`
  if (Number.isInteger(args.window_id)) return `window:${args.window_id}`
  if (Number.isInteger(args.group_id)) return `group:${args.group_id}`
  if (typeof args.bookmark_id === 'string') return `bookmark:${args.bookmark_id}`
  if (Number.isInteger(args.download_id)) return `download:${args.download_id}`
  return module
}

const operationTails = new Map()
function operationResources(module, args) {
  if (Number.isInteger(args.tab_id)) return [`tab:${args.tab_id}`]
  if (Array.isArray(args.tab_ids)) {
    return [...new Set(args.tab_ids.filter(Number.isInteger).map(id => `tab:${id}`))].sort()
  }
  return [targetKey(module, args)]
}
function enqueueResources(resources, task) {
  const previous = resources.map(resource => operationTails.get(resource) ?? Promise.resolve())
  const result = Promise.all(previous).then(task, task)
  const tail = result.then(() => undefined, () => undefined)
  for (const resource of resources) operationTails.set(resource, tail)
  void tail.then(() => {
    for (const resource of resources) if (operationTails.get(resource) === tail) operationTails.delete(resource)
  })
  return result
}
const enqueueWorkflow = (target, task) => enqueueResources([target], task)

async function requestBridge(path, init = {}) {
  const { bridgeUrl, controlToken } = readBridgeCredentials()
  if (!bridgeUrl || !controlToken) {
    throw Object.assign(
      new Error(
        'External Browser control is unavailable. Open this workspace in OneWorks and connect the Chrome extension.'
      ),
      { code: 'CHROME_BRIDGE_UNAVAILABLE' }
    )
  }
  let response
  try {
    response = await fetch(new URL(path, bridgeUrl), {
      ...init,
      headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(40_000)
    })
  } catch (cause) {
    throw Object.assign(
      new Error(
        cause?.name === 'TimeoutError'
          ? 'The external Chrome bridge timed out.'
          : 'The external Chrome bridge is unavailable.'
      ),
      {
        code: cause?.name === 'TimeoutError' ? 'CHROME_BRIDGE_TIMEOUT' : 'CHROME_BRIDGE_UNAVAILABLE'
      }
    )
  }
  const body = await response.json().catch(() => undefined)
  if (!response.ok || body?.ok !== true) {
    const details = body?.error ?? {}
    throw Object.assign(new Error(details.message || `External Browser bridge failed with HTTP ${response.status}.`), {
      code: details.code || 'CHROME_CONTROL_FAILED',
      details
    })
  }
  return body.result
}

function writeArtifact(dataBase64, mimeType) {
  const extension = mimeType === 'application/pdf'
    ? 'pdf'
    : mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'application/json'
    ? 'json'
    : 'png'
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 })
  const path = join(artifactDirectory, `chrome-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`)
  writeFileSync(path, Buffer.from(dataBase64, 'base64'), { mode: 0o600 })
  setTimeout(() => rmSync(path, { force: true }), artifactTtlMs).unref()
  return path
}

process.once('exit', () => rmSync(artifactDirectory, { force: true, recursive: true }))

async function rawCallOperation(module, action, args) {
  const response = await requestBridge('/v1/control', {
    method: 'POST',
    body: JSON.stringify({
      args,
      op: `${module}.${action}`,
      risk_tier: riskFor(module, action, args),
      target_key: targetKey(module, args)
    })
  })
  const result = response?.result
  if (result?.data_base64 && typeof result.data_base64 === 'string') {
    return {
      ...result,
      data_base64: undefined,
      path: writeArtifact(result.data_base64, result.mime_type || 'image/png'),
      audit_id: response.audit_id
    }
  }
  return { ...(result ?? {}), audit_id: response?.audit_id }
}

const callOperation = (module, action, args) =>
  enqueueResources(
    operationResources(module, args),
    () => rawCallOperation(module, action, args)
  )

async function workflowOperation(op, args) {
  if (['navigate', 'back', 'forward', 'reload'].includes(op)) {
    const action = op === 'navigate' ? 'update' : op
    return rawCallOperation('tabs', action, op === 'navigate' ? { tab_id: args.tab_id, url: args.url } : args)
  }
  return rawCallOperation('page', op, args)
}

const workflows = createWorkflowController(workflowOperation, {
  operationNames: workflowOperationNames,
  targetId: args => `tab:${args.tab_id}`,
  targetRequiredMessage: 'Every Chrome workflow requires an explicit tab_id.',
  operationArgs: args => ({ tab_id: args.tab_id, frame_id: args.frame_id, document_id: args.document_id }),
  enqueueTarget: (target, task) => enqueueWorkflow(target, task),
  validateWorkflow: args => {
    if (
      args.steps.some(step => ['click', 'type', 'select', 'press_key', 'scroll'].includes(step.op)) && !args.document_id
    ) {
      throw new Error('Chrome workflows with semantic mutations require document_id from snapshot or frame discovery.')
    }
  },
  validateStep: step => {
    if (step.condition?.kind !== 'url_matches' && step.condition != null && !step.condition.ref) {
      throw new Error(`${step.node_id} condition requires ref.`)
    }
    if (step.condition?.kind === 'url_matches' && !step.condition.pattern) {
      throw new Error(`${step.node_id} condition requires pattern.`)
    }
  },
  evaluateCondition: async (condition, args) => {
    if (condition.kind === 'url_matches') {
      const result = await rawCallOperation('page', 'check_url', {
        tab_id: args.tab_id,
        url_pattern: condition.pattern
      })
      return result.matched === true
    }
    const result = await rawCallOperation('page', 'wait', {
      tab_id: args.tab_id,
      frame_id: args.frame_id,
      document_id: args.document_id,
      ref: condition.ref,
      state: condition.kind,
      timeout_ms: 0
    })
    return result.matched === true
  }
})

function compactRun(result) {
  const run = result.structuredContent
  return {
    run_id: run.run_id,
    workflow_id: run.workflow_id,
    page_id: run.page_id,
    status: run.status,
    outcome: run.outcome,
    steps: { total: run.steps.total, ids: run.steps.ids }
  }
}

async function executeWorkflows(args) {
  if (!Array.isArray(args.workflows) || args.workflows.length === 0) {
    throw new Error('At least one Chrome workflow is required.')
  }
  args.workflows.forEach(workflows.validateWorkflow)
  const settled = await Promise.allSettled(
    args.workflows.map(workflow => workflows.executeWorkflow(workflow).then(compactRun))
  )
  const runs = settled.map((entry, index) =>
    entry.status === 'fulfilled' ? entry.value : ({
      workflow_id: args.workflows[index].workflow_id,
      status: 'failed',
      outcome: 'failed',
      error: {
        code: entry.reason?.code || 'CHROME_WORKFLOW_FAILED',
        message: entry.reason?.message || String(entry.reason)
      }
    })
  )
  const running = runs.filter(run => run.status === 'running').length
  const succeeded = runs.filter(run => run.outcome === 'succeeded').length
  if (running > 0) {
    return contentResult(
      { status: 'running', outcome: 'started', runs },
      `Chrome workflows started: ${runs.length} run(s).`
    )
  }
  const outcome = succeeded === runs.length ? 'succeeded' : succeeded === 0 ? 'failed' : 'partial'
  return contentResult({ status: 'completed', outcome, runs }, `Chrome workflows ${outcome}: ${runs.length} run(s).`)
}

async function callTool(name, args) {
  if (name === 'chrome_capabilities') {
    const status = await requestBridge('/v1/status')
    return contentResult(
      status,
      status.connected ? 'External Browser is connected.' : 'External Browser is disconnected.'
    )
  }
  if (name === 'chrome_audit') {
    const status = await requestBridge('/v1/status')
    const result = args.action === 'pending_confirmations'
      ? { pending_confirmations: status.pending_confirmations }
      : { entries: status.recent_audit.slice(0, args.max_results ?? 50) }
    return contentResult(result, `${name}.${args.action} completed.`)
  }
  if (name === 'execute_chrome_workflow') return workflows.executeWorkflow(args)
  if (name === 'execute_chrome_workflows') return executeWorkflows(args)
  if (name === 'get_chrome_workflow_steps') return workflows.getWorkflowSteps(args)
  if (name === 'resume_chrome_workflow') return workflows.resumeWorkflow(args)
  const module = operationFromTool(name)
  if (!module) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'TOOL_NOT_FOUND' })
  const result = await callOperation(module, args.action, args)
  return contentResult(result, `${name}.${args.action} completed.`)
}

const server = createStdioServer({ callTool, serverInfo, tools })
module.exports = { callOperation, callTool, enqueueResources, enqueueWorkflow, operationResources, riskFor, targetKey }
if (require.main === module) server.start()
