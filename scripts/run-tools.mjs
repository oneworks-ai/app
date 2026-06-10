#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SOURCE_CONDITION_ARG = '--conditions=__oneworks__'
const SOURCE_CONDITION_REEXEC_ENV = '__ONEWORKS_RUN_TOOLS_SOURCE_CONDITION__'

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

const installWorkspaceDependencies = () => {
  console.error('[tools] esbuild-register is missing; running pnpm install')
  const result = spawnSync('pnpm', ['install'], {
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error != null) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  return true
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

register({
  target: `node${process.version.slice(1)}`,
  hookIgnoreNodeModules: false
})

const require = createRequire(import.meta.url)
const { runScriptsCli } = require('./cli.ts')

await runScriptsCli(process.argv)
