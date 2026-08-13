import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const tempDirectories: string[] = []

describe('server logger path identity', () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.resetModules()
    await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('writes into the exact whitespace-bearing log directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-server-logger-'))
    tempDirectories.push(root)
    const adjacentLogDir = path.join(root, 'logs')
    const logDir = path.join(root, 'logs ')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_LOG_DIR__', logDir)
    const { getSessionLogger } = await import('#~/utils/logger.js')

    getSessionLogger('raw-session', 'server').info({ marker: 'raw-log-path' }, 'raw log directory')

    await expect(readFile(path.join(logDir, 'raw-session', 'server.log.jsonl'), 'utf8')).resolves.toContain(
      'raw-log-path'
    )
    await expect(readFile(path.join(adjacentLogDir, 'raw-session', 'server.log.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
