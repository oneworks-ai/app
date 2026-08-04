import { execFile as execFileCallback } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

type RunMacosWindowAction = (
  action: string,
  options: { signal?: AbortSignal; timeoutMs: number }
) => Promise<void>

const abortError = () => new Error('macOS window activation was aborted.')

const sleep = async (ms: number, signal?: AbortSignal) => {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError())
      return
    }
    const onAbort = () => {
      clearTimeout(timeout)
      reject(abortError())
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export const buildMacosWindowRaiseActions = (ownerPid: number) => {
  const processSelector = `first application process whose unix id is ${ownerPid}`
  return [
    `tell application "System Events" to set frontmost of ${processSelector} to true`,
    `tell application "System Events" to tell ${processSelector} to tell window 1 to perform action "AXRaise"`,
    `tell application "System Events" to tell ${processSelector} to tell window 1 to set value of attribute "AXMain" to true`,
    `tell application "System Events" to tell ${processSelector} to tell window 1 to set value of attribute "AXFocused" to true`
  ]
}

export const raiseMacosWindow = async (input: {
  context: string
  now?: () => number
  ownerPid: number
  pollMs?: number
  runAction?: RunMacosWindowAction
  signal?: AbortSignal
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  waitMs?: number
}) => {
  if (process.platform !== 'darwin') return
  const ensureNotAborted = () => {
    if (input.signal?.aborted === true) throw abortError()
  }
  const now = input.now ?? Date.now
  const runAction: RunMacosWindowAction = input.runAction ?? (async (action, options) => {
    await execFile('osascript', ['-e', action], {
      signal: options.signal,
      timeout: options.timeoutMs
    })
  })
  const wait = input.sleep ?? sleep
  const actions = buildMacosWindowRaiseActions(input.ownerPid)
  const startedAt = now()
  const waitMs = Math.max(0, Math.min(input.waitMs ?? 30_000, 30_000))
  const deadline = startedAt + waitMs
  let lastError: unknown
  ensureNotAborted()
  while (now() < deadline) {
    try {
      for (const action of actions) {
        ensureNotAborted()
        const remainingMs = deadline - now()
        if (remainingMs <= 0) throw new Error('macOS window activation timed out.')
        await runAction(action, {
          signal: input.signal,
          timeoutMs: Math.min(3_000, remainingMs)
        })
        if (now() > deadline) throw new Error('macOS window activation timed out.')
      }
      return
    } catch (error) {
      ensureNotAborted()
      lastError = error
      const remainingMs = deadline - now()
      if (remainingMs <= 0) break
      await wait(Math.min(input.pollMs ?? 100, remainingMs), input.signal)
    }
  }
  throw new Error(`Could not raise macOS window for ${input.context} (pid ${input.ownerPid}).`, {
    cause: lastError
  })
}
