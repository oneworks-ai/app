import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import type { ContentBlock } from '@agentclientprotocol/sdk'
import type { AdapterMessageContent } from '@oneworks/types'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

const parseDataImage = (url: string) => {
  const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/iu)
  return match == null ? undefined : { mimeType: match[1], data: match[2].replace(/\s+/gu, '') }
}

const loadImage = async (part: Extract<AdapterMessageContent, { type: 'image' }>) => {
  const inline = parseDataImage(part.url)
  if (inline != null) return inline
  if (!part.path?.trim()) return undefined
  const mimeType = part.mimeType ?? MIME_BY_EXTENSION[extname(part.path).toLowerCase()]
  if (mimeType == null) return undefined
  return { mimeType, data: (await readFile(part.path)).toString('base64') }
}

export const mapContentToClinePrompt = async (content: AdapterMessageContent[]): Promise<ContentBlock[]> => {
  const result: ContentBlock[] = []
  for (const part of content) {
    if (part.type === 'text' && part.text !== '') {
      result.push({ type: 'text', text: part.text })
    } else if (part.type === 'file') {
      result.push({ type: 'resource_link', uri: `file://${part.path}`, name: part.name ?? part.path })
    } else if (part.type === 'image') {
      const image = await loadImage(part)
      if (image != null) result.push({ type: 'image', ...image })
      else result.push({ type: 'text', text: `[Image: ${part.path ?? part.name ?? part.url}]` })
    } else if (part.type === 'tool_result') {
      result.push({
        type: 'text',
        text: typeof part.content === 'string' ? part.content : JSON.stringify(part.content)
      })
    }
  }
  return result
}

export const mapContentToFreshText = (content: AdapterMessageContent[]) =>
  content.flatMap((part) => {
    if (part.type === 'text') return part.text.trim() ? [part.text] : []
    if (part.type === 'file') return [`[File: ${part.path}]`]
    if (part.type === 'image') return [`[Image: ${part.path ?? part.name ?? part.url}]`]
    if (part.type === 'tool_result') {
      return [typeof part.content === 'string' ? part.content : JSON.stringify(part.content)]
    }
    return []
  }).join('\n\n').trim()
