import process from 'node:process'

import { log } from './paths'
import { readSync, runSync } from './process'

export const ensureGitUpdated = () => {
  if (readSync('git', ['rev-parse', '--show-toplevel']) == null) {
    log('not a git worktree; skipped git update')
    return { changed: false }
  }

  const before = readSync('git', ['rev-parse', 'HEAD'])
  log('fetching origin')
  runSync('git', ['fetch', '--prune', 'origin'])

  const porcelain = readSync('git', ['status', '--porcelain']) ?? ''
  if (porcelain !== '') {
    log('local changes detected; skipped checkout/pull and kept current files')
    return { changed: false }
  }

  const branch = readSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'])
  if (branch == null || branch === '') {
    log('detached HEAD; fetched origin and kept the current revision')
  } else if (readSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) != null) {
    log(`pulling ${branch} with --ff-only`)
    runSync('git', ['pull', '--ff-only'])
  } else if (branch === 'main') {
    log('pulling main from origin with --ff-only')
    runSync('git', ['pull', '--ff-only', 'origin', 'main'])
  } else {
    log(`branch ${branch} has no upstream; fetched origin and kept current branch`)
  }

  const after = readSync('git', ['rev-parse', 'HEAD'])
  return { changed: before !== after }
}

export const ensureWorkspaceInstall = () => {
  const result = runSync(process.execPath, ['scripts/check-workspace-install.mjs'], {
    allowFailure: true,
    stdio: 'pipe'
  })
  if (result.status === 0) return

  log('workspace install missing or incomplete; running pnpm install')
  runSync('pnpm', ['install'])
}
