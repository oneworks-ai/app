#!/usr/bin/env node
import process from 'node:process'

let release
if (process.env.ONEWORKS_CROSS_PROCESS_LOCK_PATH) {
  const { default: lockfile } = await import('proper-lockfile')
  const timeoutMs = Number(process.env.ONEWORKS_CROSS_PROCESS_LOCK_TIMEOUT_MS) || 120_000
  release = await lockfile.lock(process.env.ONEWORKS_CROSS_PROCESS_LOCK_PATH, {
    realpath: false,
    retries: {
      factor: 1,
      maxTimeout: 200,
      minTimeout: 200,
      randomize: false,
      retries: Math.ceil(timeoutMs / 200)
    },
    stale: 5_000,
    update: 1_000
  })
}

process.stdout.write('READY\n')
process.stdin.resume()
await new Promise(resolve => {
  process.stdin.once('end', resolve)
  process.stdin.once('error', resolve)
})
await release?.()
