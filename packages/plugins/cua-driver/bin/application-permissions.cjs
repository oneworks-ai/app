const applicationPermissionModes = new Set(['always_allow', 'always_ask', 'deny'])
const applicationPermissionPriority = {
  always_allow: 0,
  always_ask: 1,
  deny: 2
}
const permissionExemptTools = new Set([
  'get_agent_cursor_state',
  'get_config',
  'get_screen_size',
  'list_apps',
  'set_session_cursor_color',
  'set_session_cursor_start'
])

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBundleId(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function normalizePermissionMode(value, fallback = 'always_ask') {
  return applicationPermissionModes.has(value) ? value : fallback
}

function normalizeApplicationPermissionRules(value) {
  if (!Array.isArray(value)) return []
  const rulesByBundleId = new Map()
  const rules = []
  for (const entry of value) {
    if (!isObject(entry)) continue
    const bundleId = normalizeBundleId(entry.bundleId ?? entry.bundle_id)
    if (bundleId == null) continue
    const mode = normalizePermissionMode(entry.mode)
    const key = bundleId.toLocaleLowerCase('en-US')
    const existing = rulesByBundleId.get(key)
    if (existing != null) {
      if (applicationPermissionPriority[mode] > applicationPermissionPriority[existing.mode]) {
        existing.mode = mode
      }
      continue
    }
    if (rules.length >= 200) continue
    const rule = {
      bundleId,
      ...(typeof entry.name === 'string' && entry.name.trim() !== '' ? { name: entry.name.trim() } : {}),
      mode
    }
    rulesByBundleId.set(key, rule)
    rules.push(rule)
  }
  return rules
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function readApplicationPermissionConfig(env = process.env) {
  return {
    defaultMode: normalizePermissionMode(
      env.ONEWORKS_CUA_DEFAULT_APPLICATION_PERMISSION,
      'always_ask'
    ),
    rules: normalizeApplicationPermissionRules(
      parseJson(env.ONEWORKS_CUA_APPLICATION_PERMISSIONS, [])
    )
  }
}

function unwrapDriverResult(result) {
  if (isObject(result?.structuredContent)) return result.structuredContent
  if (isObject(result) && result.content == null) return result
  const text = Array.isArray(result?.content)
    ? result.content.find(item => item?.type === 'text' && typeof item.text === 'string')?.text
    : undefined
  if (typeof text !== 'string') return {}
  const parsed = parseJson(text, {})
  return isObject(parsed) ? parsed : {}
}

function applicationListFromResult(result) {
  const data = unwrapDriverResult(result)
  const values = Array.isArray(data.apps)
    ? data.apps
    : Array.isArray(data.applications)
    ? data.applications
    : Array.isArray(data.running_apps)
    ? data.running_apps
    : []
  return values.flatMap(value => {
    if (!isObject(value)) return []
    const bundleId = normalizeBundleId(value.bundle_id ?? value.bundleId)
    const pid = Number.isInteger(value.pid) ? value.pid : undefined
    if (bundleId == null || pid == null) return []
    const name = [value.name, value.app_name, value.localized_name]
      .find(candidate => typeof candidate === 'string' && candidate.trim() !== '')
    return [{ bundleId, ...(typeof name === 'string' ? { name: name.trim() } : {}), pid }]
  })
}

function windowListFromResult(result) {
  const data = unwrapDriverResult(result)
  const values = Array.isArray(data.windows) ? data.windows : []
  return values.flatMap(value => {
    if (!isObject(value) || !Number.isInteger(value.window_id ?? value.windowId)) return []
    const windowId = value.window_id ?? value.windowId
    const pid = Number.isInteger(value.pid) ? value.pid : undefined
    const bundleId = normalizeBundleId(value.bundle_id ?? value.bundleId)
    return [{ bundleId, pid, windowId }]
  })
}

function workflowBundleIds(toolName, input) {
  const workflows = toolName === 'execute_workflows'
    ? Array.isArray(input?.workflows) ? input.workflows : []
    : [input]
  const bundleIds = new Set()
  for (const workflow of workflows) {
    for (const context of Object.values(workflow?.contexts ?? {})) {
      const bundleId = normalizeBundleId(context?.bundle_id ?? context?.bundleId)
      if (bundleId != null) bundleIds.add(bundleId)
    }
    for (const step of workflow?.steps ?? []) {
      if (step?.op !== 'launch_app') continue
      const bundleId = normalizeBundleId(step.bundle_id ?? step.bundleId)
      if (bundleId != null) bundleIds.add(bundleId)
    }
  }
  return [...bundleIds]
}

function uniqueTargets(targets) {
  const seen = new Set()
  return targets.filter(target => {
    const key = target.bundleId?.toLocaleLowerCase('en-US') ?? 'system'
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function resolveApplicationTargets(toolName, toolArguments, options) {
  if (permissionExemptTools.has(toolName)) return []
  const input = isObject(toolArguments) ? toolArguments : {}
  const directBundleIds = new Set()
  const directBundleId = normalizeBundleId(input.bundle_id ?? input.bundleId)
  if (directBundleId != null) directBundleIds.add(directBundleId)
  if (toolName === 'execute_workflow' || toolName === 'execute_workflows') {
    workflowBundleIds(toolName, input).forEach(bundleId => directBundleIds.add(bundleId))
  }
  if (
    (toolName === 'resume_workflow' || toolName === 'get_workflow_step_results') &&
    typeof options.getWorkflowBundleIds === 'function'
  ) {
    options.getWorkflowBundleIds(input.run_id).forEach(bundleId => directBundleIds.add(bundleId))
  }

  const appInventory = async () => applicationListFromResult(await options.callTool('list_apps', {}))
  let apps
  const loadApps = async () => {
    if (apps == null) apps = await appInventory()
    return apps
  }
  const targets = [...directBundleIds].map(bundleId => ({ bundleId }))
  let hasUnresolvedIdentity = false
  const pid = Number.isInteger(input.pid) ? input.pid : undefined
  if (pid != null) {
    const app = (await loadApps().catch(() => [])).find(candidate => candidate.pid === pid)
    if (app != null) targets.push(app)
    else hasUnresolvedIdentity = true
  }
  const windowId = Number.isInteger(input.window_id ?? input.windowId)
    ? input.window_id ?? input.windowId
    : undefined
  if (windowId != null) {
    const windows = windowListFromResult(
      await options.callTool('list_windows', {}).catch(() => ({}))
    )
    const window = windows.find(candidate => candidate.windowId === windowId)
    if (window?.bundleId != null) {
      targets.push({ bundleId: window.bundleId })
    } else if (window?.pid != null) {
      const app = (await loadApps().catch(() => [])).find(candidate => candidate.pid === window.pid)
      if (app != null) targets.push(app)
      else hasUnresolvedIdentity = true
    } else hasUnresolvedIdentity = true
  }

  if (hasUnresolvedIdentity) targets.push({ label: 'Unresolved computer-control target' })
  if (targets.length === 0) return [{ label: 'System-wide computer control' }]
  const knownApps = await loadApps().catch(() => [])
  return uniqueTargets(targets.map(target => {
    const known = knownApps.find(app =>
      app.bundleId.toLocaleLowerCase('en-US') === target.bundleId?.toLocaleLowerCase('en-US')
    )
    return known == null ? target : { ...target, name: known.name, pid: known.pid }
  }))
}

function evaluateApplicationPermission(targets, config) {
  const rules = new Map(
    config.rules.map(rule => [rule.bundleId.toLocaleLowerCase('en-US'), rule])
  )
  const evaluated = targets.map(target => {
    const rule = target.bundleId == null
      ? undefined
      : rules.get(target.bundleId.toLocaleLowerCase('en-US'))
    return {
      ...target,
      mode: rule?.mode ?? config.defaultMode,
      ...(target.name == null && rule?.name != null ? { name: rule.name } : {})
    }
  })
  const mode = evaluated.some(target => target.mode === 'deny')
    ? 'deny'
    : evaluated.some(target => target.mode === 'always_ask')
    ? 'always_ask'
    : 'always_allow'
  return { mode, targets: evaluated }
}

function targetLabel(target) {
  if (target.bundleId == null) return target.label ?? 'System-wide computer control'
  return target.name == null ? target.bundleId : `${target.name} (${target.bundleId})`
}

function targetIdentity(targets) {
  return targets
    .map(target => target.bundleId?.toLocaleLowerCase('en-US') ?? 'system')
    .sort()
    .join('\u001F')
}

class ApplicationPermissionError extends Error {
  constructor(message, options) {
    super(message)
    this.code = options.code
    this.rpcCode = options.rpcCode
    this.data = {
      kind: 'application-permission',
      decision: options.decision,
      applications: options.targets.map(target => ({
        ...(target.bundleId == null ? {} : { bundle_id: target.bundleId }),
        label: targetLabel(target)
      })),
      retryOriginalTask: false
    }
  }
}

function createApplicationPermissionGuard(options) {
  const config = options.config ?? readApplicationPermissionConfig()
  return {
    config,
    async authorize(toolName, toolArguments) {
      const targets = await resolveApplicationTargets(toolName, toolArguments, options)
      if (targets.length === 0) return { mode: 'always_allow', targets }
      const evaluation = evaluateApplicationPermission(targets, config)
      if (evaluation.mode === 'deny') {
        const denied = evaluation.targets.filter(target => target.mode === 'deny')
        throw new ApplicationPermissionError(
          `Computer control is denied for ${denied.map(targetLabel).join(', ')}.`,
          {
            code: 'APPLICATION_ACCESS_DENIED',
            decision: 'deny',
            rpcCode: -32003,
            targets: denied
          }
        )
      }
      if (evaluation.mode === 'always_ask') {
        if (
          typeof options.requestApproval !== 'function' ||
          options.supportsApproval?.() !== true
        ) {
          throw new ApplicationPermissionError(
            'This client cannot ask for the required computer-control confirmation.',
            {
              code: 'APPLICATION_CONFIRMATION_UNSUPPORTED',
              decision: 'unsupported',
              rpcCode: -32005,
              targets: evaluation.targets
            }
          )
        }
        const accepted = await options.requestApproval({
          targets: evaluation.targets.filter(target => target.mode === 'always_ask'),
          toolName
        })
        if (!accepted) {
          throw new ApplicationPermissionError(
            'The computer-control operation was not approved.',
            {
              code: 'APPLICATION_ACCESS_NOT_APPROVED',
              decision: 'decline',
              rpcCode: -32004,
              targets: evaluation.targets.filter(target => target.mode === 'always_ask')
            }
          )
        }
        const currentTargets = await resolveApplicationTargets(toolName, toolArguments, options)
        if (targetIdentity(currentTargets) !== targetIdentity(targets)) {
          throw new ApplicationPermissionError(
            'The target application changed while computer control was waiting for confirmation.',
            {
              code: 'APPLICATION_PERMISSION_CONTEXT_CHANGED',
              decision: 'changed',
              rpcCode: -32006,
              targets: currentTargets
            }
          )
        }
        const currentEvaluation = evaluateApplicationPermission(currentTargets, config)
        if (currentEvaluation.mode === 'deny') {
          throw new ApplicationPermissionError(
            'Computer control became denied while waiting for confirmation.',
            {
              code: 'APPLICATION_ACCESS_DENIED',
              decision: 'deny',
              rpcCode: -32003,
              targets: currentEvaluation.targets.filter(target => target.mode === 'deny')
            }
          )
        }
      }
      return evaluation
    }
  }
}

function createApplicationApprovalRequester(options) {
  let sequence = 0
  const pending = new Map()
  const request = ({ targets, toolName }) => {
    if (options.isSupported?.() !== true) return Promise.resolve(false)
    const id = `oneworks-cua-approval-${sequence += 1}`
    const labels = targets.map(targetLabel)
    return new Promise(resolveRequest => {
      pending.set(JSON.stringify(id), resolveRequest)
      options.write({
        jsonrpc: '2.0',
        id,
        method: 'elicitation/create',
        params: {
          mode: 'form',
          message: `允许 CUA 对 ${labels.map(label => `“${label}”`).join('、')} 执行“${toolName}”吗？` +
            ' 此确认仅适用于本次操作。',
          requestedSchema: {
            type: 'object',
            properties: {}
          },
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_title: `CUA ${labels.join(', ')} request ${sequence}`,
            tool_description: `Run ${toolName} through computer control for ${labels.join(', ')}. ` +
              'This approval is intentionally valid for one operation only.',
            tool_params: {
              applications: labels,
              tool: toolName
            }
          }
        }
      })
    })
  }
  const handleResponse = (message) => {
    if (!isObject(message) || message.method != null) return false
    const key = JSON.stringify(message.id)
    const resolveRequest = pending.get(key)
    if (resolveRequest == null) return false
    pending.delete(key)
    resolveRequest(message.error == null && message.result?.action === 'accept')
    return true
  }
  const stop = () => {
    for (const resolveRequest of pending.values()) resolveRequest(false)
    pending.clear()
  }
  return { handleResponse, request, stop }
}

module.exports = {
  ApplicationPermissionError,
  applicationPermissionModes,
  applicationListFromResult,
  createApplicationApprovalRequester,
  createApplicationPermissionGuard,
  evaluateApplicationPermission,
  normalizeApplicationPermissionRules,
  readApplicationPermissionConfig,
  resolveApplicationTargets,
  targetLabel,
  windowListFromResult,
  workflowBundleIds
}
