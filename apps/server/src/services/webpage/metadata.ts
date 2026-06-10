import { badRequest } from '#~/utils/http.js'

export interface WebpageMetadata {
  faviconUrl?: string
  title?: string
  url: string
}

const MAX_METADATA_BYTES = 192 * 1024
const REQUEST_TIMEOUT_MS = 5_000
const METADATA_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 OneWorks/1.0 webpage-metadata'
} as const

const toHttpUrl = (rawUrl: string) => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw badRequest('Invalid URL', { url: rawUrl }, 'invalid_url')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('Unsupported URL protocol', { protocol: url.protocol }, 'unsupported_url_protocol')
  }
  return url
}

const decodeHtmlText = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const cleanHtmlText = (value: string) =>
  decodeHtmlText(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

const readHtmlPreview = async (response: Response) => {
  const reader = response.body?.getReader()
  if (reader == null) return ''

  const decoder = new TextDecoder()
  let bytesRead = 0
  let html = ''
  while (bytesRead < MAX_METADATA_BYTES) {
    const result = await reader.read()
    if (result.done) break
    bytesRead += result.value.byteLength
    html += decoder.decode(result.value, { stream: bytesRead < MAX_METADATA_BYTES })
  }
  await reader.cancel().catch(() => undefined)
  return html
}

const parseAttributes = (tag: string) => {
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g)) {
    const [, name, quotedValue, singleQuotedValue, bareValue] = match
    if (name == null) continue
    attributes[name.toLowerCase()] = decodeHtmlText(quotedValue ?? singleQuotedValue ?? bareValue ?? '')
  }
  return attributes
}

const extractTitle = (html: string) => {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return titleMatch?.[1] == null ? undefined : cleanHtmlText(titleMatch[1])
}

const extractFaviconUrl = (html: string, baseUrl: string) => {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0])
    const relTokens = attributes.rel?.toLowerCase().split(/\s+/) ?? []
    if (!relTokens.includes('icon') || attributes.href == null || attributes.href.trim() === '') continue
    try {
      return new URL(attributes.href, baseUrl).toString()
    } catch {
      return undefined
    }
  }
  return undefined
}

const extractClientRedirectUrl = (html: string, baseUrl: string) => {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0])
    if (attributes['http-equiv']?.toLowerCase() !== 'refresh') continue
    const refreshUrl = attributes.content?.match(/url\s*=\s*([^;]+)/i)?.[1]?.trim()
    if (refreshUrl != null && refreshUrl !== '') {
      return new URL(refreshUrl.replace(/^['"]|['"]$/g, ''), baseUrl).toString()
    }
  }
  if (html.includes('location.href.replace("https://","http://")')) {
    return baseUrl.replace(/^https:/, 'http:')
  }
  return undefined
}

export const getFallbackWebpageMetadata = (url: URL): WebpageMetadata => ({
  faviconUrl: `${url.origin}/favicon.ico`,
  title: url.hostname.replace(/^www\./, '') || url.toString(),
  url: url.toString()
})

const readWebpageMetadataOnce = async (url: URL, fallback: WebpageMetadata) => {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: METADATA_FETCH_HEADERS
  })
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!response.ok || (contentType !== '' && !contentType.includes('html'))) {
    return { metadata: fallback, hasTitle: false }
  }

  const baseUrl = response.url || url.toString()
  const html = await readHtmlPreview(response)
  const title = extractTitle(html)
  return {
    clientRedirectUrl: title == null ? extractClientRedirectUrl(html, baseUrl) : undefined,
    hasTitle: title != null,
    metadata: {
      faviconUrl: extractFaviconUrl(html, baseUrl) ?? fallback.faviconUrl,
      title: title ?? fallback.title,
      url: baseUrl
    }
  }
}

export const readWebpageMetadata = async (rawUrl: string): Promise<WebpageMetadata> => {
  const url = toHttpUrl(rawUrl)
  const fallback = getFallbackWebpageMetadata(url)
  try {
    const firstRead = await readWebpageMetadataOnce(url, fallback)
    if (firstRead.hasTitle || firstRead.clientRedirectUrl == null) return firstRead.metadata

    const redirectUrl = toHttpUrl(firstRead.clientRedirectUrl)
    if (redirectUrl.toString() === url.toString()) return firstRead.metadata
    return (await readWebpageMetadataOnce(redirectUrl, getFallbackWebpageMetadata(redirectUrl))).metadata
  } catch {
    return fallback
  }
}
