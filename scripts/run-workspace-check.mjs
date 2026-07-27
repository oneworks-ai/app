#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { ensureWorkspaceDependencies } from './workspace-dependency-bootstrap.mjs'

const parseArguments = (args) => {
  const separatorIndex = args.indexOf('--')
  if (separatorIndex < 0 || separatorIndex === args.length - 1) {
    throw new Error('Usage: run-workspace-check.mjs [--require-bin <name>] -- <command> [...args]')
  }
  const requiredBins = []
  for (let index = 0; index < separatorIndex; index += 1) {
    if (args[index] !== '--require-bin' || index + 1 >= separatorIndex) {
      throw new Error(`Unknown workspace check argument: ${args[index]}`)
    }
    requiredBins.push(args[index + 1])
    index += 1
  }
  return {
    command: args.slice(separatorIndex + 1),
    requiredBins
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const { command, requiredBins } = parseArguments(process.argv.slice(2))
const bootstrap = ensureWorkspaceDependencies({ repoRoot, requiredBins })
if (bootstrap.error != null) throw bootstrap.error
if (bootstrap.status !== 0) process.exit(bootstrap.status ?? 1)

const result = spawnSync(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit'
})
if (result.error != null) throw result.error
process.exit(result.status ?? 1)
