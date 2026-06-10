#!/usr/bin/env node
import process from 'node:process'

import { parseRelayServerArgs, printRelayServerHelp, startRelayServer } from './server.js'

const args = parseRelayServerArgs(process.argv.slice(2))
if (args.help) {
  printRelayServerHelp()
  process.exit(0)
}

startRelayServer(args)
