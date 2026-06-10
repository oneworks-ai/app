import type { ChildProcess } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'

import { CLIENT_READY_PATH, CLIENT_READY_TIMEOUT_MS, SERVER_HOST, SERVER_READY_TIMEOUT_MS } from './constants'

const SERVER_READY_EVENT_PREFIX = '[oneworks-desktop-server-ready]'

interface WaitForHttpReadyInput {
  errorMessage: string
  path: string
  port: number
  startedAt?: number
  timeoutMs: number
}

export const getAvailablePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer()

    server.once('error', reject)
    server.listen(0, SERVER_HOST, () => {
      const address = server.address()
      server.close(() => {
        if (address == null || typeof address === 'string') {
          reject(new Error('Failed to allocate a local server port.'))
          return
        }
        resolve(address.port)
      })
    })
  })

export const waitForHttpReady = ({
  errorMessage,
  path: readyPath,
  port,
  startedAt = Date.now(),
  timeoutMs
}: WaitForHttpReadyInput) =>
  new Promise<void>((resolve, reject) => {
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(errorMessage))
        return
      }
      setTimeout(() => {
        waitForHttpReady({ errorMessage, path: readyPath, port, startedAt, timeoutMs }).then(resolve, reject)
      }, 250)
    }

    const request = http.get({
      hostname: SERVER_HOST,
      path: readyPath,
      port,
      timeout: 1000
    }, (response) => {
      response.resume()
      if ((response.statusCode ?? 500) < 500) {
        resolve()
        return
      }
      retry()
    })

    request.once('timeout', () => {
      request.destroy()
      retry()
    })

    request.once('error', retry)
  })

export const waitForClientReady = ({ port, startedAt = Date.now() }: { port: number; startedAt?: number }) =>
  waitForHttpReady({
    errorMessage: 'Timed out while waiting for the One Works client dev server.',
    path: CLIENT_READY_PATH,
    port,
    startedAt,
    timeoutMs: CLIENT_READY_TIMEOUT_MS
  })

export const waitForServerReadyEvent = (
  child: ChildProcess,
  startedAt = Date.now()
) =>
  new Promise<void>((resolve, reject) => {
    if (child.stdout == null) {
      reject(new Error('One Works server child stdout is not available.'))
      return
    }

    let bufferedOutput = ''
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out while waiting for the One Works server ready event.'))
    }, Math.max(SERVER_READY_TIMEOUT_MS - (Date.now() - startedAt), 1))

    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
    }

    const onData = (chunk: unknown) => {
      bufferedOutput += String(chunk)
      const lines = bufferedOutput.split(/\r?\n/u)
      bufferedOutput = lines.pop() ?? ''
      if (lines.some(line => line.startsWith(SERVER_READY_EVENT_PREFIX))) {
        cleanup()
        resolve()
      }
    }

    child.stdout.on('data', onData)
  })

export const waitForChildStartup = (
  child: ChildProcess,
  waitForReady: () => Promise<void>,
  exitMessage: string
) =>
  new Promise<void>((resolve, reject) => {
    let settled = false

    const settleResolve = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const settleReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    function onError(error: Error) {
      settleReject(error)
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      settleReject(
        new Error(`${exitMessage} (code=${code ?? 'null'} signal=${signal ?? 'null'}).`)
      )
    }

    function cleanup() {
      child.off('error', onError)
      child.off('exit', onExit)
    }

    child.once('error', onError)
    child.once('exit', onExit)
    waitForReady().then(
      settleResolve,
      settleReject
    )
  })

export const waitForServerStartup = (child: ChildProcess) =>
  waitForChildStartup(
    child,
    () => waitForServerReadyEvent(child),
    'One Works server exited before it was ready'
  )

export const waitForClientStartup = (child: ChildProcess, port: number) =>
  waitForChildStartup(
    child,
    () => waitForClientReady({ port }),
    'One Works client dev server exited before it was ready'
  )
