/* eslint-disable max-lines -- WeChat media normalization covers XML parsing, downloads, and GIF frame extraction. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChatMessageContent } from '@oneworks/core'
import type { ChannelLogger } from '@oneworks/core/channel'
import { decompressFrames, parseGIF } from 'gifuct-js'
import type { ParsedFrame } from 'gifuct-js'
import { PNG } from 'pngjs'

import type { WechatCallbackPayload, WechatChannelConfig } from '#~/types.js'

import { getWechatDownloadImageUrl } from './api'

interface WechatMediaContentResult {
  contentItems: ChatMessageContent[]
  emojis?: Array<{
    id: string
    label?: string
    metadata?: Record<string, unknown>
    platform: string
  }>
  text: string
}

interface DownloadedMedia {
  buffer: Buffer
  mimeType?: string
}

interface StoredImageItem {
  mimeType: string
  name: string
  path: string
  size: number
  url: string
}

const WECHAT_MEDIA_TMP_DIR = join(tmpdir(), 'oneworks-wechat-media')
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024

const WECHAT_MEDIA_TYPE_LABELS: Record<number, string> = {
  3: '图片',
  34: '语音',
  43: '视频',
  47: '动画表情',
  49: '分享/文件'
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readString = (value: unknown) =>
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined

const readPositiveInteger = (value: unknown) => {
  const normalized = typeof value === 'number'
    ? value
    : Number.parseInt(readString(value) ?? '', 10)
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : undefined
}

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const decodeXmlEntities = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const parseXmlAttributes = (xml: string) => {
  const attrs = new Map<string, string>()
  for (const match of xml.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attrs.set(match[1]!.toLowerCase(), decodeXmlEntities(match[3] ?? ''))
  }
  return attrs
}

const readXmlTag = (xml: string, tagName: string) => {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i').exec(xml)
  return match?.[1] == null ? undefined : decodeXmlEntities(match[1].replace(/<[^>]+>/g, '').trim())
}

const readXmlSection = (xml: string, tagName: string) => {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i').exec(xml)?.[1]
}

const detectImageMimeType = (buffer: Buffer, fallback?: string) => {
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'image/gif'
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg'
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return fallback?.startsWith('image/') ? fallback : undefined
}

const bufferToArrayBuffer = (buffer: Buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

const sanitizeFileSegment = (value: string) => {
  const sanitized = value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized === '' ? 'wechat-media' : sanitized.slice(0, 80)
}

const storeMediaFile = async (
  buffer: Buffer,
  input: {
    extension: string
    mimeType: string
    name: string
  }
): Promise<StoredImageItem> => {
  await mkdir(WECHAT_MEDIA_TMP_DIR, { recursive: true })
  const mediaDir = await realpath(WECHAT_MEDIA_TMP_DIR)
  const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
  const name = `${sanitizeFileSegment(input.name)}-${digest}.${input.extension}`
  const filePath = join(mediaDir, name)
  await writeFile(filePath, buffer)
  return {
    mimeType: input.mimeType,
    name,
    path: filePath,
    size: buffer.byteLength,
    url: `data:${input.mimeType};base64,${buffer.toString('base64')}`
  }
}

const getHeader = (headers: unknown, name: string) => {
  if (!isRecord(headers)) return undefined
  const get = headers.get
  if (typeof get !== 'function') return undefined
  const value = get.call(headers, name)
  return typeof value === 'string' ? value : undefined
}

const downloadMedia = async (url: string): Promise<DownloadedMedia> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`download failed with status ${response.status}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`downloaded media is too large: ${buffer.byteLength}`)
  }
  const contentType = getHeader(response.headers, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  return {
    buffer,
    mimeType: detectImageMimeType(buffer, contentType)
  }
}

const readImgBufBuffer = (value: unknown): Buffer | undefined => {
  if (!isRecord(value)) return undefined
  const buffer = value.buffer
  if (typeof buffer === 'string') {
    const base64 = buffer.startsWith('data:') ? buffer.slice(buffer.indexOf(',') + 1) : buffer
    return Buffer.from(base64, 'base64')
  }
  if (Array.isArray(buffer) && buffer.every(item => typeof item === 'number')) {
    return Buffer.from(buffer)
  }
  if (isRecord(buffer) && Array.isArray(buffer.data) && buffer.data.every(item => typeof item === 'number')) {
    return Buffer.from(buffer.data)
  }
  return undefined
}

const pickFirstAttr = (attrs: Map<string, string>, names: readonly string[]) => {
  for (const name of names) {
    const value = readString(attrs.get(name.toLowerCase()))
    if (value != null) return value
  }
  return undefined
}

const pickFirstHttpAttr = (attrs: Map<string, string>, names: readonly string[]) => {
  for (const name of names) {
    const value = pickFirstAttr(attrs, [name])
    if (value == null) continue
    if (isHttpUrl(value)) return value
    // WeChat image callbacks often carry CDN file ids in url-shaped fields.
  }
  return undefined
}

const composePatch = (canvas: Uint8ClampedArray, frame: ParsedFrame, width: number) => {
  const { dims, patch } = frame
  for (let y = 0; y < dims.height; y += 1) {
    for (let x = 0; x < dims.width; x += 1) {
      const patchOffset = (y * dims.width + x) * 4
      const alpha = patch[patchOffset + 3] ?? 0
      if (alpha === 0) continue
      const canvasOffset = ((dims.top + y) * width + dims.left + x) * 4
      canvas[canvasOffset] = patch[patchOffset] ?? 0
      canvas[canvasOffset + 1] = patch[patchOffset + 1] ?? 0
      canvas[canvasOffset + 2] = patch[patchOffset + 2] ?? 0
      canvas[canvasOffset + 3] = alpha
    }
  }
}

const clearFrameArea = (canvas: Uint8ClampedArray, frame: ParsedFrame, width: number) => {
  const { dims } = frame
  for (let y = 0; y < dims.height; y += 1) {
    const start = ((dims.top + y) * width + dims.left) * 4
    canvas.fill(0, start, start + dims.width * 4)
  }
}

const encodePng = (rgba: Uint8ClampedArray, width: number, height: number) =>
  PNG.sync.write({
    width,
    height,
    data: Buffer.from(rgba)
  })

const extractGifSampleFrames = async (buffer: Buffer, messageId: string): Promise<StoredImageItem[]> => {
  const parsed = parseGIF(bufferToArrayBuffer(buffer))
  const frames = decompressFrames(parsed, true)
  if (frames.length === 0) return []

  const width = parsed.lsd.width
  const height = parsed.lsd.height
  const sampleIndexes = [0, Math.floor((frames.length - 1) / 2), frames.length - 1]
  const labels = ['first', 'middle', 'last']
  const samples = new Map<number, number[]>()
  for (const [position, frameIndex] of sampleIndexes.entries()) {
    const existing = samples.get(frameIndex) ?? []
    existing.push(position)
    samples.set(frameIndex, existing)
  }

  let canvas = new Uint8ClampedArray(width * height * 4)
  const captured: Array<{ label: string; png: Buffer }> = []
  for (const [index, frame] of frames.entries()) {
    const previousCanvas = frame.disposalType === 3 ? new Uint8ClampedArray(canvas) : undefined
    composePatch(canvas, frame, width)

    const positions = samples.get(index)
    if (positions != null) {
      const png = encodePng(canvas, width, height)
      for (const position of positions) {
        const label = labels[position] ?? 'frame'
        captured.push({ label, png })
      }
    }

    if (frame.disposalType === 2) {
      clearFrameArea(canvas, frame, width)
    } else if (frame.disposalType === 3 && previousCanvas != null) {
      canvas = previousCanvas
    }
  }

  return await Promise.all(captured.map(({ label, png }) =>
    storeMediaFile(png, {
      extension: 'png',
      mimeType: 'image/png',
      name: `wechat-gif-${sanitizeFileSegment(messageId)}-${label}`
    })
  ))
}

const toImageContentItems = (items: StoredImageItem[]): ChatMessageContent[] =>
  items.map(item => ({
    type: 'image',
    url: item.url,
    path: item.path,
    name: item.name,
    size: item.size,
    mimeType: item.mimeType
  }))

const storeStaticImage = async (buffer: Buffer, messageId: string, name: string, mimeType?: string) => {
  const detectedMimeType = detectImageMimeType(buffer, mimeType)
  if (detectedMimeType == null) return undefined
  const extension = IMAGE_EXTENSIONS[detectedMimeType]
  if (extension == null) return undefined
  return await storeMediaFile(buffer, {
    extension,
    mimeType: detectedMimeType,
    name: `${name}-${sanitizeFileSegment(messageId)}`
  })
}

const buildEmojiContent = async (
  payload: WechatCallbackPayload,
  content: string,
  messageId: string,
  logger?: ChannelLogger
): Promise<WechatMediaContentResult> => {
  const attrs = parseXmlAttributes(content)
  const downloadUrl = pickFirstHttpAttr(attrs, ['cdnurl', 'encrypturl', 'externurl', 'thumburl'])
  const emojiMd5 = pickFirstAttr(attrs, ['md5'])
  const emojiSize = readPositiveInteger(
    pickFirstAttr(attrs, ['len', 'size', 'emojisize'])
  )
  const emojis = emojiMd5 == null
    ? undefined
    : [{
      id: emojiMd5,
      platform: 'wechat',
      metadata: {
        emojiMd5,
        ...(emojiSize == null ? {} : { emojiSize })
      }
    }]

  if (downloadUrl == null) {
    return {
      text: '[微信动画表情] 收到一条动画表情，但回调里没有可下载的 GIF 地址。',
      ...(emojis == null ? {} : { emojis }),
      contentItems: []
    }
  }

  try {
    const media = await downloadMedia(downloadUrl)
    const imageItems = media.mimeType === 'image/gif'
      ? await extractGifSampleFrames(media.buffer, messageId)
      : await Promise.all([
        storeStaticImage(media.buffer, messageId, 'wechat-emoji', media.mimeType)
      ]).then(items => items.filter((item): item is StoredImageItem => item != null))

    await logger?.info?.({
      channelType: 'wechat',
      messageId,
      mimeType: media.mimeType,
      imageCount: imageItems.length
    }, '[wechat] prepared emoji media for agent')

    return {
      text: media.mimeType === 'image/gif'
        ? '[微信动画表情] 已抽取 GIF 第一帧、中间帧、最后一帧。'
        : '[微信动画表情] 已提取表情图片。',
      ...(emojis == null ? {} : { emojis }),
      contentItems: toImageContentItems(imageItems)
    }
  } catch (error) {
    await logger?.warn?.({
      channelType: 'wechat',
      messageId,
      error: getErrorMessage(error)
    }, '[wechat] failed to prepare emoji media for agent')
    return {
      text: `[微信动画表情] 收到一条动画表情，但下载或抽帧失败：${getErrorMessage(error)}`,
      ...(emojis == null ? {} : { emojis }),
      contentItems: []
    }
  }
}

const buildImageContent = async (
  config: WechatChannelConfig,
  payload: WechatCallbackPayload,
  content: string,
  appId: string,
  messageId: string,
  logger?: ChannelLogger
): Promise<WechatMediaContentResult> => {
  const attrs = parseXmlAttributes(content)
  const data = payload.Data
  const inlineBuffer = readImgBufBuffer(data?.ImgBuf)
  const downloadUrl = pickFirstHttpAttr(attrs, [
    'cdnmidimgurl',
    'cdnbigimgurl',
    'cdnthumburl',
    'cdnurl',
    'thumburl',
    'url'
  ])

  try {
    const media = inlineBuffer != null
      ? { buffer: inlineBuffer, mimeType: detectImageMimeType(inlineBuffer) }
      : downloadUrl == null
      ? await downloadWechatImageFromXml(config, {
        appId,
        messageId,
        xml: content
      }, logger)
      : await downloadMedia(downloadUrl)
    const image = media == null
      ? undefined
      : await storeStaticImage(media.buffer, messageId, 'wechat-image', media.mimeType)
    return {
      text: image == null ? buildImageFallbackText(payload, attrs) : '[微信图片] 已提取图片。',
      contentItems: image == null ? [] : toImageContentItems([image])
    }
  } catch (error) {
    await logger?.warn?.({
      channelType: 'wechat',
      messageId,
      error: getErrorMessage(error)
    }, '[wechat] failed to prepare image media for agent')
    return {
      text: `[微信图片] 收到一张图片，但提取失败：${getErrorMessage(error)}`,
      contentItems: []
    }
  }
}

const downloadWechatImageFromXml = async (
  config: WechatChannelConfig,
  input: {
    appId: string
    messageId: string
    xml: string
  },
  logger?: ChannelLogger
): Promise<DownloadedMedia | undefined> => {
  const errors: string[] = []
  for (const type of [2, 1, 3]) {
    try {
      const fileUrl = await getWechatDownloadImageUrl(config, {
        appId: input.appId,
        type,
        xml: input.xml
      })
      if (!isHttpUrl(fileUrl)) {
        throw new Error(`downloadImage returned non-HTTP fileUrl: ${fileUrl}`)
      }
      const media = await downloadMedia(fileUrl)
      await logger?.info?.({
        channelType: 'wechat',
        messageId: input.messageId,
        imageDownloadType: type,
        mimeType: media.mimeType
      }, '[wechat] downloaded image via WechatApi downloadImage')
      return media
    } catch (error) {
      errors.push(`type ${type}: ${getErrorMessage(error)}`)
    }
  }

  await logger?.warn?.({
    channelType: 'wechat',
    messageId: input.messageId,
    errors
  }, '[wechat] failed to download image via WechatApi downloadImage')
  return undefined
}

const buildImageFallbackText = (payload: WechatCallbackPayload, attrs: Map<string, string>) => {
  const msgSource = readString(payload.Data?.MsgSource)
  const filename = msgSource == null ? undefined : readXmlTag(msgSource, 'img_file_name')
  const width = pickFirstAttr(attrs, ['cdnhdwidth', 'cdnmidwidth', 'cdnthumbwidth'])
  const height = pickFirstAttr(attrs, ['cdnhdheight', 'cdnmidheight', 'cdnthumbheight'])
  const byteLength = pickFirstAttr(attrs, ['hdlength', 'length', 'cdnthumblength'])
  const md5 = pickFirstAttr(attrs, ['md5'])
  return [
    '[微信图片] 收到一张图片，但回调只提供 WeChat CDN 文件标识，当前不能直接作为图片附件发送给 agent。',
    filename == null ? undefined : `文件名：${filename}`,
    width == null || height == null ? undefined : `尺寸：${width}x${height}`,
    byteLength == null ? undefined : `大小：${byteLength} bytes`,
    md5 == null ? undefined : `MD5：${md5}`
  ].filter((line): line is string => line != null).join('\n')
}

const buildAppMessageText = (content: string) => {
  const title = readXmlTag(content, 'title')
  const description = readXmlTag(content, 'des')
  const url = readXmlTag(content, 'url')
  const appMsgType = readXmlTag(content, 'type')
  if (appMsgType === '57') {
    const refermsg = readXmlSection(content, 'refermsg')
    const referDisplayName = refermsg == null ? undefined : readXmlTag(refermsg, 'displayname')
    const referContent = refermsg == null ? undefined : readXmlTag(refermsg, 'content')
    return [
      '[微信引用消息] 收到一条引用回复。',
      title == null ? undefined : `回复内容：${title}`,
      referDisplayName == null ? undefined : `引用对象：${referDisplayName}`,
      referContent == null ? undefined : `引用内容：${referContent}`
    ].filter((line): line is string => line != null).join('\n')
  }
  return [
    '[微信分享/文件] 收到一条 appmsg。',
    title == null ? undefined : `标题：${title}`,
    description == null ? undefined : `描述：${description}`,
    url == null ? undefined : `链接：${url}`,
    appMsgType == null ? undefined : `类型：${appMsgType}`
  ].filter((line): line is string => line != null).join('\n')
}

const buildFallbackMediaText = (payload: WechatCallbackPayload, content: string, msgType: number) => {
  const label = WECHAT_MEDIA_TYPE_LABELS[msgType] ?? `未知类型 ${msgType}`
  const pushContent = readString(payload.Data?.PushContent)
  return [
    `[微信${label}] 收到一条暂未转成附件的消息。`,
    pushContent == null ? undefined : `摘要：${pushContent}`,
    content.trim() === '' ? undefined : `原始内容：${content.slice(0, 1000)}`
  ].filter((line): line is string => line != null).join('\n')
}

export const buildWechatMediaContent = async (
  payload: WechatCallbackPayload,
  input: {
    appId: string
    config: WechatChannelConfig
    content: string
    messageId: string
    msgType: number
  },
  logger?: ChannelLogger
): Promise<WechatMediaContentResult | null> => {
  if (input.msgType === 47) {
    return await buildEmojiContent(payload, input.content, input.messageId, logger)
  }
  if (input.msgType === 3) {
    return await buildImageContent(input.config, payload, input.content, input.appId, input.messageId, logger)
  }
  if (input.msgType === 49) {
    return {
      text: buildAppMessageText(input.content),
      contentItems: []
    }
  }
  if (input.msgType === 34 || input.msgType === 43) {
    return {
      text: buildFallbackMediaText(payload, input.content, input.msgType),
      contentItems: []
    }
  }
  return null
}
