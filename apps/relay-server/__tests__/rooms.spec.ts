import { readFile } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import { readRelayStore } from '../src/store.js'
import { authHeaders, requestJson } from './helpers.js'
import { cleanupSessionRelayFixtures, listenSessionRelay } from './session-route-helpers.js'

afterEach(cleanupSessionRelayFixtures)

const waitForOpen = async (socket: WebSocket) =>
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

const waitForMessage = async (socket: WebSocket) =>
  await new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.once('message', data => {
      try {
        resolve(JSON.parse(String(data)) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    socket.once('error', reject)
  })

const descriptor = {
  acls: [{ permissions: ['view', 'send'], principalId: 'user-2', principalType: 'user' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  ownerDeviceId: 'device-1',
  ownerNodeId: 'device-1',
  ownerUserId: 'user-1',
  shareId: 'share-1',
  status: 'active',
  title: 'Shared room',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const connectOwner = async (baseUrl: string) => {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, 'ws')}/api/relay/devices/control`, {
    headers: { authorization: 'Bearer device-token-1', 'x-oneworks-relay-device-id': 'device-1' }
  })
  await waitForOpen(socket)
  socket.send(JSON.stringify({ descriptor, type: 'room-descriptor' }))
  await vi.waitFor(async () => {
    const listed = await requestJson(baseUrl, '/api/relay/rooms', { headers: authHeaders('member-token-2') })
    expect(listed.body).toMatchObject({
      rooms: [{ availability: 'online', shareId: 'share-1', title: 'Shared room' }]
    })
    expect(JSON.stringify(listed.body)).not.toContain('ownerDeviceId')
    expect(JSON.stringify(listed.body)).not.toContain('ownerNodeId')
    expect(JSON.stringify(listed.body)).not.toContain('ownerUserId')
    expect(JSON.stringify(listed.body)).not.toContain('roomId')
  })
  return socket
}

describe('relay shared Rooms', () => {
  it('persists only descriptor and ACL metadata while live traffic never becomes a forwarding job', async () => {
    const { args, baseUrl } = await listenSessionRelay()
    const owner = await connectOwner(baseUrl)
    const ownerRequest = waitForMessage(owner)
    const secret = 'room-content-must-never-persist'
    const request = requestJson(baseUrl, '/api/relay/rooms/share-1/send', {
      method: 'POST',
      headers: { ...authHeaders('member-token-2'), 'x-oneworks-room-operation-id': 'retryable-send-1' },
      body: JSON.stringify({ content: secret })
    })
    const frame = await ownerRequest
    expect(frame).toMatchObject({
      action: 'send',
      body: { content: secret },
      operationId: 'retryable-send-1',
      principal: { id: 'user-2', type: 'user' },
      shareId: 'share-1',
      type: 'room-request'
    })
    owner.send(JSON.stringify({ ok: true, requestId: frame.requestId, shareId: 'share-1', type: 'room-response' }))
    await expect(request).resolves.toMatchObject({ response: { status: 200 }, body: { ok: true } })

    const ownerViewRequest = waitForMessage(owner)
    const view = requestJson(baseUrl, '/api/relay/rooms/share-1/view', {
      headers: authHeaders('member-token-2')
    })
    const viewFrame = await ownerViewRequest
    expect(viewFrame).toMatchObject({
      action: 'view',
      principal: { id: 'user-2', type: 'user' },
      shareId: 'share-1',
      type: 'room-request'
    })
    owner.send(JSON.stringify({
      body: { messages: [{ content: secret }] },
      ok: true,
      requestId: viewFrame.requestId,
      shareId: 'share-1',
      type: 'room-response'
    }))
    await expect(view).resolves.toMatchObject({
      response: { status: 200 },
      body: { body: { messages: [{ content: secret }] }, ok: true }
    })

    const store = await readRelayStore(args.dataPath)
    const serialized = await readFile(args.dataPath, 'utf8')
    expect(store.sharedRooms).toMatchObject([{ shareId: 'share-1' }])
    expect(store.sharedRooms?.[0]).not.toHaveProperty('roomId')
    expect(store.forwardingJobs).toEqual([])
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('room-request')
    owner.close()
  })

  it('keeps a caller operation identifier stable across retried live sends', async () => {
    const { baseUrl } = await listenSessionRelay()
    const owner = await connectOwner(baseUrl)
    const requestHeaders = {
      ...authHeaders('member-token-2'),
      'x-oneworks-room-operation-id': 'stable-operation-1'
    }

    const firstFramePromise = waitForMessage(owner)
    const first = requestJson(baseUrl, '/api/relay/rooms/share-1/send', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ content: 'retry-safe' })
    })
    const firstFrame = await firstFramePromise
    owner.send(JSON.stringify({ ok: true, requestId: firstFrame.requestId, shareId: 'share-1', type: 'room-response' }))
    await expect(first).resolves.toMatchObject({ body: { ok: true, operationId: 'stable-operation-1' } })

    const secondFramePromise = waitForMessage(owner)
    const second = requestJson(baseUrl, '/api/relay/rooms/share-1/send', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ content: 'retry-safe' })
    })
    const secondFrame = await secondFramePromise
    expect(secondFrame).toMatchObject({
      operationId: 'stable-operation-1',
      shareId: 'share-1',
      type: 'room-request'
    })
    expect(secondFrame.requestId).not.toBe(firstFrame.requestId)
    owner.send(
      JSON.stringify({ ok: true, requestId: secondFrame.requestId, shareId: 'share-1', type: 'room-response' })
    )
    await expect(second).resolves.toMatchObject({ body: { ok: true, operationId: 'stable-operation-1' } })
    owner.close()
  })

  it('requires a valid caller operation identifier before mutation forwarding', async () => {
    const { baseUrl } = await listenSessionRelay()
    const owner = await connectOwner(baseUrl)

    const missing = await requestJson(baseUrl, '/api/relay/rooms/share-1/send', {
      method: 'POST',
      headers: authHeaders('member-token-2'),
      body: JSON.stringify({ content: 'not sent' })
    })
    expect(missing).toMatchObject({
      response: { status: 400 },
      body: { error: 'A valid Room operation identifier is required.' }
    })

    const response = await requestJson(baseUrl, '/api/relay/rooms/share-1/send', {
      method: 'POST',
      headers: { ...authHeaders('member-token-2'), 'x-oneworks-room-operation-id': 'invalid operation' },
      body: JSON.stringify({ content: 'not sent' })
    })

    expect(response).toMatchObject({
      response: { status: 400 },
      body: { error: 'A valid Room operation identifier is required.' }
    })
    owner.close()
  })

  it('keeps a descriptor visible but fails live delivery immediately when its owner socket is offline', async () => {
    const { baseUrl } = await listenSessionRelay()
    const owner = await connectOwner(baseUrl)
    const closed = new Promise<void>(resolve => owner.once('close', () => resolve()))
    owner.close()
    await closed

    const listed = await requestJson(baseUrl, '/api/relay/rooms', { headers: authHeaders('member-token-2') })
    expect(listed.body).toMatchObject({ rooms: [{ availability: 'offline', shareId: 'share-1' }] })

    const response = await requestJson(baseUrl, '/api/relay/rooms/share-1/send', {
      method: 'POST',
      headers: {
        ...authHeaders('member-token-2'),
        'x-oneworks-room-operation-id': 'owner-offline-send-1'
      },
      body: JSON.stringify({ content: 'not queued' })
    })
    expect(response).toMatchObject({
      response: { status: 503 },
      body: { error: 'owner_offline', ok: false, operationId: expect.any(String) }
    })
  })
})
