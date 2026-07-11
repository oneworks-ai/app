import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { withCrossProcessLock } from './file-lock'
import { normalizeText, repoRoot } from './paths'

const resolveGlobalLockRoot = () => {
  const realHome = normalizeText(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeText(process.env.HOME) ??
    homedir() ??
    repoRoot
  return join(resolve(realHome), '.oneworks')
}

export const withDevStartPortLock = async <T>(run: () => Promise<T>) => (
  await withCrossProcessLock(join(resolveGlobalLockRoot(), 'dev-start-port-resolution'), run)
)

export const withDevStartPreparationLock = async <T>(run: () => Promise<T>) => (
  await withCrossProcessLock(join(repoRoot, '.logs/dev-start-worktree-preparation'), run)
)

export const withDevStartLifecycleLock = async <T>(run: () => Promise<T>) => (
  await withCrossProcessLock(join(repoRoot, '.logs/dev-start-worktree-lifecycle'), run)
)
