import { Buffer } from 'node:buffer'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { TextDecoder } from 'node:util'

const isPathInside = (parent: string, child: string) => {
  const pathFromParent = relative(parent, child)
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))
}

export const readBoundedRegularFileNoFollow = async (params: {
  canonicalParent: string
  filePath: string
  maxBytes: number
}): Promise<string | undefined> => {
  const canonicalBefore = await realpath(params.filePath)
  if (!isPathInside(params.canonicalParent, canonicalBefore)) return undefined

  const handle = await open(params.filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size > BigInt(params.maxBytes)) return undefined

    const canonicalAfter = await realpath(params.filePath)
    if (!isPathInside(params.canonicalParent, canonicalAfter)) return undefined
    const pathStat = await stat(canonicalAfter, { bigint: true })
    if (pathStat.dev !== before.dev || pathStat.ino !== before.ino) return undefined

    const buffer = Buffer.allocUnsafe(params.maxBytes + 1)
    let totalBytes = 0
    while (totalBytes < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        totalBytes,
        buffer.length - totalBytes,
        totalBytes
      )
      if (bytesRead === 0) break
      totalBytes += bytesRead
    }
    if (totalBytes > params.maxBytes) return undefined

    const after = await handle.stat({ bigint: true })
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      BigInt(totalBytes) !== after.size
    ) return undefined

    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, totalBytes))
    } catch {
      return undefined
    }
  } finally {
    await handle.close()
  }
}
