import type { ChildProcess } from 'node:child_process'
import process from 'node:process'
import type { Writable } from 'node:stream'

import { SERVER_STOP_TIMEOUT_MS } from './constants'

export const writeProcessLine = (stream: Writable, message: unknown) => {
  stream.write(`${String(message).replace(/[\r\n]+$/gu, '')}\n`)
}

export const writePrefixedChunk = (stream: Writable, prefix: string, chunk: unknown) => {
  const output = String(chunk).replace(/[\r\n]+$/gu, '')
  if (output === '') {
    return
  }

  for (const line of output.split(/\r?\n/u)) {
    writeProcessLine(stream, `${prefix}${line}`)
  }
}

export const waitForChildExit = (child: ChildProcess | undefined, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    if (child == null || child.exitCode != null || child.signalCode != null) {
      resolve(true)
      return
    }

    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)

    function onExit() {
      clearTimeout(timer)
      resolve(true)
    }

    child.once('exit', onExit)
  })

export const isChildProcessRunning = (child: ChildProcess | undefined) => (
  child != null && child.exitCode == null && child.signalCode == null
)

export const killChildProcess = async (
  child: ChildProcess | undefined,
  options: { killProcessGroup?: boolean; timeoutMs?: number } = {}
) => {
  const timeoutMs = options.timeoutMs ?? SERVER_STOP_TIMEOUT_MS
  const signalProcessGroup = (signal: NodeJS.Signals) => {
    if (options.killProcessGroup !== true || process.platform === 'win32' || child?.pid == null) return
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  if (child == null || child.exitCode != null || child.signalCode != null) {
    signalProcessGroup('SIGTERM')
    return
  }

  const runningChild: ChildProcess = child
  runningChild.kill('SIGTERM')
  const exitedAfterSigterm = await waitForChildExit(runningChild, timeoutMs)
  if (exitedAfterSigterm) {
    signalProcessGroup('SIGTERM')
    return
  }

  if (options.killProcessGroup === true && process.platform !== 'win32') signalProcessGroup('SIGKILL')
  else runningChild.kill('SIGKILL')
  const exitedAfterSigkill = await waitForChildExit(runningChild, timeoutMs)
  if (!exitedAfterSigkill) {
    throw new Error(`Child process pid=${runningChild.pid ?? 'unknown'} did not exit after SIGKILL.`)
  }
}
