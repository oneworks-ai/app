import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

const lockInvocation = (
  path: string,
  timeoutMs: number,
  command: string,
  args: string[]
) => {
  const timeoutSeconds = String(Math.max(1, Math.ceil(timeoutMs / 1_000)))
  if (process.platform === 'darwin') {
    return {
      args: ['-k', '-t', timeoutSeconds, path, command, ...args],
      command: '/usr/bin/lockf',
      env: undefined
    }
  }
  if (process.platform === 'linux') {
    return {
      args: ['-w', timeoutSeconds, path, command, ...args],
      command: 'flock',
      env: undefined
    }
  }
  return {
    args,
    command,
    env: {
      ...process.env,
      ONEWORKS_CROSS_PROCESS_LOCK_PATH: path,
      ONEWORKS_CROSS_PROCESS_LOCK_TIMEOUT_MS: String(timeoutMs)
    }
  }
}

const waitForExit = async (child: ChildProcess) => {
  if (child.exitCode != null || child.signalCode != null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  return await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

const waitForHolder = async (child: ChildProcess, timeoutMs: number) => {
  await new Promise<void>((resolve, reject) => {
    let stderr = ''
    let stdout = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Timed out waiting for cross-process lock after ${timeoutMs}ms.`))
    }, timeoutMs + 1_000)
    const cleanup = () => clearTimeout(timeout)
    child.stderr?.on('data', chunk => {
      stderr += String(chunk)
    })
    child.stdout?.on('data', chunk => {
      stdout += String(chunk)
      if (!stdout.includes('READY\n')) return
      cleanup()
      resolve()
    })
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code) => {
      if (stdout.includes('READY\n')) return
      cleanup()
      reject(new Error(stderr.trim() || `Lock holder exited with status ${code ?? 'unknown'}.`))
    })
  })
}

export const withCrossProcessLock = async <T>(
  path: string,
  run: (lock: { holderPid: number }) => Promise<T>,
  timeoutMs = 120_000
) => {
  mkdirSync(dirname(path), { recursive: true })
  const invocation = lockInvocation(path, timeoutMs, process.execPath, [join(__dirname, 'lock-holder.mjs')])
  const holder = spawn(invocation.command, invocation.args, {
    env: invocation.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  await waitForHolder(holder, timeoutMs)
  if (holder.pid == null) throw new Error('Cross-process lock holder did not receive a process id.')
  let releaseRequested = false
  holder.once('exit', (code, signal) => {
    if (releaseRequested) return
    process.stderr.write(
      `[dev-service] fatal: cross-process lock was lost unexpectedly ` +
        `(status=${code ?? 'unknown'}, signal=${signal ?? 'none'}).\n`
    )
    // Continuing the callback after the kernel released the lock could allow a
    // second coordinator to mutate the same service. This process is scoped to
    // one CLI operation, so fail closed immediately instead of running unlocked.
    process.exit(70)
  })
  let callbackResult: T | undefined
  let callbackError: unknown
  let callbackFailed = false
  try {
    callbackResult = await run({ holderPid: holder.pid })
  } catch (error) {
    callbackError = error
    callbackFailed = true
  }
  releaseRequested = true
  holder.stdin?.end()
  let result
  try {
    result = await waitForExit(holder)
  } catch (releaseError) {
    if (callbackFailed) {
      throw new AggregateError([callbackError, releaseError], 'Operation and lock release both failed.')
    }
    throw releaseError
  }
  if (result.code !== 0) {
    const releaseError = new Error(
      `Cross-process lock holder failed during release ` +
        `(status=${result.code ?? 'unknown'}, signal=${result.signal ?? 'none'}).`
    )
    if (callbackFailed) {
      throw new AggregateError([callbackError, releaseError], 'Operation and lock release both failed.')
    }
    throw releaseError
  }
  if (callbackFailed) throw callbackError
  return callbackResult as T
}

export const runWithCrossProcessLockSync = ({
  args,
  command,
  input,
  path,
  timeoutMs = 5_000
}: {
  args: string[]
  command: string
  input: string
  path: string
  timeoutMs?: number
}) => {
  mkdirSync(dirname(path), { recursive: true })
  const invocation = lockInvocation(path, timeoutMs, command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    env: invocation.env,
    input,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (result.error != null) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `Lock command exited with status ${result.status ?? 'unknown'}.`)
  }
  return result.stdout ?? ''
}
