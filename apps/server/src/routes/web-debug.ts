import Router from '@koa/router'

import type { loadEnv } from '@oneworks/core'

import {
  createWebDebugWorkspaceChiiBasePath,
  getWebDebugChiiRuntime,
  normalizeWebDebugWorkspaceId
} from '#~/services/web-debug/chii-runtime.js'

export function webDebugRouter(env: ReturnType<typeof loadEnv>): Router {
  const router = new Router()

  router.get('/chii', (ctx) => {
    const workspaceId = normalizeWebDebugWorkspaceId(ctx.query.workspaceId)
    const basePath = env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager' && workspaceId != null
      ? createWebDebugWorkspaceChiiBasePath(workspaceId)
      : undefined

    ctx.set('Cache-Control', 'no-store')
    ctx.body = getWebDebugChiiRuntime(ctx.origin, { basePath })
  })

  return router
}
