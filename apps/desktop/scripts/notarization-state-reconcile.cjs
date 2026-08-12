const path = require('node:path')

const files = require('./notarization-state-files.cjs')

const reconciliationWindowMs = 10 * 60_000

const reconcileHistory = (stateDir, history) => {
  const { state, statePath } = files.readState(stateDir)
  for (const target of state.targets) {
    if (target.submissionId || !target.submissionAttemptedAt) continue
    const attemptedAt = Date.parse(target.submissionAttemptedAt)
    const matches = history.filter(entry => {
      const createdAt = Date.parse(entry.createdDate)
      return entry.name === path.basename(target.payload) &&
        Number.isFinite(createdAt) &&
        Math.abs(createdAt - attemptedAt) <= reconciliationWindowMs
    })
    if (matches.length !== 1 || !matches[0].id) {
      throw new Error(`[desktop] cannot safely reconcile attempted notarization for ${target.name}`)
    }
    target.submissionId = matches[0].id
    target.status = matches[0].status ?? 'Uploaded'
    target.submittedAt = matches[0].createdDate
  }
  files.writeJsonAtomic(statePath, state)
  return state
}

module.exports = { reconcileHistory }
