const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const schemaVersion = 1
const workflowPath = '.github/workflows/desktop-package.yml'

const resolveContained = (root, relativePath, label) => {
  if (typeof relativePath !== 'string' || relativePath === '' || path.isAbsolute(relativePath)) {
    throw new Error(`[desktop] invalid notarization ${label}`)
  }
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`[desktop] notarization ${label} escapes its recovery root`)
  }
  return resolved
}

const readRequiredValue = (value, name) => {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`[desktop] notarization requires ${name}`)
  return normalized
}

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
    while (bytesRead > 0) {
      hash.update(buffer.subarray(0, bytesRead))
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

const artifactProvenance = ({ headSha, runAttempt, runId }) => {
  const normalizedRunId = String(runId ?? '')
  const normalizedAttempt = Number(runAttempt)
  if (!/^\d+$/u.test(normalizedRunId) || !Number.isSafeInteger(normalizedAttempt) || normalizedAttempt < 1) {
    throw new Error('[desktop] invalid notarization workflow run identity')
  }
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/iu.test(headSha)) {
    throw new Error('[desktop] invalid notarization workflow head SHA')
  }
  return { headSha, runAttempt: normalizedAttempt, runId: normalizedRunId, workflowPath }
}

const readState = (stateDir) => {
  const statePath = path.join(stateDir, 'notarization-state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  if (state.schemaVersion !== schemaVersion) {
    throw new Error(`[desktop] unsupported notarization state schema ${state.schemaVersion}`)
  }
  if (!['app', 'installer'].includes(state.stage) || !Array.isArray(state.targets) || state.targets.length === 0) {
    throw new Error('[desktop] invalid notarization recovery state')
  }
  if (!state.buildBranch || Number.isNaN(Date.parse(state.buildTime))) {
    throw new Error('[desktop] invalid notarization build metadata')
  }
  artifactProvenance(state.artifactProvenance ?? {})
  if (!Array.isArray(state.files) || state.files.length < state.targets.length) {
    throw new Error('[desktop] invalid notarization recovery file manifest')
  }
  const expectedRoot = state.stage === 'app' ? 'apps/desktop/out' : 'apps/desktop/release'
  for (const item of [...state.files, ...state.targets]) {
    resolveContained(stateDir, item.payload, 'payload path')
    const targetPath = resolveContained('.', item.relativePath, 'workspace path')
    const expectedPath = path.resolve(expectedRoot)
    if (targetPath !== expectedPath && !targetPath.startsWith(`${expectedPath}${path.sep}`)) {
      throw new Error(`[desktop] notarization target is outside ${expectedRoot}`)
    }
    if (!Number.isSafeInteger(item.size) || item.size < 0 || !/^[0-9a-f]{64}$/u.test(item.sha256)) {
      throw new Error('[desktop] invalid notarization payload size or digest')
    }
  }
  return { state, statePath }
}

const bindState = (stateDir, provenance) => {
  const { state, statePath } = readState(stateDir)
  state.artifactProvenance = artifactProvenance(provenance)
  writeJsonAtomic(statePath, state)
  return state
}

const verifyPayload = (stateDir, target) => {
  const payloadPath = resolveContained(stateDir, target.payload, 'payload path')
  const stat = fs.statSync(payloadPath)
  if (stat.size !== target.size || sha256File(payloadPath) !== target.sha256) {
    throw new Error(`[desktop] notarization recovery payload changed: ${target.payload}`)
  }
  return payloadPath
}

const restoreState = (stateDir, workspaceDir, { command }) => {
  const { state } = readState(stateDir)
  for (const target of state.files ?? state.targets) {
    const payloadPath = verifyPayload(stateDir, target)
    const targetPath = resolveContained(workspaceDir, target.relativePath, 'workspace path')
    fs.rmSync(targetPath, { force: true, recursive: true })
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    if (state.stage === 'app') {
      command('ditto', ['-x', '-k', payloadPath, path.dirname(targetPath)])
    } else {
      fs.copyFileSync(payloadPath, targetPath)
    }
  }
  return state
}

const stapleState = (stateDir, workspaceDir, { command, normalizeStatus }) => {
  const { state } = readState(stateDir)
  for (const target of state.targets) {
    if (normalizeStatus(target.status) !== 'accepted') {
      throw new Error(`[desktop] refusing to staple non-accepted target ${target.name}`)
    }
    const targetPath = resolveContained(workspaceDir, target.relativePath, 'workspace path')
    command('xcrun', ['stapler', 'staple', targetPath])
    command('xcrun', ['stapler', 'validate', targetPath])
  }
  return state
}

module.exports = {
  artifactProvenance,
  bindState,
  readRequiredValue,
  readState,
  restoreState,
  sha256File,
  stapleState,
  schemaVersion,
  verifyPayload,
  writeJsonAtomic
}
