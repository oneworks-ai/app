import type { ChildProcess } from 'node:child_process'
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
  timeoutMs = SERVER_STOP_TIMEOUT_MS
) => {
  if (child == null || child.exitCode != null || child.signalCode != null) {
    return
  }

  const runningChild: ChildProcess = child
  runningChild.kill('SIGTERM')
  const exitedAfterSigterm = await waitForChildExit(runningChild, timeoutMs)
  if (exitedAfterSigterm) {
    return
  }

  runningChild.kill('SIGKILL')
  await waitForChildExit(runningChild, timeoutMs)
}
