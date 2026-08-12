const { spawnSync } = require('node:child_process')

const files = require('./notarization-state-files.cjs')
const preparation = require('./notarization-state-prepare.cjs')
const reconciliation = require('./notarization-state-reconcile.cjs')

const terminalRejectedStatuses = new Set(['invalid', 'rejected'])

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  })
  if (result.error != null) throw result.error
  if (result.status !== 0) {
    const stderr = result.stderr?.trim()
    throw new Error(`[desktop] ${command} ${args[0] ?? ''} failed${stderr ? `: ${stderr}` : ''}`)
  }
  return result.stdout ?? ''
}

const notaryCredentials = (env = process.env) => [
  '--apple-id',
  files.readRequiredValue(env.APPLE_ID, 'APPLE_ID'),
  '--password',
  files.readRequiredValue(env.APPLE_ID_PASSWORD, 'APPLE_ID_PASSWORD'),
  '--team-id',
  files.readRequiredValue(env.APPLE_TEAM_ID, 'APPLE_TEAM_ID')
]

const notarytoolJson = (args, { command = runCommand, env = process.env } = {}) => {
  const output = command('xcrun', [
    'notarytool',
    ...args,
    ...notaryCredentials(env),
    '--output-format',
    'json',
    '--no-progress'
  ])
  try {
    return JSON.parse(output)
  } catch {
    throw new Error('[desktop] notarytool returned invalid JSON')
  }
}

const submitState = (stateDir, options = {}) => {
  const { state, statePath } = files.readState(stateDir)
  for (const target of state.targets) {
    if (target.submissionId) continue
    if (target.submissionAttemptedAt) {
      throw new Error(`[desktop] refusing to duplicate an ambiguous notarization attempt for ${target.name}`)
    }
    const payloadPath = files.verifyPayload(stateDir, target)
    target.submissionAttemptedAt = new Date().toISOString()
    files.writeJsonAtomic(statePath, state)
    const result = notarytoolJson(['submit', payloadPath, '--no-wait'], options)
    const submissionId = files.readRequiredValue(result.id, 'notarytool submission id')
    target.submissionId = submissionId
    target.status = result.status ?? 'Uploaded'
    target.submittedAt = new Date().toISOString()
    files.writeJsonAtomic(statePath, state)
    console.log(`[desktop] submitted ${target.name} for notarization as ${submissionId}`)
  }
  return state
}

const normalizeStatus = status => String(status ?? '').trim().toLowerCase()

const queryState = (stateDir, options = {}) => {
  const { state, statePath } = files.readState(stateDir)
  let pending = false
  for (const target of state.targets) {
    const submissionId = files.readRequiredValue(target.submissionId, `submission id for ${target.name}`)
    const result = notarytoolJson(['info', submissionId], options)
    target.status = files.readRequiredValue(result.status, `notarization status for ${target.name}`)
    target.checkedAt = new Date().toISOString()
    const status = normalizeStatus(target.status)
    if (terminalRejectedStatuses.has(status)) {
      files.writeJsonAtomic(statePath, state)
      throw new Error(`[desktop] Apple rejected notarization ${submissionId} for ${target.name}`)
    }
    if (status !== 'accepted') pending = true
  }
  files.writeJsonAtomic(statePath, state)
  return { pending, state }
}

const waitForState = async (stateDir, {
  command,
  env,
  intervalMs = 60_000,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  timeoutMs = 20 * 60_000
} = {}) => {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const result = queryState(stateDir, { command, env })
    if (!result.pending) return result.state
    if (Date.now() >= deadline) {
      throw new Error(
        '[desktop] Apple notarization is still in progress; resume from the uploaded recovery artifact instead of resubmitting'
      )
    }
    await sleep(intervalMs)
  }
}

const printHistory = (options = {}) => {
  const result = notarytoolJson(['history'], options)
  const entries = Array.isArray(result.history) ? result.history : []
  const safe = entries.map(({ createdDate, id, name, status }) => ({ createdDate, id, name, status }))
  console.log(JSON.stringify({ history: safe }, null, 2))
  return safe
}

const reconcileState = (stateDir, options = {}) => {
  const { state } = files.readState(stateDir)
  if (!state.targets.some(target => target.submissionAttemptedAt && !target.submissionId)) return state
  const result = notarytoolJson(['history'], options)
  const history = Array.isArray(result.history) ? result.history : []
  return reconciliation.reconcileHistory(stateDir, history)
}

const prepareState = options => preparation.prepareState({ command: runCommand, ...options })
const restoreState = (stateDir, workspaceDir, options = {}) =>
  files.restoreState(
    stateDir,
    workspaceDir,
    { command: options.command ?? runCommand }
  )
const stapleState = (stateDir, workspaceDir, options = {}) =>
  files.stapleState(
    stateDir,
    workspaceDir,
    { command: options.command ?? runCommand, normalizeStatus }
  )
const inspectState = stateDir => files.readState(stateDir).state
const bindState = (stateDir, provenance) => files.bindState(stateDir, provenance)

const api = {
  bindState,
  inspectState,
  normalizeStatus,
  notarytoolJson,
  prepareState,
  printHistory,
  queryState,
  reconcileState,
  restoreState,
  sha256File: files.sha256File,
  stapleState,
  submitState,
  waitForState
}

module.exports = api

if (require.main === module) {
  require('./notarization-state-cli.cjs').main(api).catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
