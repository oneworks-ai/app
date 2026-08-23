#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { ensureWorkspaceDependencies } from './workspace-dependency-bootstrap.mjs'

const SOURCE_CONDITION_ARG = '--conditions=__oneworks__'
const SOURCE_CONDITION_REEXEC_ENV = '__ONEWORKS_RUN_TOOLS_SOURCE_CONDITION__'
const machineJsonOutput = process.argv.includes('--json')
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

const requiredWorkspaceSubmodules = [
  {
    path: 'assets/avatar',
    requiredPath: 'assets/avatar/packages/avatar/package.json'
  },
  {
    path: 'assets/demo-video',
    requiredPath: 'assets/demo-video/src/commands.ts'
  }
]

const finishWorkspaceDependencyInstall = (result) => {
  if (result.error == null && result.status === 0) return true
  if (machineJsonOutput) {
    printBootstrapError(`Workspace dependency bootstrap failed (status=${result.status ?? 'unknown'}).`)
  }
  if (result.error != null && !machineJsonOutput) throw result.error
  process.exit(result.status ?? 1)
}

const installWorkspaceDependencies = () =>
  finishWorkspaceDependencyInstall(
    ensureWorkspaceDependencies({
      quiet: machineJsonOutput,
      repoRoot: process.cwd(),
      requiredPaths: [
        'node_modules/esbuild-register/package.json',
        'node_modules/esbuild-register/dist/node.js'
      ],
      requiredSubmodules: requiredWorkspaceSubmodules
    })
  )

const loadRegister = async () => {
  try {
    return await import('esbuild-register/dist/node')
  } catch (error) {
    if (!isMissingRegister(error) || !installWorkspaceDependencies()) throw error
    return await import('esbuild-register/dist/node')
  }
}

installWorkspaceDependencies()

const { register } = await loadRegister()

register({
  target: `node${process.version.slice(1)}`,
  hookIgnoreNodeModules: false
})

const { runScriptsCli } = require('./cli.ts')

await runScriptsCli(process.argv)
