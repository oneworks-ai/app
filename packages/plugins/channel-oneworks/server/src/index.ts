import type { Buffer } from 'node:buffer'

import type { PluginRequestPermission, PluginRequestPrincipal } from '@oneworks/types'

import type { OneWorksChannelProductFacade } from './product-facade.js'

const readBody = (body: Buffer) => {
  if (body.length === 0) return undefined
  try {
    return JSON.parse(body.toString('utf8')) as unknown
  } catch {
    throw new Error('Expected a JSON request body.')
  }
}

const json = (body: unknown, status = 200) => ({
  body,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  status
})

const routeParts = (path: string) => path.replace(/^\/+|\/+$/gu, '').split('/').filter(Boolean)

const productInputSchema = {
  description: 'A JSON request body for a Chat Rooms route. GET and DELETE routes may omit it.',
  oneOf: [
    { type: 'null' },
    { type: 'object', additionalProperties: true },
    { type: 'array', items: {} },
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' }
  ]
}

const productOutputSchema = {
  description: 'A redacted Chat Rooms response.',
  oneOf: [
    { type: 'object', additionalProperties: true },
    { type: 'array', items: {} }
  ]
}

const productHeaderSchema = {
  type: 'object',
  additionalProperties: { type: 'string' }
}

export function activatePlugin(ctx: {
  oneworksChannel?: OneWorksChannelProductFacade
  logger: { info: (...args: unknown[]) => void }
  registerApi: (id: string, options: {
    handler: (request: {
      body: Buffer
      method: string
      path: string
      principal: PluginRequestPrincipal
    }) => Promise<unknown>
    title: Record<string, string>
    description: Record<string, string>
    inputSchema: Record<string, unknown>
    outputSchema: Record<string, unknown>
    headerSchema: Record<string, unknown>
    requiredPermission?: PluginRequestPermission
  }) => void
  scope: string
}) {
  const product = ctx.oneworksChannel
  if (product == null) {
    throw new Error('Chat Rooms is only available in a workspace plugin runtime.')
  }

  ctx.registerApi('product', {
    title: { en: 'Chat Rooms', 'zh-Hans': '聊天室' },
    description: {
      en: 'Returns redacted operational channel state and runs signed local simulations.',
      'zh-Hans': '返回脱敏的频道运行状态，并运行签名本地模拟。'
    },
    inputSchema: productInputSchema,
    outputSchema: productOutputSchema,
    headerSchema: productHeaderSchema,
    requiredPermission: 'workspace:manage',
    handler: async request => {
      const parts = routeParts(request.path)
      const body = readBody(request.body)
      if (request.method === 'GET' && parts[0] === 'entities') {
        return json(await product.listEntities(request.principal))
      }
      if (request.method === 'POST' && parts[0] === 'rooms' && parts.length === 1) {
        return json(await product.createRoom(request.principal, body))
      }
      if (
        request.method === 'POST' &&
        parts[0] === 'rooms' &&
        parts[2] === 'connections' &&
        parts.length === 3
      ) {
        return json(
          await product.attachRoomChannelConnection(
            request.principal,
            decodeURIComponent(parts[1] ?? ''),
            body
          ),
          201
        )
      }
      if (parts[0] === 'rooms' && parts[1] != null && parts.length === 2) {
        const roomId = decodeURIComponent(parts[1])
        if (request.method === 'PATCH') return json(await product.updateRoom(request.principal, roomId, body))
        if (request.method === 'DELETE') {
          const removed = await product.deleteRoom(request.principal, roomId)
          return removed ? json({ deleted: true }) : json({ error: 'Room not found.' }, 404)
        }
      }
      if (
        request.method === 'PATCH' &&
        parts[0] === 'rooms' &&
        parts[2] === 'connections' &&
        parts[3] != null &&
        parts[4] != null &&
        parts.length === 5
      ) {
        return json(
          await product.updateRoomChannelConnection(
            request.principal,
            decodeURIComponent(parts[1] ?? ''),
            decodeURIComponent(parts[3]),
            decodeURIComponent(parts[4]),
            body
          )
        )
      }
      if (request.method === 'GET' && parts[0] === 'rooms') return json(await product.listRooms(request.principal))
      if (request.method === 'GET' && parts[0] === 'room-connection-candidates') {
        return json(await product.listRoomChannelConnectionCandidates(request.principal))
      }
      if (request.method === 'GET' && parts[0] === 'share-owners') {
        return json(await product.listShareOwners(request.principal))
      }
      if (request.method === 'GET' && parts[0] === 'shares') return json(await product.listShares(request.principal))
      if (request.method === 'GET' && parts[0] === 'shared') {
        return json(await product.listSharedRooms(request.principal))
      }
      if (request.method === 'GET' && parts[0] === 'simulation-targets') {
        return json(await product.listSimulationTargets(request.principal))
      }
      if (request.method === 'GET' && parts[0] === 'trace') return json(await product.getTrace(request.principal))
      if (request.method === 'POST' && parts[0] === 'simulate') {
        return json(await product.injectSimulation(request.principal, body))
      }
      if (request.method === 'POST' && parts[0] === 'rooms' && parts[2] === 'shares' && parts.length === 3) {
        return json(await product.createRoomShare(request.principal, decodeURIComponent(parts[1] ?? ''), body), 201)
      }
      if (request.method === 'DELETE' && parts[0] === 'rooms' && parts[2] === 'shares' && parts.length === 4) {
        const removed = await product.revokeRoomShare(
          request.principal,
          decodeURIComponent(parts[1] ?? ''),
          decodeURIComponent(parts[3] ?? '')
        )
        return removed ? json({ ok: true }) : json({ error: 'Room share not found.' }, 404)
      }
      if (request.method === 'GET' && parts[0] === 'scenarios') {
        return json(await product.listScenarios(request.principal))
      }
      if (request.method === 'POST' && parts[0] === 'scenarios' && parts.length === 1) {
        return json(await product.createScenario(request.principal, body), 201)
      }
      if (parts[0] === 'scenarios' && parts[1] != null) {
        const scenarioRef = decodeURIComponent(parts[1])
        if (request.method === 'PATCH') return json(await product.updateScenario(request.principal, scenarioRef, body))
        if (request.method === 'DELETE') {
          return json({ deleted: await product.deleteScenario(request.principal, scenarioRef) })
        }
        if (request.method === 'POST' && parts[2] === 'run') {
          return json(await product.runScenario(request.principal, scenarioRef))
        }
      }
      return json({ error: 'Unknown Chat Rooms route.' }, 404)
    }
  })
  ctx.logger.info({ scope: ctx.scope }, '[oneworks-channel] activated')
}
