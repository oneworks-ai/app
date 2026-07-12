const { createHash } = require('node:crypto')
const { mkdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const process = require('node:process')
const lockfile = require('proper-lockfile')

const lockRoot = join(tmpdir(), `oneworks-cua-locks-${process.getuid?.() ?? 'unknown'}`)

function lockPath(key) {
  const identity = createHash('sha256').update(String(key)).digest('hex')
  return join(lockRoot, identity)
}

async function withFileLock(task, options) {
  await mkdir(lockRoot, { recursive: true, mode: 0o700 })
  let release
  try {
    release = await lockfile.lock(lockPath(options.key), {
      realpath: false,
      retries: {
        factor: 1,
        maxTimeout: options.pollMs ?? 25,
        minTimeout: options.pollMs ?? 25,
        randomize: false,
        retries: Math.ceil(options.timeoutMs / (options.pollMs ?? 25))
      },
      stale: options.staleMs ?? 30_000,
      update: options.updateMs ?? 10_000
    })
  } catch (cause) {
    const error = new Error(options.timeoutMessage, { cause })
    error.code = options.timeoutCode
    throw error
  }
  try {
    return await task()
  } finally {
    await release()
  }
}

module.exports = { lockPath, withFileLock }
