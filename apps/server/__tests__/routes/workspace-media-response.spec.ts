import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Router from '@koa/router'
import Koa from 'koa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseMediaByteRange, sendWorkspaceMediaResponse } from '#~/routes/workspace-media-response.js'

describe('workspace media response', () => {
  let appServer: ReturnType<typeof createServer>
  let baseUrl: string
  let filePath: string
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ow-media-response-'))
    filePath = join(root, 'recording rendered.mp4')
    await writeFile(filePath, Buffer.from('0123456789'))
    const fileStat = await stat(filePath)

    const app = new Koa()
    const router = new Router()
    const handle = async (ctx: Koa.Context) => {
      await sendWorkspaceMediaResponse(ctx, {
        device: fileStat.dev,
        filePath,
        inode: fileStat.ino,
        mimeType: 'video/mp4',
        path: filePath,
        size: 10
      })
    }
    router.get('/media', handle)
    router.head('/media', handle)
    app.use(router.routes()).use(router.allowedMethods())
    appServer = createServer(app.callback())
    appServer.listen(0, '127.0.0.1')
    await once(appServer, 'listening')
    const address = appServer.address()
    if (address == null || typeof address === 'string') throw new Error('Expected TCP server address')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    appServer.close()
    await once(appServer, 'close')
    await rm(root, { recursive: true, force: true })
  })

  it('parses first, middle, open-ended, and suffix byte ranges', () => {
    expect(parseMediaByteRange('bytes=0-3', 10)).toEqual({ start: 0, end: 3, length: 4 })
    expect(parseMediaByteRange('bytes=3-6', 10)).toEqual({ start: 3, end: 6, length: 4 })
    expect(parseMediaByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9, length: 3 })
    expect(parseMediaByteRange('bytes=-4', 10)).toEqual({ start: 6, end: 9, length: 4 })
    expect(parseMediaByteRange('bytes=8-99', 10)).toEqual({ start: 8, end: 9, length: 2 })
  })

  it.each(['bytes=10-', 'bytes=7-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'items=0-1'])(
    'rejects invalid or unsatisfiable range %s',
    (range) => {
      expect(parseMediaByteRange(range, 10)).toBeNull()
    }
  )

  it('rejects a file replaced after authorization', async () => {
    const fileStat = await stat(filePath)
    await expect(sendWorkspaceMediaResponse({
      get: () => '',
      method: 'GET',
      set: () => undefined,
      state: {},
      status: 0,
      type: ''
    }, {
      device: fileStat.dev,
      filePath,
      inode: fileStat.ino + 1,
      mimeType: 'video/mp4',
      path: filePath,
      size: fileStat.size
    })).rejects.toMatchObject({ code: 'workspace_media_file_changed', status: 400 })
  })

  it('serves full GET and HEAD responses with inline media headers', async () => {
    const response = await fetch(`${baseUrl}/media`)
    expect(response.status).toBe(200)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-length')).toBe('10')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-disposition')).toContain('inline;')
    expect(response.headers.get('content-disposition')).toContain('recording%20rendered.mp4')
    expect(await response.text()).toBe('0123456789')

    const headResponse = await fetch(`${baseUrl}/media`, { method: 'HEAD' })
    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get('content-length')).toBe('10')
    expect(await headResponse.text()).toBe('')
  })

  it.each([
    ['bytes=0-3', '0123', 'bytes 0-3/10'],
    ['bytes=3-6', '3456', 'bytes 3-6/10'],
    ['bytes=-3', '789', 'bytes 7-9/10']
  ])('serves range %s as 206', async (range, expectedBody, expectedContentRange) => {
    const response = await fetch(`${baseUrl}/media`, { headers: { Range: range } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(expectedContentRange)
    expect(response.headers.get('content-length')).toBe(String(expectedBody.length))
    expect(await response.text()).toBe(expectedBody)
  })

  it('returns 206 HEAD and 416 invalid ranges without a response body', async () => {
    const headResponse = await fetch(`${baseUrl}/media`, {
      method: 'HEAD',
      headers: { Range: 'bytes=4-7' }
    })
    expect(headResponse.status).toBe(206)
    expect(headResponse.headers.get('content-range')).toBe('bytes 4-7/10')
    expect(headResponse.headers.get('content-length')).toBe('4')
    expect(await headResponse.text()).toBe('')

    const invalidResponse = await fetch(`${baseUrl}/media`, { headers: { Range: 'bytes=10-' } })
    expect(invalidResponse.status).toBe(416)
    expect(invalidResponse.headers.get('content-range')).toBe('bytes */10')
    expect(await invalidResponse.text()).toBe('')
  })
})
