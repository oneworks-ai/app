import Router from '@koa/router'

import type { loadEnv } from '@oneworks/core'

import {
  createLauncherWorkspaceInDirectory,
  forgetLauncherWorkspace,
  listLauncherDirectories,
  listLauncherWorkspaces,
  openLauncherWorkspace
} from '#~/services/launcher/manager.js'
import { notFound } from '#~/utils/http.js'

export function launcherRouter(env: ReturnType<typeof loadEnv>): Router {
  const router = new Router()

  router.use(async (_ctx, next) => {
    if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ !== 'manager') {
      throw notFound()
    }
    await next()
  })

  router.get('/workspaces', async (ctx) => {
    ctx.body = await listLauncherWorkspaces()
  })

  router.post('/workspaces/open', async (ctx) => {
    const body = ctx.request.body as { workspaceFolder?: unknown }
    const clientOrigin = ctx.get('Origin') || ctx.origin
    ctx.body = await openLauncherWorkspace(body?.workspaceFolder, { clientOrigin })
  })

  router.post('/workspaces/forget', async (ctx) => {
    const body = ctx.request.body as { workspaceFolder?: unknown }
    ctx.body = await forgetLauncherWorkspace(body?.workspaceFolder)
  })

  router.get('/directories', async (ctx) => {
    const { directory } = ctx.query as { directory?: string }
    ctx.body = await listLauncherDirectories(directory)
  })

  router.post('/workspaces/create', async (ctx) => {
    const body = ctx.request.body as { parentDirectory?: unknown; projectName?: unknown }
    const workspaceFolder = await createLauncherWorkspaceInDirectory(body?.parentDirectory, body?.projectName)
    ctx.body = { workspaceFolder }
  })

  return router
}
