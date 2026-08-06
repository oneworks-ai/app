import { randomUUID } from 'node:crypto'
import type http from 'node:http'
import type { Duplex } from 'node:stream'

import type Koa from 'koa'

import { badRequest, internalServerError } from '#~/utils/http.js'
import { ASSET_PRE_COMMIT_DETAILS } from './asset-create-error.js'

const operationTtlMs = 5 * 60_000
const maxOperations = 256
const poisonedSockets = new WeakSet<Duplex>()

export const installAssetCreateConnectionGuard = (server: http.Server) => {
  server.on('clientError', (error, socket) => {
    poisonedSockets.add(socket)
    socket.destroy(error)
  })
}

type AssetCreateOperation<T> =
  | { state: 'pending'; updatedAt: number }
  | { state: 'succeeded'; updatedAt: number; value: T }
  | { error: unknown; state: 'failed'; updatedAt: number }

const waitForSafeConnectionClose = (ctx: Koa.Context) => {
  const socket = ctx.req.socket
  return new Promise<boolean>((resolve) => {
    let responseFinished = false
    ctx.res.once('finish', () => {
      responseFinished = true
    })
    socket.once('close', (hadError) => {
      setImmediate(() =>
        resolve(
          responseFinished && hadError === false && !poisonedSockets.has(socket)
        )
      )
    })
  })
}

export const createAssetOperationRegistry = <T>() => {
  const operations = new Map<string, AssetCreateOperation<T>>()
  const prune = () => {
    const expiredBefore = Date.now() - operationTtlMs
    for (const [id, operation] of operations) {
      if (operation.updatedAt < expiredBefore) operations.delete(id)
    }
    while (operations.size >= maxOperations) {
      const completed = [...operations].find(([, operation]) => operation.state !== 'pending')
      if (completed == null) break
      operations.delete(completed[0])
    }
  }
  return {
    get: (id: string) => {
      prune()
      return operations.get(id)
    },
    queue: (ctx: Koa.Context, run: () => Promise<T>) => {
      prune()
      if (operations.size >= maxOperations) {
        throw badRequest('Too many pending asset operations', ASSET_PRE_COMMIT_DETAILS, 'asset_operation_busy')
      }
      const id = randomUUID()
      operations.set(id, { state: 'pending', updatedAt: Date.now() })
      const safeClose = waitForSafeConnectionClose(ctx)
      void safeClose.then(async (safe) => {
        if (!safe) {
          operations.set(id, {
            error: internalServerError('Asset request transport status is indeterminate', {
              code: 'asset_request_transport_indeterminate',
              details: { committed: 'indeterminate' }
            }),
            state: 'failed',
            updatedAt: Date.now()
          })
          return
        }
        try {
          operations.set(id, { state: 'succeeded', updatedAt: Date.now(), value: await run() })
        } catch (error) {
          operations.set(id, { error, state: 'failed', updatedAt: Date.now() })
        }
      })
      return id
    }
  }
}
