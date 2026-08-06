import type Koa from 'koa'

import type { ServerEnv } from '@oneworks/core'

import { ASSET_PRE_COMMIT_DETAILS, markAssetPreCommitFailure } from '#~/services/ai/asset-create-error.js'
import {
  AUTH_COOKIE_NAME,
  getBearerTokenFromHeader,
  resolveWebAuthConfig,
  verifySessionToken
} from '#~/services/auth/index.js'
import { unauthorized } from '#~/utils/http.js'
import { ASSET_CREATE_PATH } from './asset-create-body.js'

const PUBLIC_API_PATHS = new Set([
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/logout'
])

interface AuthMiddlewareOperations {
  resolveConfig?: typeof resolveWebAuthConfig
  verifyToken?: typeof verifySessionToken
}

export const authMiddleware = (
  env: ServerEnv,
  operations: AuthMiddlewareOperations = {}
): Koa.Middleware => {
  return async (ctx, next) => {
    if (!ctx.path.startsWith('/api') || PUBLIC_API_PATHS.has(ctx.path)) {
      await next()
      return
    }

    const isAssetCreate = ctx.method === 'POST' && ctx.path === ASSET_CREATE_PATH
    let config
    try {
      config = await (operations.resolveConfig ?? resolveWebAuthConfig)(env)
    } catch (error) {
      if (isAssetCreate) {
        throw markAssetPreCommitFailure(
          error,
          'Failed to load asset authentication config',
          'asset_auth_config_failed'
        )
      }
      throw error
    }
    if (!config.enabled) {
      await next()
      return
    }

    const queryAuthToken = ctx.path === '/api/events' && typeof ctx.query.authToken === 'string'
      ? ctx.query.authToken
      : undefined
    const token = getBearerTokenFromHeader(ctx.get('Authorization')) ?? ctx.cookies.get(AUTH_COOKIE_NAME) ??
      queryAuthToken
    let authenticated
    try {
      authenticated = await (operations.verifyToken ?? verifySessionToken)(env, token)
    } catch (error) {
      if (isAssetCreate) {
        throw markAssetPreCommitFailure(
          error,
          'Failed to verify asset authentication',
          'asset_auth_verification_failed'
        )
      }
      throw error
    }
    if (!authenticated) {
      throw unauthorized(
        'Login required',
        isAssetCreate ? ASSET_PRE_COMMIT_DETAILS : undefined,
        'auth_required'
      )
    }

    await next()
  }
}
