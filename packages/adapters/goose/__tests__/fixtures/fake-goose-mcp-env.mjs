#!/usr/bin/env node
import { appendFileSync } from 'node:fs'

const outputPath = process.argv[2]
if (outputPath == null) process.exit(2)
const legacyCliLoaderEnv = ['__IS_', 'LOADER_CLI__'].join('')
const legacyHookLoaderEnv = ['__IS_', 'ONEWORKS_HOOK_LOADER__'].join('')

appendFileSync(
  outputPath,
  `${
    JSON.stringify({
      MCP_SCOPED_INPUT: process.env.MCP_SCOPED_INPUT,
      NODE_OPTIONS: process.env.NODE_OPTIONS,
      NODE_PATH: process.env.NODE_PATH,
      [legacyCliLoaderEnv]: process.env[legacyCliLoaderEnv],
      [legacyHookLoaderEnv]: process.env[legacyHookLoaderEnv],
      __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: process.env.__ONEWORKS_CLI_HELPER_LOADER_ACTIVE__,
      __ONEWORKS_HOOK_LOADER_ACTIVE__: process.env.__ONEWORKS_HOOK_LOADER_ACTIVE__,
      __ONEWORKS_PROJECT_REGISTER_LOADER__: process.env.__ONEWORKS_PROJECT_REGISTER_LOADER__
    })
  }\n`
)
