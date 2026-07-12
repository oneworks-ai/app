import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { WebContents } from 'electron'

import type { InteractionPanelWebviewScope } from './browser-activity'
import type { SendBrowserControlPageCommand } from './browser-control-page-commands'
import { createBrowserControlOperations } from './browser-control-operations'
import type { BrowserControlRequest } from './browser-control-operations'
import { createBrowserControlPages, pageSummary } from './browser-control-pages'

const browserControlHost = '127.0.0.1'
const requestBodyLimit = 1024 * 1024
const credentialDirectory = path.join(tmpdir(), 'oneworks-browser-control')

const credentialPathForWorkspace = (workspaceFolder: string) =>
  path.join(
    credentialDirectory,
    `${createHash('sha256').update(path.resolve(workspaceFolder)).digest('hex').slice(0, 24)}.json`
  )

interface BrowserControlBrokerOptions {
  getWebContentsById?: (id: number) => WebContents | undefined
  getWorkspaceHostWebContents?: (workspaceFolder: string) => WebContents[]
  listWebviewScopes?: () => InteractionPanelWebviewScope[]
  now?: () => number
  sendPageCommand?: SendBrowserControlPageCommand
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)
const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff'
  })
  response.end(JSON.stringify(body))
}

const readRequestBody = async (request: IncomingMessage): Promise<unknown> =>
  await new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > requestBodyLimit) {
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.once('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text === '' ? {} : JSON.parse(text))
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }))
      }
    })
    request.once('error', reject)
  })

export const createBrowserControlBroker = (options: BrowserControlBrokerOptions = {}) => {
  const tokens = new Map<string, string>()
  const credentialPaths = new Map<string, string>()
  const pages = createBrowserControlPages(options)
  const operations = createBrowserControlOperations({ ...options, pages })
  let server: Server | undefined
  let baseUrl: string | undefined

  const createToken = (workspaceFolder: string) => {
    const normalized = path.resolve(workspaceFolder)
    const existing = [...tokens.entries()].find(([, workspace]) => workspace === normalized)?.[0]
    const token = existing ?? randomBytes(32).toString('base64url')
    if (existing == null) tokens.set(token, normalized)
    if (baseUrl != null) {
      mkdirSync(credentialDirectory, { mode: 0o700, recursive: true })
      chmodSync(credentialDirectory, 0o700)
      const credentialPath = credentialPathForWorkspace(normalized)
      const temporaryPath = `${credentialPath}.${randomBytes(6).toString('hex')}.tmp`
      try {
        writeFileSync(temporaryPath, JSON.stringify({ baseUrl, token, workspaceFolder: normalized }), {
          flag: 'wx',
          mode: 0o600
        })
        renameSync(temporaryPath, credentialPath)
      } finally {
        rmSync(temporaryPath, { force: true })
      }
      chmodSync(credentialPath, 0o600)
      credentialPaths.set(credentialPath, token)
    }
    return token
  }

  const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/control') {
        json(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } })
        return
      }
      const authorization = request.headers.authorization ?? ''
      const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
      const workspaceFolder = tokens.get(token)
      if (workspaceFolder == null) {
        json(response, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid browser control token.' } })
        return
      }
      const parsed = await readRequestBody(request)
      if (!isRecord(parsed)) throw Object.assign(new Error('Request body must be an object.'), { statusCode: 400 })
      if (parsed.op === 'list_pages') {
        const result = pages.listPages(workspaceFolder, normalizeText(parsed.session_id) || undefined).map(pageSummary)
        json(response, 200, { ok: true, pages: result })
        return
      }
      json(response, 200, {
        ok: true,
        result: await operations.execute(
          workspaceFolder,
          parsed as BrowserControlRequest
        )
      })
    } catch (error) {
      const record = isRecord(error) ? error : {}
      json(response, typeof record.statusCode === 'number' ? record.statusCode : 500, {
        ok: false,
        error: {
          code: normalizeText(record.code) || 'BROWSER_CONTROL_FAILED',
          message: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  const start = async () => {
    if (baseUrl != null) return baseUrl
    server = createServer((request, response) => void handleRequest(request, response))
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, browserControlHost, () => resolve())
    })
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Browser control broker did not bind a port.')
    baseUrl = `http://${browserControlHost}:${address.port}`
    return baseUrl
  }

  const stop = async () => {
    const current = server
    server = undefined
    baseUrl = undefined
    tokens.clear()
    credentialPaths.forEach((token, credentialPath) => {
      try {
        const stats = lstatSync(credentialPath)
        if (!stats.isFile() || stats.isSymbolicLink()) return
        const current = JSON.parse(readFileSync(credentialPath, 'utf8')) as { token?: string }
        if (current.token === token) rmSync(credentialPath, { force: true })
      } catch {}
    })
    credentialPaths.clear()
    if (current != null) {
      await new Promise<void>((resolve, reject) => (
        current.close(error => error == null ? resolve() : reject(error))
      ))
    }
  }

  const getWorkspaceEnv = (workspaceFolder: string): NodeJS.ProcessEnv =>
    baseUrl == null ? {} : {
      __ONEWORKS_DESKTOP_BROWSER_CONTROL_URL__: baseUrl,
      __ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__: createToken(workspaceFolder)
    }

  return { getWorkspaceEnv, start, stop }
}

export type BrowserControlBroker = ReturnType<typeof createBrowserControlBroker>
