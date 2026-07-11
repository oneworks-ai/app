import { Buffer } from 'node:buffer'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'

import type { WorkspaceMediaResource } from '#~/services/workspace/media.js'
import { badRequest, notFound } from '#~/utils/http.js'

export interface MediaByteRange {
  end: number
  length: number
  start: number
}

export interface WorkspaceMediaResponseContext {
  body?: unknown
  length?: number
  method: string
  state: Record<string, unknown>
  status: number
  type: string
  get: (name: string) => string
  set: (name: string, value: string) => void
}

const encodeContentDispositionFileName = (value: string) => (
  encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
)

const getContentDisposition = (filePath: string) => {
  const fileName = basename(filePath)
  const asciiFileName = fileName.replace(/[^\x20-\x7E]|["\\]/g, '_') || 'media'
  return `inline; filename="${asciiFileName}"; filename*=UTF-8''${encodeContentDispositionFileName(fileName)}`
}

export const parseMediaByteRange = (rangeHeader: string, size: number): MediaByteRange | null => {
  if (rangeHeader.trim() === '') return null
  if (!Number.isSafeInteger(size) || size <= 0) return null

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (match == null || (match[1] === '' && match[2] === '')) return null

  if (match[1] === '') {
    const suffixLength = Number.parseInt(match[2], 10)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    const length = Math.min(suffixLength, size)
    return { start: size - length, end: size - 1, length }
  }

  const start = Number.parseInt(match[1], 10)
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null

  const requestedEnd = match[2] === '' ? size - 1 : Number.parseInt(match[2], 10)
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null
  const end = Math.min(requestedEnd, size - 1)
  return { start, end, length: end - start + 1 }
}

export const sendWorkspaceMediaResponse = async (
  ctx: WorkspaceMediaResponseContext,
  resource: WorkspaceMediaResource
) => {
  const fileHandle = await open(resource.filePath, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error) => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw notFound('Local media file not found', { path: resource.path }, 'workspace_media_not_found')
    }
    throw badRequest(
      'Local media file could not be opened safely',
      { path: resource.path },
      'workspace_media_open_rejected'
    )
  })
  const openedFileStat = await fileHandle.stat()
  if (!openedFileStat.isFile()) {
    await fileHandle.close()
    throw badRequest('Local media path is not a file', { path: resource.path }, 'workspace_media_path_not_file')
  }
  if (openedFileStat.dev !== resource.device || openedFileStat.ino !== resource.inode) {
    await fileHandle.close()
    throw badRequest(
      'Local media file changed before it could be opened safely',
      { path: resource.path },
      'workspace_media_file_changed'
    )
  }

  const size = openedFileStat.size
  const rangeHeader = ctx.get('Range')
  const requestedRange = rangeHeader.trim() === '' ? undefined : parseMediaByteRange(rangeHeader, size)

  ctx.state.skipApiEnvelope = true
  ctx.type = resource.mimeType
  ctx.set('Accept-Ranges', 'bytes')
  ctx.set('Cache-Control', 'private, max-age=60, must-revalidate')
  ctx.set('Content-Disposition', getContentDisposition(resource.path))
  if (resource.mimeType === 'image/svg+xml') {
    ctx.set('Content-Security-Policy', "default-src 'none'; sandbox")
  }
  ctx.set('X-Content-Type-Options', 'nosniff')

  if (rangeHeader.trim() !== '' && requestedRange == null) {
    ctx.set('Content-Range', `bytes */${size}`)
    ctx.length = 0
    ctx.body = Buffer.alloc(0)
    ctx.status = 416
    await fileHandle.close()
    return
  }

  const range = requestedRange ?? {
    start: 0,
    end: Math.max(0, size - 1),
    length: size
  }
  ctx.status = requestedRange == null ? 200 : 206
  ctx.length = range.length
  if (requestedRange != null) {
    ctx.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  }

  if (ctx.method === 'HEAD') {
    ctx.body = Buffer.alloc(0)
    ctx.length = range.length
    ctx.status = requestedRange == null ? 200 : 206
    await fileHandle.close()
    return
  }

  ctx.body = fileHandle.createReadStream(
    size === 0
      ? { autoClose: true }
      : { autoClose: true, start: range.start, end: range.end }
  )
}
