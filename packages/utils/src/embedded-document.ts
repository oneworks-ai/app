import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import type { ChatMessageContent } from '@oneworks/types'

export const DEFAULT_EMBEDDED_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

const safeName = (value: string | undefined, mimeType: string) => {
  const normalized = value
    ?.replace(/[/\\]+/gu, '-')
    .split('')
    .map(character => character.charCodeAt(0) < 32 ? '-' : character)
    .join('')
    .trim()
    .slice(0, 255)
  if (normalized != null && normalized !== '') return normalized
  return mimeType === 'application/pdf' ? 'factory-document.pdf' : 'factory-document.txt'
}

const decodeCanonicalBase64 = (value: string) => {
  const normalized = value.replace(/\s+/gu, '')
  if (normalized === '' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalized)) {
    return undefined
  }
  const bytes = Buffer.from(normalized, 'base64')
  return bytes.toString('base64') === normalized ? bytes : undefined
}

export const projectEmbeddedDocument = (params: {
  data: string
  encoding: 'base64' | 'utf8'
  maxBytes?: number
  mimeType: 'application/pdf' | 'text/plain'
  name?: string
}): Extract<ChatMessageContent, { type: 'file' }> | undefined => {
  const bytes = params.encoding === 'base64'
    ? decodeCanonicalBase64(params.data)
    : Buffer.from(params.data, 'utf8')
  if (bytes == null || bytes.byteLength > (params.maxBytes ?? DEFAULT_EMBEDDED_DOCUMENT_MAX_BYTES)) {
    return undefined
  }
  const data = params.encoding === 'base64' ? bytes.toString('base64') : params.data
  const digest = createHash('sha256').update(bytes).digest('hex')
  const name = safeName(params.name, params.mimeType)
  return {
    type: 'file',
    path: `factory-document://sha256/${digest}`,
    name,
    size: bytes.byteLength,
    mimeType: params.mimeType,
    data,
    encoding: params.encoding
  }
}
