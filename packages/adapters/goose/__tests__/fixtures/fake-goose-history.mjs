#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
if (args.join(' ') === 'session list --format json') {
  process.stdout.write(readFileSync(resolve(fixtureDir, 'history-list.json'), 'utf8'))
} else if (
  args[0] === 'session' && args[1] === 'export' && args[2] === '--session-id' &&
  args[3] === '20260813_120000' && args[4] === '--format' && args[5] === 'json'
) {
  process.stdout.write(readFileSync(resolve(fixtureDir, 'history-export.json'), 'utf8'))
} else {
  process.stderr.write(`unexpected public Goose history command: ${args.join(' ')}\n`)
  process.exit(2)
}
