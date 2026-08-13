import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  loadChannelLinks: vi.fn(),
  loadChannelModule: vi.fn(),
  migrateLegacyChannelIdentityNamespace: vi.fn(),
  sendFileMessage: vi.fn(),
  sendMediaMessage: vi.fn()
}))

vi.mock('#~/channels/loader.js', () => ({
  loadChannelModule: mocks.loadChannelModule
}))

vi.mock('#~/services/channel-links/index.js', () => ({
  loadChannelLinks: mocks.loadChannelLinks
}))

vi.mock('#~/db/index.js', () => ({
  getDb: () => ({
    commitChannelWebhookNonce: vi.fn(),
    migrateLegacyChannelIdentityNamespace: mocks.migrateLegacyChannelIdentityNamespace,
    releaseChannelWebhookNonce: vi.fn(),
    reserveChannelWebhookNonce: vi.fn(() => true)
  })
}))

describe('channel send filesystem path identity', () => {
  let baseUrl = ''
  let manager: { closeAll: () => Promise<void> } | undefined
  let root = ''
  let server: http.Server | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.loadChannelLinks.mockResolvedValue([])
    mocks.migrateLegacyChannelIdentityNamespace.mockReturnValue({})
    mocks.sendFileMessage.mockResolvedValue({ messageId: 'file-message' })
    mocks.sendMediaMessage.mockResolvedValue({ messageId: 'media-message' })
    mocks.loadChannelModule.mockReturnValue({
      definition: { configSchema: z.object({ type: z.literal('fixture') }) },
      create: vi.fn().mockResolvedValue({
        sendFileMessage: mocks.sendFileMessage,
        sendMediaMessage: mocks.sendMediaMessage
      })
    })
    root = await mkdtemp(path.join(tmpdir(), 'ow-channel-send-raw-path-'))

    const { initChannels } = await import('#~/channels/index.js')
    manager = await initChannels([{
      source: 'project',
      config: { channels: { outbound: { type: 'fixture' } } }
    }])
    const { channelSendRouter } = await import('#~/routes/channel-send.js')
    const app = new Koa()
    const mounted = new Router()
    app.use(bodyParser())
    mounted.use('/api/channels', channelSendRouter().routes())
    app.use(mounted.routes()).use(mounted.allowedMethods())
    server = http.createServer(app.callback())
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Missing channel test address')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await manager?.closeAll()
    await new Promise<void>((resolve, reject) => {
      if (server == null) return resolve()
      server.close(error => error == null ? resolve() : reject(error))
    })
    await rm(root, { force: true, recursive: true })
  })

  it.each(['src', 'filePath'] as const)(
    'preserves route cwd and local %s through readFile and connector delivery',
    async (sourceField) => {
      const cwd = path.join(root, 'workspace ')
      const adjacentCwd = path.join(root, 'workspace')
      const source = ' report.txt '
      await Promise.all([mkdir(cwd), mkdir(adjacentCwd)])
      await Promise.all([
        writeFile(path.join(cwd, source), 'raw workspace bytes'),
        writeFile(path.join(adjacentCwd, 'report.txt'), 'adjacent secret bytes')
      ])

      const response = await fetch(`${baseUrl}/api/channels/outbound/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd,
          receiveId: ' target-user ',
          receiveIdType: ' user_id ',
          message: { type: 'file', [sourceField]: source }
        })
      })

      expect(response.status).toBe(200)
      expect(mocks.sendFileMessage).toHaveBeenCalledOnce()
      const message = mocks.sendFileMessage.mock.calls[0]![0]
      expect(Buffer.from(message.content).toString('utf8')).toBe('raw workspace bytes')
      expect(message).toMatchObject({
        fileName: source,
        receiveId: 'target-user',
        receiveIdType: 'user_id'
      })
      expect(Buffer.from(message.content).toString('utf8')).not.toContain('adjacent secret')
    }
  )

  it('retains URL and ordinary text normalization for media sends', async () => {
    const response = await fetch(`${baseUrl}/api/channels/outbound/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        receiveId: ' target-user ',
        message: { type: 'image', url: ' https://example.com/image.png ' }
      })
    })

    expect(response.status).toBe(200)
    expect(mocks.sendMediaMessage).toHaveBeenCalledWith(expect.objectContaining({
      receiveId: 'target-user',
      src: 'https://example.com/image.png'
    }))
  })
})
