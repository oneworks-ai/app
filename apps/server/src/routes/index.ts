import Router from '@koa/router'

import type Koa from 'koa'

import type { loadEnv } from '@oneworks/core'

import { logger } from '#~/utils/logger.js'

import { adaptersRouter } from './adapters'
import { agentRoomsRouter } from './agent-rooms'
import { aiRouter } from './ai'
import { authRouter } from './auth'
import { automationRouter } from './automation'
import { benchmarkRouter } from './benchmark'
import { channelActionsRouter } from './channel-actions'
import { channelSendRouter } from './channel-send'
import { channelWebhooksRouter } from './channel-webhooks'
import { configRouter } from './config'
import { gitRouter } from './git'
import { interactRouter } from './interact'
import { launcherRouter } from './launcher'
import { moduleUpdatesRouter } from './module-updates'
import { pluginsRouter } from './plugins'
import { sessionsRouter } from './sessions'
import { skillHubRouter } from './skill-hub'
import {
  DEFAULT_BASE_PLACEHOLDER,
  createRuntimeScript,
  normalizeClientBase,
  resolveClientDistPath,
  trimTrailingSlash
} from './static-client'
import { uiRouter } from './ui'
import { voiceRouter } from './voice'
import { webDebugRouter } from './web-debug'
import { webpageRouter } from './webpage'
import { workspaceRouter } from './workspace'
import { worktreeEnvironmentsRouter } from './worktree-environments'

export interface MountRoutesOptions {
  logClientMount?: boolean
  serverBaseUrl?: string
}

export const mountRoutes = async (
  app: Koa,
  env: ReturnType<typeof loadEnv>,
  options: MountRoutesOptions = {}
) => {
  const router = new Router()
  const clientBaseRedirects = new Map<string, string>()
  const routers = [
    { prefix: '/api/sessions/:sessionId/git', router: gitRouter() },
    { prefix: '/api/sessions', router: sessionsRouter() },
    { prefix: '/api/agent-rooms', router: agentRoomsRouter() },
    { prefix: '/api/adapters', router: adaptersRouter() },
    { prefix: '/api/interact', router: interactRouter() },
    { prefix: '/api/launcher', router: launcherRouter(env) },
    { prefix: '/api/module-updates', router: moduleUpdatesRouter() },
    { prefix: '/api/plugins', router: pluginsRouter() },
    { prefix: '/api/auth', router: authRouter(env) },
    { prefix: '/api/ai', router: aiRouter() },
    { prefix: '/api/benchmark', router: benchmarkRouter() },
    { prefix: '/api/skill-hub', router: skillHubRouter() },
    { prefix: '/channels', router: channelWebhooksRouter() },
    { prefix: '/channels/actions', router: channelActionsRouter() },
    { prefix: '/api/channels', router: channelSendRouter() },
    { prefix: '/api/automation', router: automationRouter() },
    { prefix: '/api/config', router: configRouter() },
    { prefix: '/api/voice', router: voiceRouter() },
    { prefix: '/api/web-debug', router: webDebugRouter() },
    { prefix: '/api/webpage', router: webpageRouter() },
    { prefix: '/api/worktree-environments', router: worktreeEnvironmentsRouter() },
    { prefix: '/api/workspace', router: workspaceRouter() }
  ]

  const clientMode = env.__ONEWORKS_PROJECT_CLIENT_MODE__
  const clientBase = normalizeClientBase(env.__ONEWORKS_PROJECT_CLIENT_BASE__)
  const mountedClientBase = clientBase === '/' ? '' : clientBase
  const clientDistPath = clientMode === 'dev' || clientMode === 'none'
    ? null
    : resolveClientDistPath(env.__ONEWORKS_PROJECT_CLIENT_DIST_PATH__)
  const runtimeScript = createRuntimeScript(env, clientBase, options.serverBaseUrl)
  if (clientDistPath && clientMode !== 'dev') {
    const registerBaseRedirect = (base: string) => {
      const redirectFrom = trimTrailingSlash(base)
      if (redirectFrom === '/') {
        return
      }
      clientBaseRedirects.set(redirectFrom, base)
    }

    registerBaseRedirect(clientBase)

    const createStaticUiRouter = () =>
      uiRouter({
        base: clientBase,
        distPath: clientDistPath,
        runtimeScript,
        basePlaceholder: DEFAULT_BASE_PLACEHOLDER
      })

    routers.push({
      prefix: mountedClientBase,
      router: createStaticUiRouter()
    })

    if (clientBase !== DEFAULT_BASE_PLACEHOLDER) {
      routers.push({
        prefix: DEFAULT_BASE_PLACEHOLDER,
        router: createStaticUiRouter()
      })
    }
  }

  for (const { prefix, router: childRouter } of routers) {
    router
      .use(prefix, childRouter.routes(), childRouter.allowedMethods())
  }

  app
    .use(async (ctx, next) => {
      const redirectTarget = ctx.method === 'GET'
        ? clientBaseRedirects.get(ctx.path)
        : undefined
      if (redirectTarget != null) {
        ctx.status = 308
        ctx.redirect(redirectTarget)
        return
      }
      await next()
    })
    .use(router.routes())
    .use(router.allowedMethods())

  return {
    onListen: (httpHost: string) => {
      if (clientMode !== 'dev' && options.logClientMount !== false) {
        if (clientDistPath) {
          logger.info(`[server]              ${httpHost}${clientBase} from ${clientDistPath}`)
        } else {
          logger.info('[server] client dist not found, static hosting disabled')
        }
      }
    }
  }
}
