const files = require('./notarization-state-files.cjs')

const parseFlags = args => {
  const flags = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!name?.startsWith('--') || value == null) {
      throw new Error(`[desktop] invalid notarization argument ${name ?? ''}`)
    }
    flags.set(name.slice(2), value)
  }
  return flags
}

const main = async api => {
  const [operation, ...args] = process.argv.slice(2)
  const flags = parseFlags(args)
  const stateDir = flags.get('state-dir')
  if (operation === 'history') return api.printHistory()
  files.readRequiredValue(stateDir, '--state-dir')
  if (operation === 'prepare') {
    return api.prepareState({
      buildBranch: flags.get('build-branch'),
      buildTime: flags.get('build-time'),
      builderSha: flags.get('builder-sha'),
      releaseTag: flags.get('release-tag') ?? '',
      runAttempt: flags.get('run-attempt'),
      runHeadSha: flags.get('run-head-sha'),
      runId: flags.get('run-id'),
      sourceSha: flags.get('source-sha'),
      stage: flags.get('stage'),
      stateDir,
      workspaceDir: flags.get('workspace-dir')
    })
  }
  if (operation === 'bind') {
    return api.bindState(stateDir, {
      headSha: flags.get('run-head-sha'),
      runAttempt: flags.get('run-attempt'),
      runId: flags.get('run-id')
    })
  }
  if (operation === 'submit') return api.submitState(stateDir)
  if (operation === 'reconcile') return api.reconcileState(stateDir)
  if (operation === 'restore') return api.restoreState(stateDir, flags.get('workspace-dir'))
  if (operation === 'wait') {
    const timeoutMinutes = Number(flags.get('timeout-minutes') ?? '20')
    if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
      throw new Error('[desktop] timeout-minutes must be positive')
    }
    return api.waitForState(stateDir, { timeoutMs: timeoutMinutes * 60_000 })
  }
  if (operation === 'staple') return api.stapleState(stateDir, flags.get('workspace-dir'))
  if (operation === 'inspect') console.log(JSON.stringify(api.inspectState(stateDir), null, 2))
  else throw new Error(`[desktop] unsupported notarization operation ${operation ?? ''}`)
}

module.exports = { main }
