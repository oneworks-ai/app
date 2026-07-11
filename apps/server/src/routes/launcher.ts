import Router from '@koa/router'

import type { loadEnv } from '@oneworks/core'

import {
  createLauncherWorkspaceInDirectory,
  forgetLauncherWorkspace,
  listLauncherDirectories,
  listLauncherWorkspaceRuntimeEndpoints,
  listLauncherWorkspaces,
  openLauncherWorkspace,
  openLauncherWorkspaceById,
  restartLauncherWorkspaceById,
  stopLauncherWorkspace
} from '#~/services/launcher/manager.js'
import { notFound } from '#~/utils/http.js'

import { proxyLauncherWorkspaceResource } from './launcher-workspace-resource-proxy'

const normalizeLauncherClientOrigin = (value: string | undefined) => {
  const trimmedValue = value?.trim()
  if (trimmedValue == null || trimmedValue === '') return undefined

  try {
    const url = new URL(trimmedValue)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

const getLauncherClientOrigin = (ctx: Router.RouterContext) => (
  normalizeLauncherClientOrigin(ctx.get('X-OneWorks-Client-Origin')) ??
    normalizeLauncherClientOrigin(ctx.get('Origin')) ??
    normalizeLauncherClientOrigin(ctx.get('Referer')) ??
    normalizeLauncherClientOrigin(ctx.origin)
)

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
    const clientOrigin = getLauncherClientOrigin(ctx)
    ctx.body = await openLauncherWorkspace(body?.workspaceFolder, { clientOrigin })
  })

  router.get('/workspaces/:workspaceId/connection', async (ctx) => {
    const { workspaceId } = ctx.params as { workspaceId?: string }
    const clientOrigin = getLauncherClientOrigin(ctx)
    ctx.body = await openLauncherWorkspaceById(workspaceId, { clientOrigin })
  })

  router.post('/workspaces/:workspaceId/restart', async (ctx) => {
    const { workspaceId } = ctx.params as { workspaceId?: string }
    const clientOrigin = getLauncherClientOrigin(ctx)
    ctx.body = await restartLauncherWorkspaceById(workspaceId, { clientOrigin })
  })

  const handleWorkspaceResource = async (ctx: Router.RouterContext) => {
    const { workspaceId } = ctx.params as { workspaceId?: string }
    const endpoint = (await listLauncherWorkspaceRuntimeEndpoints()).find(candidate => (
      candidate.workspaceId === workspaceId &&
      candidate.status === 'online' &&
      candidate.serverBaseUrl != null
    ))
    if (endpoint?.serverBaseUrl == null) {
      throw notFound('Running workspace not found.', { workspaceId }, 'workspace_not_running')
    }
    await proxyLauncherWorkspaceResource(ctx, endpoint.serverBaseUrl)
  }

  router.get('/workspaces/:workspaceId/resource', handleWorkspaceResource)
  router.head('/workspaces/:workspaceId/resource', handleWorkspaceResource)

  router.post('/workspaces/forget', async (ctx) => {
    const body = ctx.request.body as { workspaceFolder?: unknown }
    ctx.body = await forgetLauncherWorkspace(body?.workspaceFolder)
  })

  router.post('/workspaces/stop', async (ctx) => {
    const body = ctx.request.body as { forget?: unknown; workspaceFolder?: unknown }
    ctx.body = await stopLauncherWorkspace(body?.workspaceFolder, { forget: body?.forget === true })
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
