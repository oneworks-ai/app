#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import process from 'node:process'

let release
if (process.env.ONEWORKS_CROSS_PROCESS_LOCK_PATH) {
  const { default: lockfile } = await import('proper-lockfile')
  const timeoutMs = Number(process.env.ONEWORKS_CROSS_PROCESS_LOCK_TIMEOUT_MS) || 5_000
  release = await lockfile.lock(process.env.ONEWORKS_CROSS_PROCESS_LOCK_PATH, {
    realpath: false,
    retries: {
      factor: 1,
      maxTimeout: 50,
      minTimeout: 50,
      randomize: false,
      retries: Math.ceil(timeoutMs / 50)
    },
    stale: 5_000,
    update: 1_000
  })
}

const input = JSON.parse(readFileSync(0, 'utf8'))
let current
try {
  current = JSON.parse(readFileSync(input.path, 'utf8'))
} catch {}

const expected = input.expected
const matches = expected == null || (
  current != null &&
  (expected.generation == null || current.generation === expected.generation) &&
  (expected.operationId == null || current.operation?.id === expected.operationId) &&
  (expected.phase == null || current.phase === expected.phase) &&
  (expected.revision == null || current.revision === expected.revision) &&
  (expected.servicePid == null || current.servicePid === expected.servicePid)
)

if (!matches) {
  process.stdout.write(`${JSON.stringify({ matched: false })}\n`)
  await release?.()
  process.exit(0)
}

const value = input.mode === 'merge' ? { ...current, ...input.value } : input.value
for (const key of input.clear ?? []) delete value[key]
const next = {
  ...value,
  revision: Math.max(current?.revision ?? 0, value.revision ?? 0) + 1,
  root: input.root,
  schemaVersion: 2,
  scope: input.scope,
  target: input.target,
  updatedAt: new Date().toISOString()
}
const tempPath = `${input.path}.tmp-${process.pid}-${randomUUID()}`
writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`)
renameSync(tempPath, input.path)
process.stdout.write(`${JSON.stringify({ matched: true, state: next })}\n`)
await release?.()
