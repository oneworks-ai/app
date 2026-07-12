import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { accessSync, constants, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import process from 'node:process'

import type { CommandResult, RunCommandOptions } from './types.js'

export const appBinaryPath = '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
const userBinaryPath = join(homedir(), '.local', 'bin', 'cua-driver')
const maxOutputChars = 256 * 1024
const defaultCommandTimeoutMs = 120_000

export const safeRealpath = (filePath: string) => {
  try {
    return realpathSync(filePath)
  } catch {
    return resolve(filePath)
  }
}

export const isExecutable = (filePath: string) => {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const appendOutput = (current: string, chunk: Buffer) => {
  const next = `${current}${chunk.toString('utf8')}`
  return next.length > maxOutputChars ? next.slice(-maxOutputChars) : next
}

const findOnPath = (name: string, env: NodeJS.ProcessEnv = process.env) => {
  for (const entry of (env.PATH ?? '').split(delimiter)) {
    if (entry.trim() === '') continue
    const candidate = resolve(process.cwd(), entry, name)
    if (!isExecutable(candidate)) continue
    if (candidate.replaceAll('\\', '/').includes('/node_modules/.bin/')) continue
    return candidate
  }
  return undefined
}

export const resolveDriverBinary = (env: NodeJS.ProcessEnv = process.env) => {
  for (const candidate of [appBinaryPath, userBinaryPath, findOnPath('cua-driver', env)]) {
    if (candidate != null && isExecutable(candidate)) return candidate
  }
  return undefined
}

export const runCommand = (command: string, args: string[], options: RunCommandOptions = {}) =>
  new Promise<CommandResult>((resolveResult) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, options.timeoutMs ?? defaultCommandTimeoutMs)

    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveResult(result)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk)
    })
    child.once('error', error => {
      finish({
        ok: false,
        error: error.message,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut
      })
    })
    child.once('close', (exitCode, signal) => {
      finish({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut
      })
    })
  })
