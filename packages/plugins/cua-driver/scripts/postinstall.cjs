#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const process = require('node:process')

const packageRoot = resolve(__dirname, '..')
const wrapperPath = join(packageRoot, 'bin', 'cua-driver.cjs')
const appBinaryPath = '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'

const skip = process.env.ONEWORKS_CUA_DRIVER_SKIP_POSTINSTALL === '1' ||
  process.env.CUA_DRIVER_SKIP_POSTINSTALL === '1'

if (skip || process.platform !== 'darwin' || process.env.CI != null) {
  process.exit(0)
}

if (existsSync(appBinaryPath)) {
  process.exit(0)
}

const result = spawnSync(process.execPath, [wrapperPath, 'install', '--no-modify-path'], {
  stdio: 'inherit'
})

if (result.status !== 0) {
  console.warn('[cua-driver] postinstall could not install CuaDriver.app.')
  console.warn('[cua-driver] Retry manually with: ow-cua-driver ensure')
}

process.exit(0)
