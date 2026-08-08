import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import type { AdapterMessageContent } from '@oneworks/types'

export interface PiPromptInput {
  images?: Array<{ type: 'image'; data: string; mimeType: string }>
  message: string
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

const parseDataImage = (url: string) => {
  const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/iu)
  return match == null ? undefined : { type: 'image' as const, mimeType: match[1], data: match[2].replace(/\s+/gu, '') }
}

const loadImage = async (part: Extract<AdapterMessageContent, { type: 'image' }>) => {
  const dataImage = parseDataImage(part.url)
  if (dataImage != null) return dataImage
  if (part.path == null || part.path.trim() === '') return undefined
  const mimeType = part.mimeType ?? MIME_BY_EXTENSION[extname(part.path).toLowerCase()]
  if (mimeType == null) return undefined
  return { type: 'image' as const, mimeType, data: (await readFile(part.path)).toString('base64') }
}

export const mapContentToPiPrompt = async (content: AdapterMessageContent[]): Promise<PiPromptInput> => {
  const text: string[] = []
  const images: NonNullable<PiPromptInput['images']> = []
  for (const part of content) {
    if (part.type === 'text') text.push(part.text)
    else if (part.type === 'file') text.push(`[File: ${part.path}]`)
    else if (part.type === 'image') {
      const image = await loadImage(part)
      if (image != null) images.push(image)
      else text.push(`[Image: ${part.path ?? part.url}]`)
    } else if (part.type === 'tool_result') {
      text.push(typeof part.content === 'string' ? part.content : JSON.stringify(part.content))
    }
  }
  return {
    message: text.join('\n').trim(),
    ...(images.length > 0 ? { images } : {})
  }
}
