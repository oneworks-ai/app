import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateSessionRuntimeState: vi.fn()
}))

vi.mock('#~/db/index.js', () => ({
  getDb: () => ({ updateSessionRuntimeState: mocks.updateSessionRuntimeState })
}))

const tempDirectories: string[] = []

describe('session channel context path identity', () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    mocks.updateSessionRuntimeState.mockReset()
    await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('persists channel context under the exact whitespace-bearing server data directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-channel-context-'))
    tempDirectories.push(root)
    const adjacentDataDir = path.join(root, 'data')
    const dataDir = path.join(root, 'data ')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_DATA_DIR__', dataDir)
    const { writeChannelMessageContext } = await import('#~/services/session/channel-context.js')

    await writeChannelMessageContext('raw-session', {
      channelId: 'channel-1',
      channelType: 'lark',
      messageId: 'message-1'
    })

    const relativeContextPath = path.join('channel-memory', 'v1', 'runtime-context', 'raw-session.json')
    await expect(readFile(path.join(dataDir, relativeContextPath), 'utf8')).resolves.toContain('message-1')
    await expect(readFile(path.join(adjacentDataDir, relativeContextPath), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(mocks.updateSessionRuntimeState).toHaveBeenCalledWith(
      'raw-session',
      expect.objectContaining({
        channelActorSnapshot: expect.objectContaining({ messageId: 'message-1' })
      })
    )
  })
})
