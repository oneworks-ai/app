import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

import { conflict, internalServerError } from '#~/utils/http.js'

const LOCK_PORT_BASE = 30_000
const LOCK_PORT_COUNT = 20_000

export interface AssetLockRelease {
  degraded: boolean
  released: boolean
}

const lockPort = (authority: string, name: string) => {
  const digest = createHash('sha256')
    .update(resolve(authority))
    .update('\0')
    .update(name)
    .digest()
  return LOCK_PORT_BASE + digest.readUInt16BE(0) % LOCK_PORT_COUNT
}

/**
 * Holds a semantic claim in the kernel rather than in the movable workspace.
 * A crash closes the listening socket, so recovery never guesses whether a
 * persisted owner file is stale. Hash collisions fail closed as "in progress".
 */
export const acquireAssetLock = async (authority: string, name: string) => {
  if (!/^[\p{L}\p{N}_-]+$/u.test(name)) {
    throw conflict('Invalid asset claim name', undefined, 'invalid_asset_name')
  }

  const server = createServer(socket => socket.destroy())
  server.maxConnections = 0
  const port = lockPort(authority, name)
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolvePromise()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen({ exclusive: true, host: '127.0.0.1', port })
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw conflict(
        'A data asset with this name is being created',
        undefined,
        'asset_create_in_progress'
      )
    }
    throw internalServerError('Asset claim status is indeterminate', {
      cause: error,
      code: 'asset_claim_indeterminate'
    })
  }

  let degraded = false
  server.on('error', () => {
    degraded = true
  })
  let releasePromise: Promise<AssetLockRelease> | undefined
  return async () => {
    releasePromise ??= new Promise<AssetLockRelease>(resolveRelease => {
      server.close(error =>
        resolveRelease({
          degraded: degraded || error != null,
          released: error == null
        })
      )
    })
    return await releasePromise
  }
}
