import Router from '@koa/router'

import { readWebpageMetadata } from '#~/services/webpage/metadata.js'
import { badRequest } from '#~/utils/http.js'

export function webpageRouter(): Router {
  const router = new Router()

  router.get('/metadata', async (ctx) => {
    const url = typeof ctx.query.url === 'string' ? ctx.query.url : undefined
    if (url == null || url.trim() === '') {
      throw badRequest('Missing URL', undefined, 'missing_url')
    }
    ctx.body = await readWebpageMetadata(url)
  })

  return router
}
