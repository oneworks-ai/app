import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { accessSync, constants, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import process from 'node:process'

import type { CommandResult, CuaPluginContext, RunCommandOptions } from './types.js'

const appBinaryPath = '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
const userBinaryPath = join(homedir(), '.local', 'bin', 'cua-driver')
const maxOutputChars = 256 * 1024
const defaultCommandTimeoutMs = 120_000
const defaultStatusTimeoutMs = 5_000

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const safeRealpath = (filePath: string) => {
  try {
    return realpathSync(filePath)
  } catch {
    return resolve(filePath)
  }
}

const isExecutable = (filePath: string) => {
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

const readBoolean = (value: unknown, fallback: boolean) => (
  typeof value === 'boolean' ? value : fallback
)

const readNumber = (value: unknown, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
)

const clampTimeoutMs = (value: unknown) => {
  const normalized = Math.trunc(readNumber(value, defaultCommandTimeoutMs))
  return Math.max(10_000, Math.min(normalized, 600_000))
}

export const parseEnsureRecovery = (result: Pick<CommandResult, 'stderr' | 'stdout'>) => {
  const output = `${result.stdout}\n${result.stderr}`
  const permissionLine = output
    .split(/\r?\n/)
    .find(line => line.includes('[cua-driver] permission-required:'))
  if (permissionLine != null) {
    const missingPermissions = permissionLine
      .slice(permissionLine.indexOf(':') + 1)
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
    return {
      kind: 'macos-permissions' as const,
      missingPermissions,
      settingsPath: 'System Settings → Privacy & Security',
      retryOriginalTask: true
    }
  }
  if (output.includes('[cua-driver] permission-check-failed:')) {
    return {
      kind: 'runtime-retry' as const,
      retryOriginalTask: true
    }
  }
  return undefined
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

const resolveDriverBinary = (env: NodeJS.ProcessEnv = process.env) => {
  for (const candidate of [appBinaryPath, userBinaryPath, findOnPath('cua-driver', env)]) {
    if (candidate != null && isExecutable(candidate)) return candidate
  }
  return undefined
}

const runCommand = (command: string, args: string[], options: RunCommandOptions = {}) =>
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

const resolveWrapperPath = (ctx: CuaPluginContext) => join(ctx.pluginRoot, 'bin', 'cua-driver.cjs')

export const getDriverStatus = async (payload: unknown = {}) => {
  const source = isRecord(payload) ? payload : {}
  const driverPath = resolveDriverBinary()
  const checkDaemon = readBoolean(source.checkDaemon, true)
  const daemon = driverPath != null && checkDaemon
    ? await runCommand(driverPath, ['status'], {
      env: process.env,
      timeoutMs: defaultStatusTimeoutMs
    })
    : undefined

  return {
    ok: true,
    platform: process.platform,
    appInstalled: isExecutable(appBinaryPath),
    driverPath,
    driverRealPath: driverPath == null ? undefined : safeRealpath(driverPath),
    needsInstall: driverPath == null,
    daemon: daemon == null
      ? undefined
      : {
        running: daemon.ok,
        exitCode: daemon.exitCode,
        signal: daemon.signal,
        stdout: daemon.stdout,
        stderr: daemon.stderr,
        timedOut: daemon.timedOut
      }
  }
}

const readEnsureOptions = (ctx: CuaPluginContext, payload: unknown) => {
  const source = isRecord(payload) ? payload : {}
  return {
    startDaemon: readBoolean(
      source.startDaemon,
      readBoolean(ctx.options.autoStartDaemon, true)
    ),
    promptForPermissions: readBoolean(
      source.promptForPermissions,
      readBoolean(ctx.options.promptForPermissions, true)
    ),
    timeoutMs: clampTimeoutMs(source.timeoutMs ?? ctx.options.commandTimeoutMs)
  }
}

export const ensureDriver = async (ctx: CuaPluginContext, payload: unknown = {}) => {
  const options = readEnsureOptions(ctx, payload)
  const args = ['ensure']
  if (!options.startDaemon) args.push('--no-daemon')
  if (!options.promptForPermissions) args.push('--no-permissions')

  const result = await runCommand(process.execPath, [resolveWrapperPath(ctx), ...args], {
    cwd: ctx.workspaceFolder || ctx.projectHome || ctx.pluginRoot,
    env: process.env,
    timeoutMs: options.timeoutMs
  })
  return {
    ...result,
    command: 'ensure',
    recovery: parseEnsureRecovery(result),
    startDaemon: options.startDaemon,
    promptForPermissions: options.promptForPermissions
  }
}
