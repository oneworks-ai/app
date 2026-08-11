import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import process from 'node:process'
import type { Writable } from 'node:stream'

import { SERVER_STOP_TIMEOUT_MS } from './constants'

const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES = 1024 * 1024

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

interface OwnedChildCommandInput {
  args: string[]
  description: string
  env: NodeJS.ProcessEnv
  executable: string
  outputLimitBytes?: number
  signal: AbortSignal
}

const createAbortError = (description: string) => {
  const error = new Error(`${description} was aborted.`)
  error.name = 'AbortError'
  return error
}

export const runOwnedChildCommand = ({
  args,
  description,
  env,
  executable,
  outputLimitBytes = DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES,
  signal
}: OwnedChildCommandInput) =>
  new Promise<{ stderr: string; stdout: string }>((resolve, reject) => {
    let child: ChildProcess | undefined
    let outputError: unknown
    let stderr = ''
    let stdout = ''
    let settled = false

    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', handleAbort)
      if (error != null) {
        reject(error)
        return
      }
      resolve({ stderr, stdout })
    }

    const stopChild = () => {
      void killChildProcess(child, { killProcessGroup: true })
        .catch(error => finish(error))
    }

    const handleAbort = () => {
      stopChild()
    }

    const appendOutput = (current: string, chunk: unknown) => {
      const next = current + String(chunk)
      if (Buffer.byteLength(next) > outputLimitBytes) {
        throw new Error(`${description} exceeded its output limit.`)
      }
      return next
    }

    if (signal.aborted) {
      finish(createAbortError(description))
      return
    }

    child = spawn(executable, args, {
      detached: process.platform !== 'win32',
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    signal.addEventListener('abort', handleAbort, { once: true })
    child.stdout?.on('data', (chunk) => {
      if (outputError != null) return
      try {
        stdout = appendOutput(stdout, chunk)
      } catch (error) {
        outputError = error
        stopChild()
      }
    })
    child.stderr?.on('data', (chunk) => {
      if (outputError != null) return
      try {
        stderr = appendOutput(stderr, chunk)
      } catch (error) {
        outputError = error
        stopChild()
      }
    })
    child.once('error', error => finish(error))
    child.once('close', (code, childSignal) => {
      if (signal.aborted) {
        finish(createAbortError(description))
        return
      }
      if (outputError != null) {
        finish(outputError)
        return
      }
      if (code !== 0) {
        const detail = stderr.trim()
        finish(
          new Error(
            `${description} exited with ${code ?? childSignal ?? 'unknown'}${detail === '' ? '' : `: ${detail}`}`
          )
        )
        return
      }
      finish()
    })
  })
