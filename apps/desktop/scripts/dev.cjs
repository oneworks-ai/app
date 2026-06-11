#!/usr/bin/env node
const { spawn } = require('node:child_process')
const process = require('node:process')

const shouldOpenCurrentWorkspace = process.argv.includes('--workspace')
const env = { ...process.env }
const launchWorkspace = env.INIT_CWD?.trim() || process.cwd()

if (shouldOpenCurrentWorkspace) {
  env.ONEWORKS_DESKTOP_WORKSPACE = launchWorkspace
  delete env.ONEWORKS_DESKTOP_LAUNCH_MODE
} else if (env.ONEWORKS_DESKTOP_LAUNCH_MODE == null || env.ONEWORKS_DESKTOP_LAUNCH_MODE.trim() === '') {
  env.ONEWORKS_DESKTOP_LAUNCH_MODE = 'empty'
}

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const child = spawn(pnpmCommand, ['-C', 'apps/desktop', 'dev'], {
  env,
  stdio: 'inherit'
})

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

child.on('error', (error) => {
  console.error('[desktop:dev] failed to start:', error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal != null) {
    process.exit(1)
  }
  process.exit(code ?? 1)
})
