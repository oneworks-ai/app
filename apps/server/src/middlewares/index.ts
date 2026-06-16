import cors from '@koa/cors'
import type Koa from 'koa'
import bodyParser from 'koa-bodyparser'

import { loadEnv } from '@oneworks/core'
import type { ServerEnv } from '@oneworks/core'

import { apiEnvelopeMiddleware } from './api-envelope'
import { authMiddleware } from './auth'
import type { PublicAccessOptions } from './public-access'
import { publicAccessMiddleware } from './public-access'

export const JSON_BODY_LIMIT = '32mb'

export interface InitMiddlewaresOptions {
  publicPaths?: PublicAccessOptions['publicPaths']
}

const parseAllowedCorsOrigins = (value: string | undefined) => (
  (value ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin !== '')
)

export async function initMiddlewares(
  app: Koa,
  env: ServerEnv = loadEnv(),
  options: InitMiddlewaresOptions = {}
) {
  if (env.__ONEWORKS_PROJECT_SERVER_ALLOW_CORS__) {
    const allowedOrigins = parseAllowedCorsOrigins(env.__ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__)
    app.use(cors({
      origin: (ctx) => {
        const requestOrigin = ctx.get('Origin')
        if (allowedOrigins.length === 0) {
          return requestOrigin || '*'
        }
        return allowedOrigins.includes(requestOrigin) ? requestOrigin : ''
      },
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization']
    }))
  }
  app.use(publicAccessMiddleware({
    publicPaths: options.publicPaths
  }))
  app.use(apiEnvelopeMiddleware())
  app.use(bodyParser({
    jsonLimit: JSON_BODY_LIMIT
  }))
  app.use(authMiddleware(env))
}
