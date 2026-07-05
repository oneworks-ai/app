#!/usr/bin/env node
import process from 'node:process'

import { parseRelayServerArgs, printRelayServerHelp, startRelayServer } from './server.js'

const args = parseRelayServerArgs(process.argv.slice(2))
if (args.help) {
  printRelayServerHelp()
  process.exit(0)
}

const runtime = startRelayServer(args)

runtime.server.on('error', error => {
  process.stderr.write(
    `[relay-server] server error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  )
})

process.on('SIGINT', () => {
  process.stderr.write('[relay-server] received SIGINT, shutting down.\n')
  runtime.server.close(() => process.exit(0))
})

process.on('SIGTERM', () => {
  process.stderr.write('[relay-server] received SIGTERM, shutting down.\n')
  runtime.server.close(() => process.exit(0))
})

process.on('uncaughtException', error => {
  process.stderr.write(`[relay-server] uncaught exception: ${error.stack ?? error.message}\n`)
  process.exit(1)
})

process.on('unhandledRejection', reason => {
  process.stderr.write(
    `[relay-server] unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}\n`
  )
  process.exit(1)
})
