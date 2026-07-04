#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const startedAt = process.hrtime.bigint()
const logPath = process.env.CODEX_DEBUG_WRAPPER_LOG || resolve('/tmp', `codex-debug-wrapper-${process.pid}.log`)

const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1_000_000
const log = (event, data = {}) => {
  appendFileSync(
    logPath,
    `${
      JSON.stringify({
        elapsedMs: Number(elapsedMs().toFixed(1)),
        event,
        pid: process.pid,
        ppid: process.ppid,
        time: new Date().toISOString(),
        ...data
      })
    }\n`
  )
}

const normalizeNonEmptyString = value => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const candidateNativePaths = () => {
  const explicitPath = normalizeNonEmptyString(process.env.CODEX_DEBUG_WRAPPER_NATIVE_PATH)
  const paths = [
    explicitPath,
    '/opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'
  ].filter(Boolean)

  const managedWrapperPath = normalizeNonEmptyString(process.env.CODEX_DEBUG_WRAPPER_MANAGED_WRAPPER_PATH)
  if (managedWrapperPath != null) {
    paths.push(
      resolve(
        dirname(realpathSync(managedWrapperPath)),
        '..',
        'node_modules',
        '@openai',
        'codex-darwin-arm64',
        'vendor',
        'aarch64-apple-darwin',
        'codex',
        'codex'
      )
    )
    paths.push(
      resolve(
        dirname(realpathSync(managedWrapperPath)),
        '..',
        'node_modules',
        '@openai',
        'codex-darwin-arm64',
        'vendor',
        'aarch64-apple-darwin',
        'bin',
        'codex'
      )
    )
  }

  return paths
}

const nativePath = candidateNativePaths().find(candidate => existsSync(candidate))
if (nativePath == null) {
  log('native_missing', { candidates: candidateNativePaths() })
  throw new Error('Cannot resolve Codex native binary for debug wrapper.')
}

log('wrapper_start', {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  home: process.env.HOME,
  nativePath,
  logPath,
  homeOverride: normalizeNonEmptyString(process.env.CODEX_DEBUG_WRAPPER_HOME_OVERRIDE)
})

const homeOverride = normalizeNonEmptyString(process.env.CODEX_DEBUG_WRAPPER_HOME_OVERRIDE)
const child = spawn(nativePath, process.argv.slice(2), {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(homeOverride != null ? { HOME: homeOverride } : {}),
    CODEX_DEBUG_WRAPPER_PARENT_PID: String(process.pid)
  }
})

log('native_spawn_returned', { childPid: child.pid })
child.on('spawn', () => log('native_spawn_event', { childPid: child.pid }))
child.on('error', (err) => {
  log('native_error', { message: err.message, stack: err.stack })
  process.exit(1)
})

const forwardSignal = signal => {
  log('forward_signal', { signal, childPid: child.pid })
  if (child.killed) return
  try {
    child.kill(signal)
  } catch {
    // best effort
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => forwardSignal(signal))
}

const childResult = await new Promise(resolveResult => {
  child.on('exit', (code, signal) => {
    log('native_exit', { childPid: child.pid, code, signal })
    resolveResult(signal == null ? { type: 'code', exitCode: code ?? 1 } : { type: 'signal', signal })
  })
})

if (childResult.type === 'signal') {
  log('wrapper_exit_signal', { signal: childResult.signal })
  process.kill(process.pid, childResult.signal)
} else {
  log('wrapper_exit_code', { exitCode: childResult.exitCode })
  process.exit(childResult.exitCode)
}
