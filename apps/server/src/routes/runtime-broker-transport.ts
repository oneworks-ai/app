import http from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'

import type { loadEnv } from '@oneworks/core'

import { runtimeBrokerRouter } from './runtime-broker'

const RUNTIME_BROKER_LOOPBACK_HOST = '127.0.0.1'
const RUNTIME_BROKER_PATH = '/api/internal/runtime-broker'

export interface RuntimeBrokerLoopbackTransport {
  baseUrl: string
  close(): Promise<void>
  server: http.Server
}

const closeServer = (server: http.Server) =>
  new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve()
    server.close(error => error == null ? resolve() : reject(error))
  })

export const startRuntimeBrokerLoopbackTransport = async (
  env: ReturnType<typeof loadEnv>
): Promise<RuntimeBrokerLoopbackTransport> => {
  const app = new Koa()
  const root = new Router()
  const brokerRouter = runtimeBrokerRouter(env)
  root.use(RUNTIME_BROKER_PATH, brokerRouter.routes(), brokerRouter.allowedMethods())
  app.use(bodyParser())
  app.use(root.routes())
  app.use(root.allowedMethods())

  const server = http.createServer(app.callback())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, RUNTIME_BROKER_LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address == null || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Runtime broker loopback transport failed to resolve its listening address.')
  }

  return {
    baseUrl: `http://${RUNTIME_BROKER_LOOPBACK_HOST}:${address.port}`,
    close: () => closeServer(server),
    server
  }
}
