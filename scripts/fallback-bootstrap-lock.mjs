import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const readLockOwner = (ownerPath) => {
  try {
    return JSON.parse(readFileSync(ownerPath, 'utf8'))
  } catch {
    return undefined
  }
}

const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const lockIsOldEnough = (path) => {
  try {
    return Date.now() - statSync(path).mtimeMs > 2_000
  } catch {
    return false
  }
}

const waitForRetry = () => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
}

const releaseOwnedLockDirectory = ({ lockPath, ownerPath, token }) => {
  try {
    if (readLockOwner(ownerPath)?.token === token) {
      rmSync(lockPath, { force: true, recursive: true })
    }
  } catch {}
}

const readRecoveryQueue = (queuePath) => {
  try {
    return readFileSync(queuePath, 'utf8')
      .split('\n')
      .filter(token => /^[\da-f-]{36}$/u.test(token))
  } catch {
    return []
  }
}

const activeRecoveryTokens = ({ recoveryRoot, queuePath }) => (
  readRecoveryQueue(queuePath).filter(token => {
    const claimPath = resolve(recoveryRoot, token)
    if (!existsSync(claimPath)) return false
    const owner = readLockOwner(resolve(claimPath, 'owner.json'))
    if (
      !lockIsOldEnough(claimPath) ||
      (owner?.pid != null && processIsAlive(owner.pid))
    ) {
      return true
    }
    rmSync(claimPath, { force: true, recursive: true })
    return false
  })
)

const createRecoveryClaim = ({ recoveryRoot, queuePath }) => {
  const token = randomUUID()
  const claimPath = resolve(recoveryRoot, token)
  const ownerPath = resolve(claimPath, 'owner.json')
  mkdirSync(recoveryRoot, { recursive: true })
  mkdirSync(claimPath)
  try {
    writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token }))
    appendFileSync(queuePath, `\n${token}\n`)
    return { claimPath, ownerPath, token }
  } catch (error) {
    rmSync(claimPath, { force: true, recursive: true })
    throw error
  }
}

const tryRecoverFallbackLock = ({
  deadline,
  lockPath,
  ownerPath,
  queuePath,
  recoveryRoot
}) => {
  const staleOwner = readLockOwner(ownerPath)
  if (
    !lockIsOldEnough(lockPath) ||
    (staleOwner?.pid != null && processIsAlive(staleOwner.pid))
  ) {
    return false
  }

  const claim = createRecoveryClaim({ recoveryRoot, queuePath })
  try {
    while (
      Date.now() < deadline &&
      activeRecoveryTokens({ recoveryRoot, queuePath })[0] !== claim.token
    ) {
      waitForRetry()
    }
    if (Date.now() >= deadline) return false
    const currentOwner = readLockOwner(ownerPath)
    if (
      currentOwner?.token !== staleOwner?.token ||
      !lockIsOldEnough(lockPath) ||
      (currentOwner?.pid != null && processIsAlive(currentOwner.pid))
    ) {
      return false
    }
    rmSync(lockPath, { force: true, recursive: true })
    return true
  } finally {
    releaseOwnedLockDirectory({
      lockPath: claim.claimPath,
      ownerPath: claim.ownerPath,
      token: claim.token
    })
  }
}

export const acquireFallbackBootstrapLock = (path, timeoutMs) => {
  const lockPath = `${path}.dir`
  const ownerPath = resolve(lockPath, 'owner.json')
  const queuePath = `${lockPath}.recovery.queue`
  const recoveryRoot = `${lockPath}.recovery-claims`
  const token = randomUUID()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (activeRecoveryTokens({ recoveryRoot, queuePath }).length > 0) {
      waitForRetry()
      continue
    }
    try {
      mkdirSync(lockPath)
      writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token }))
      return () => releaseOwnedLockDirectory({ lockPath, ownerPath, token })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (
        tryRecoverFallbackLock({
          deadline,
          lockPath,
          ownerPath,
          queuePath,
          recoveryRoot
        })
      ) {
        continue
      }
      waitForRetry()
    }
  }
  throw new Error(`Timed out waiting for workspace bootstrap lock after ${timeoutMs}ms.`)
}
