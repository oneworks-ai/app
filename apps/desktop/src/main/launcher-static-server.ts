/* eslint-disable max-lines -- packaged launcher static server keeps base rewriting and file serving together. */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { CLIENT_BASE, SERVER_HOST } from './constants'

const DEFAULT_BASE_PLACEHOLDER = '/__ONEWORKS_PROJECT_CLIENT_BASE__/'
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const normalizeClientBase = (base: string) => {
  let next = base.trim() || CLIENT_BASE
  if (!next.startsWith('/')) {
    next = `/${next}`
  }
  if (!next.endsWith('/')) {
    next += '/'
  }
  return next
}

const trimTrailingSlash = (value: string) => value === '/' ? value : value.replace(/\/+$/, '')

const getContentType = (filePath: string) =>
  CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'

const createRuntimeScript = (clientBase: string) => {
  const runtimeEnv = {
    __ONEWORKS_PROJECT_SERVER_BASE_URL__: '',
    __ONEWORKS_PROJECT_SERVER_HOST__: '',
    __ONEWORKS_PROJECT_SERVER_PORT__: '',
    __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws',
    __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
    __ONEWORKS_PROJECT_CLIENT_BASE__: clientBase,
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: ''
  }
  return `<script>window.__ONEWORKS_PROJECT_RUNTIME_ENV__=${JSON.stringify(runtimeEnv)}</script>`
}

const resolveStaticFile = (distPath: string, requestPath: string) => {
  const relativePath = requestPath.replace(/^\/+/, '')
  if (!relativePath || relativePath === 'index.html' || relativePath.includes('\0')) {
    return null
  }

  const absolutePath = path.resolve(distPath, relativePath)
  const pathFromRoot = path.relative(distPath, absolutePath)
  if (pathFromRoot.startsWith('..') || path.isAbsolute(pathFromRoot)) {
    return null
  }

  return absolutePath
}

const writeText = (
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string
) => {
  response.writeHead(statusCode, { 'Content-Type': contentType })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  response.end(body)
}

const sendFile = async (
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string
) => {
  const fileStat = await stat(filePath).catch(() => null)
  if (fileStat == null || !fileStat.isFile()) {
    return false
  }

  response.writeHead(200, {
    'Content-Length': fileStat.size,
    'Content-Type': getContentType(filePath),
    ...(path.basename(filePath) === 'sw.js' ? { 'Cache-Control': 'no-cache' } : {})
  })
  if (request.method === 'HEAD') {
    response.end()
    return true
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('end', () => resolve())
    stream.pipe(response)
  })
  return true
}

const listen = (server: ReturnType<typeof createServer>, port: number) =>
  new Promise<number>((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      resolve((address as AddressInfo | null)?.port ?? port)
    }
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }

    server.once('listening', onListening)
    server.once('error', onError)
    server.listen(port, SERVER_HOST)
  })

export interface PackagedLauncherStaticServerInput {
  clientBase?: string
  distPath: string
  port: number
}

export const startPackagedLauncherStaticServer = async ({
  clientBase = CLIENT_BASE,
  distPath,
  port
}: PackagedLauncherStaticServerInput) => {
  const normalizedBase = normalizeClientBase(clientBase)
  const placeholderBase = normalizeClientBase(DEFAULT_BASE_PLACEHOLDER)
  const supportedBases = Array.from(new Set([normalizedBase, placeholderBase]))
  let cachedIndexHtml: string | null = null

  const loadIndexHtml = async () => {
    if (cachedIndexHtml != null) {
      return cachedIndexHtml
    }
    const raw = await readFile(path.join(distPath, 'index.html'), 'utf8')
    cachedIndexHtml = raw
      .split(DEFAULT_BASE_PLACEHOLDER).join(normalizedBase)
      .replace('</head>', `${createRuntimeScript(normalizedBase)}</head>`)
    return cachedIndexHtml
  }

  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }

    try {
      const requestPath = new URL(request.url ?? '/', `http://${SERVER_HOST}`).pathname
      const trimmedBases = supportedBases.map(trimTrailingSlash)
      if (requestPath === '/' || trimmedBases.includes(requestPath)) {
        response.writeHead(308, { Location: normalizedBase })
        response.end()
        return
      }

      const matchedBase = supportedBases.find(candidate => (
        candidate === '/' || requestPath.startsWith(candidate)
      ))
      if (matchedBase == null) {
        writeText(request, response, 404, 'Not Found', 'text/plain; charset=utf-8')
        return
      }

      const relativePath = matchedBase === '/'
        ? requestPath.replace(/^\/+/, '')
        : requestPath.slice(matchedBase.length)
      if (relativePath !== '') {
        const resolved = resolveStaticFile(distPath, relativePath)
        if (resolved != null && await sendFile(request, response, resolved)) {
          return
        }
      }

      writeText(request, response, 200, await loadIndexHtml(), 'text/html; charset=utf-8')
    } catch (error) {
      console.error('[oneworks-client:launcher] failed to serve launcher client', error)
      writeText(request, response, 500, 'Failed to load UI', 'text/plain; charset=utf-8')
    }
  })

  const resolvedPort = await listen(server, port)
  return {
    clientUrl: `http://${SERVER_HOST}:${resolvedPort}${normalizedBase}`,
    server
  }
}
