#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SOURCE_CONDITION_ARG = '--conditions=__oneworks__'
const SOURCE_CONDITION_REEXEC_ENV = '__ONEWORKS_RUN_TOOLS_SOURCE_CONDITION__'
const BOOTSTRAP_LOCK_HELD_ENV = '__ONEWORKS_RUN_TOOLS_BOOTSTRAP_LOCK_HELD__'
const BOOTSTRAP_ONLY_ENV = '__ONEWORKS_RUN_TOOLS_BOOTSTRAP_ONLY__'
const machineJsonOutput = process.argv.includes('dev-service') && process.argv.includes('--json')
const require = createRequire(import.meta.url)

if (!process.execArgv.includes(SOURCE_CONDITION_ARG)) {
  const result = spawnSync(
    process.execPath,
    [
      SOURCE_CONDITION_ARG,
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2)
    ],
    {
      env: {
        ...process.env,
        [SOURCE_CONDITION_REEXEC_ENV]: '1'
      },
      stdio: 'inherit'
    }
  )
  process.exit(result.status ?? 1)
}

const isMissingRegister = (error) => {
  if (error == null || typeof error !== 'object') return false
  const code = 'code' in error ? error.code : undefined
  const message = 'message' in error ? String(error.message) : ''
  return (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') && message.includes('esbuild-register')
}

const printBootstrapError = (message) => {
  process.stdout.write(`${
    JSON.stringify(
      {
        error: { message },
        ok: false,
        protocol: 'oneworks.dev-service-error',
        version: 1
      },
      null,
      2
    )
  }\n`)
}

const acquireFallbackBootstrapLock = (path, timeoutMs = 120_000) => {
  const lockPath = `${path}.dir`
  const ownerPath = resolve(lockPath, 'owner.json')
  const token = randomUUID()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockPath)
      writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token }))
      return () => {
        try {
          if (JSON.parse(readFileSync(ownerPath, 'utf8')).token === token) {
            rmSync(lockPath, { force: true, recursive: true })
          }
        } catch {}
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const ownerPid = JSON.parse(readFileSync(ownerPath, 'utf8')).pid
        process.kill(ownerPid, 0)
      } catch {
        let oldEnoughForRecovery = false
        try {
          oldEnoughForRecovery = Date.now() - statSync(lockPath).mtimeMs > 2_000
        } catch {}
        if (oldEnoughForRecovery) {
          rmSync(lockPath, { force: true, recursive: true })
          continue
        }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
    }
  }
  throw new Error(`Timed out waiting for workspace bootstrap lock after ${timeoutMs}ms.`)
}

const registerResolvable = () => {
  try {
    require.resolve('esbuild-register/dist/node')
    return true
  } catch {
    return false
  }
}

const runWorkspaceDependencyInstall = () =>
  spawnSync('pnpm', ['install'], {
    env: process.env,
    stdio: machineJsonOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  })

const finishWorkspaceDependencyInstall = (result) => {
  if (result.error == null && result.status === 0) return true
  if (machineJsonOutput) {
    printBootstrapError(`Workspace dependency bootstrap failed (status=${result.status ?? 'unknown'}).`)
  }
  if (result.error != null && !machineJsonOutput) throw result.error
  process.exit(result.status ?? 1)
}

const installWorkspaceDependencies = () => {
  if (process.env[BOOTSTRAP_LOCK_HELD_ENV] !== '1') {
    const lockDir = resolve(process.cwd(), '.logs')
    const lockPath = resolve(lockDir, 'run-tools-bootstrap.guard')
    mkdirSync(lockDir, { recursive: true })
    const command = process.platform === 'darwin' ? '/usr/bin/lockf' : process.platform === 'linux' ? 'flock' : null
    if (command != null) {
      const lockArgs = process.platform === 'darwin'
        ? ['-k', '-t', '120', lockPath]
        : ['-w', '120', lockPath]
      const result = spawnSync(
        command,
        [...lockArgs, process.execPath, ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
        {
          env: {
            ...process.env,
            [BOOTSTRAP_LOCK_HELD_ENV]: '1',
            [BOOTSTRAP_ONLY_ENV]: '1'
          },
          stdio: machineJsonOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
        }
      )
      if (machineJsonOutput && result.stdout != null && result.stdout.length > 0) {
        process.stdout.write(result.stdout)
      }
      if (result.error != null || result.status !== 0) {
        if (machineJsonOutput && (result.stdout == null || result.stdout.length === 0)) {
          printBootstrapError(`Workspace bootstrap guard failed (status=${result.status ?? 'unknown'}).`)
        }
        if (result.error != null && !machineJsonOutput) throw result.error
        process.exit(result.status ?? 1)
      }
      return true
    }
    const release = acquireFallbackBootstrapLock(lockPath)
    let result
    try {
      if (registerResolvable()) return true
      if (!machineJsonOutput) console.error('[tools] esbuild-register is missing; running pnpm install')
      result = runWorkspaceDependencyInstall()
    } finally {
      release()
    }
    return finishWorkspaceDependencyInstall(result)
  }
  if (!machineJsonOutput) console.error('[tools] esbuild-register is missing; running pnpm install')
  return finishWorkspaceDependencyInstall(runWorkspaceDependencyInstall())
}

const loadRegister = async () => {
  try {
    return await import('esbuild-register/dist/node')
  } catch (error) {
    if (!isMissingRegister(error) || !installWorkspaceDependencies()) throw error
    return await import('esbuild-register/dist/node')
  }
}

const { register } = await loadRegister()

if (process.env[BOOTSTRAP_ONLY_ENV] === '1') process.exit(0)

register({
  target: `node${process.version.slice(1)}`,
  hookIgnoreNodeModules: false
})

const { runScriptsCli } = require('./cli.ts')

await runScriptsCli(process.argv)
