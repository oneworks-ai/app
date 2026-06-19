import { Buffer } from 'node:buffer'

import type { WeComCallbackMessage } from '#~/types.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const stripCdata = (value: string) => value.replace(/^<!\[CDATA\[/u, '').replace(/\]\]>$/u, '')

const escapeXmlText = (value: string) => (
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;')
)

const unescapeXmlText = (value: string) => (
  value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
)

export const getXmlTagValue = (xml: string, tagName: string) => {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'u')
  const matched = pattern.exec(xml)
  if (matched?.[1] == null) return undefined
  return unescapeXmlText(stripCdata(matched[1]).trim())
}

export const parseWeComXml = (xml: string): WeComCallbackMessage => ({
  AgentID: getXmlTagValue(xml, 'AgentID'),
  Content: getXmlTagValue(xml, 'Content'),
  CreateTime: getXmlTagValue(xml, 'CreateTime'),
  Event: getXmlTagValue(xml, 'Event'),
  FromUserName: getXmlTagValue(xml, 'FromUserName'),
  MsgId: getXmlTagValue(xml, 'MsgId'),
  MsgType: getXmlTagValue(xml, 'MsgType'),
  ToUserName: getXmlTagValue(xml, 'ToUserName')
})

const getRawBodyText = (body: unknown) => {
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (isRecord(body)) {
    const rawBody = body.rawBody
    if (typeof rawBody === 'string') return rawBody
    const encrypt = body.Encrypt ?? body.encrypt
    if (typeof encrypt === 'string') return `<xml><Encrypt><![CDATA[${escapeXmlText(encrypt)}]]></Encrypt></xml>`
  }
  return undefined
}

export const getEncryptedBody = (body: unknown) => {
  const rawText = getRawBodyText(body)
  if (rawText != null) return getXmlTagValue(rawText, 'Encrypt')
  return undefined
}
