import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join } from 'node:path'
import process from 'node:process'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import type { ApiEnvelope, McpClient } from './agent-room-smoke-types'

export const repoRoot = process.cwd()
export const projectHome = resolveProjectHomePath(repoRoot, process.env)

const packageRequire = createRequire(join(repoRoot, 'packages/mcp/package.json'))
const { Client } = packageRequire('@modelcontextprotocol/sdk/client/index.js') as {
  Client: new(info: { name: string; version: string }) => McpClient
}
const { StdioClientTransport } = packageRequire('@modelcontextprotocol/sdk/client/stdio.js') as {
  StdioClientTransport: new(params: {
    args: string[]
    command: string
    cwd: string
    env: NodeJS.ProcessEnv
    stderr: 'pipe'
  }) => {
    stderr?: NodeJS.ReadableStream
  }
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const getFreePort = async () =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address == null || typeof address === 'string') {
          reject(new Error('Failed to allocate a local port'))
          return
        }
        resolve(address.port)
      })
    })
  })

export const waitFor = async <T>(
  label: string,
  fn: () => Promise<T | false | null | undefined> | T | false | null | undefined,
  timeoutMs = 180_000,
  intervalMs = 500
): Promise<T> => {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }

  const suffix = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`${label} timed out${suffix}`)
}

const unwrapApiResponse = <T>(payload: ApiEnvelope<T> | T): T => {
  if (payload != null && typeof payload === 'object' && 'success' in payload) {
    const envelope = payload as ApiEnvelope<T>
    if (envelope.success === true && 'data' in envelope) {
      return envelope.data as T
    }
    if (envelope.success === false) {
      throw new Error(envelope.error?.message ?? 'OneWorks server request failed')
    }
  }
  return payload as T
}

export const api = async <T>(baseUrl: string, route: string, options: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {})
    }
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${route} -> ${response.status}: ${text}`)
  }
  return text.trim() === '' ? undefined as T : unwrapApiResponse<T>(JSON.parse(text) as ApiEnvelope<T>)
}

export const parseToolJson = <T>(result: unknown): T => {
  const content = (result as { content?: Array<{ text?: string; type?: string }> }).content ?? []
  const text = content.find(item => item.type === 'text')?.text
  if (text == null || text.trim() === '') {
    throw new Error(`No text content in tool result: ${JSON.stringify(result)}`)
  }
  return JSON.parse(text) as T
}

export const countIncludes = (value: string, needle: string) => value.split(needle).length - 1

export const terminateProcess = async (child: ReturnType<typeof spawn> | undefined) => {
  if (child == null || child.exitCode != null || child.signalCode != null) return

  await new Promise<void>(resolve => {
    child.once('close', () => resolve())
    child.kill('SIGTERM')
  })
}

export const startServerProcess = (tmp: string, serverPort: number) => {
  let output = ''
  const child = spawn(process.execPath, [
    'apps/server/cli.js',
    '--host',
    '127.0.0.1',
    '--port',
    String(serverPort),
    '--workspace',
    repoRoot,
    '--data-dir',
    join(tmp, 'data')
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DB_PATH: join(tmp, 'db.sqlite'),
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'none',
      __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: 'true',
      __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
      __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: 'warn',
      __ONEWORKS_PROJECT_SERVER_PORT__: String(serverPort)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', chunk => {
    output += String(chunk)
  })
  child.stderr?.on('data', chunk => {
    output += String(chunk)
  })
  return { child, getOutput: () => output }
}

export const connectMcpClient = async (input: {
  mockPort: number
  parentSessionId: string
  serverPort: number
}) => {
  let stderr = ''
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      'packages/mcp/cli.js',
      '--include-tools',
      'StartTasks,GetTaskInfo,ListTasks,SendTaskMessage,SubmitTaskInput'
    ],
    cwd: repoRoot,
    stderr: 'pipe',
    env: {
      ...process.env,
      HOOK_SMOKE_MOCK_PORT: String(input.mockPort),
      __ONEWORKS_PROJECT_CTX_ID__: input.parentSessionId,
      __ONEWORKS_PROJECT_DISABLE_DEV_CONFIG__: '1',
      __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1',
      __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
      __ONEWORKS_PROJECT_SERVER_PORT__: String(input.serverPort),
      __ONEWORKS_PROJECT_SESSION_ID__: input.parentSessionId,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: repoRoot,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: repoRoot
    }
  })
  transport.stderr?.on('data', chunk => {
    stderr += String(chunk)
  })

  const client = new Client({ name: 'agent-room-resume-smoke', version: '1.0.0' })
  await client.connect(transport)
  return { client, getStderr: () => stderr }
}
