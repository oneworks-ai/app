import net from 'node:net'
import process from 'node:process'

import { log, normalizeText, sleep } from './paths'
import type { PortResolution, TargetConfig } from './types'

export const fetchOk = async (url: string, options: {
  method?: string
  timeoutMs?: number
} = {}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 1000)
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      signal: controller.signal
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export const serverReady = async (serverUrl: string) => fetchOk(`${serverUrl}/api/auth/status`)
export const urlReady = async (url: string) => fetchOk(url, { method: 'HEAD' })

const waitForReady = async (ready: () => Promise<boolean>, errorMessage: string) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await ready()) return
    await sleep(200)
  }
  if (!(await ready())) throw new Error(errorMessage)
}

export const waitForUrl = async (url: string, errorMessage: string) => waitForReady(() => urlReady(url), errorMessage)

export const waitForServer = async (serverUrl: string) =>
  waitForReady(() => serverReady(serverUrl), `Server failed to become ready on ${serverUrl}/api/auth/status`)

const canListen = (port: number) =>
  new Promise<boolean>((resolveCanListen) => {
    const server = net.createServer()
    server.once('error', () => resolveCanListen(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolveCanListen(true))
    })
  })

const parsePort = (value: string | undefined, fallback: number | undefined, name: string) => {
  if (fallback == null) throw new Error(`${name} default port is not configured`)
  const raw = normalizeText(value)
  if (raw == null) return { explicit: false, port: fallback }
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} port must be an integer between 1 and 65535`)
  }
  return { explicit: true, port }
}

const resolvePort = async ({
  envName,
  explicit,
  name,
  preferredPort
}: {
  envName: string
  explicit: boolean
  name: string
  preferredPort: number
}) => {
  if (await canListen(preferredPort)) return preferredPort

  let nextPort = preferredPort + 1
  while (nextPort <= 65535 && !(await canListen(nextPort))) nextPort += 1
  if (nextPort > 65535) throw new Error(`No available ${name} port found after ${preferredPort}`)
  if (explicit) throw new Error(`${name} port ${preferredPort} is already in use; rerun with ${envName}=${nextPort}`)

  log(`${name} port ${preferredPort} is in use; using ${nextPort}`)
  return nextPort
}

export const resolvePorts = async (config: TargetConfig): Promise<PortResolution> => {
  const output: PortResolution = {}
  if (config.needsServer) {
    const input = parsePort(process.env.__ONEWORKS_PROJECT_SERVER_PORT__, config.defaultServerPort, 'server')
    output.serverPort = await resolvePort({
      envName: '__ONEWORKS_PROJECT_SERVER_PORT__',
      explicit: input.explicit,
      name: 'server',
      preferredPort: input.port
    })
  }
  if (config.needsClient || config.readiness === 'docs') {
    const input = parsePort(process.env.__ONEWORKS_PROJECT_CLIENT_PORT__, config.defaultClientPort, 'client')
    let preferredPort = input.port
    if (preferredPort === output.serverPort) {
      if (input.explicit) throw new Error(`client port ${preferredPort} matches server port`)
      preferredPort += 1
    }
    output.clientPort = await resolvePort({
      envName: '__ONEWORKS_PROJECT_CLIENT_PORT__',
      explicit: input.explicit,
      name: 'client',
      preferredPort
    })
  }
  return output
}
