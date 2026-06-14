import Router from '@koa/router'

import { getWebDebugChiiRuntime } from '#~/services/web-debug/chii-runtime.js'

export function webDebugRouter(): Router {
  const router = new Router()

  router.get('/chii', (ctx) => {
    ctx.set('Cache-Control', 'no-store')
    ctx.body = getWebDebugChiiRuntime(ctx.origin)
  })

  return router
}
