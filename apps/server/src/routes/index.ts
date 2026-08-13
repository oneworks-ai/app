import Router from '@koa/router'

import type Koa from 'koa'

import type { loadEnv } from '@oneworks/core'

import { logger } from '#~/utils/logger.js'

import { mountLazyRouter } from './lazy-router'
import {
  DEFAULT_BASE_PLACEHOLDER,
  createRuntimeScript,
  normalizeClientBase,
  resolveClientDistPath,
  trimTrailingSlash
} from './static-client'
import { uiRouter } from './ui'

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
  mountLazyRouter(router, '/api/sessions/:sessionId/git', async () => (await import('./git.js')).gitRouter())
  mountLazyRouter(router, '/api/sessions', async () => (await import('./sessions.js')).sessionsRouter())
  mountLazyRouter(router, '/api/agent-rooms', async () => (await import('./agent-rooms.js')).agentRoomsRouter())
  mountLazyRouter(router, '/api/adapters', async () => (await import('./adapters.js')).adaptersRouter())
  mountLazyRouter(router, '/api/interact', async () => (await import('./interact.js')).interactRouter())
  mountLazyRouter(router, '/api/launcher', async () => (await import('./launcher.js')).launcherRouter(env))
  mountLazyRouter(
    router,
    '/api/module-updates',
    async () => (await import('./module-updates.js')).moduleUpdatesRouter()
  )
  mountLazyRouter(
    router,
    '/api/model-providers',
    async () => (await import('./model-providers.js')).modelProvidersRouter()
  )
  mountLazyRouter(
    router,
    '/api/model-services',
    async () => (await import('./model-providers.js')).modelServicesRouter()
  )
  mountLazyRouter(
    router,
    '/api/mobile-debug',
    async () => (await import('./mobile-debug.js')).mobileDebugRouter()
  )
  mountLazyRouter(router, '/api/plugins', async () => (await import('./plugins.js')).pluginsRouter())
  mountLazyRouter(
    router,
    '/api/internal/runtime-broker',
    async () => (await import('./runtime-broker.js')).runtimeBrokerRouter(env)
  )
  mountLazyRouter(
    router,
    '/api/internal/codex-shared-model',
    async () => (await import('./codex-shared-model.js')).codexSharedModelRouter(env)
  )
  mountLazyRouter(router, '/api/auth', async () => (await import('./auth.js')).authRouter(env))
  mountLazyRouter(router, '/api/ai', async () => (await import('./ai.js')).aiRouter())
  mountLazyRouter(router, '/api/benchmark', async () => (await import('./benchmark.js')).benchmarkRouter())
  mountLazyRouter(router, '/api/skill-hub', async () => (await import('./skill-hub.js')).skillHubRouter())
  mountLazyRouter(
    router,
    '/channels/actions',
    async () => (await import('./channel-actions.js')).channelActionsRouter()
  )
  mountLazyRouter(
    router,
    '/channels',
    async () => (await import('./channel-webhooks.js')).channelWebhooksRouter()
  )
  mountLazyRouter(router, '/api/channels', async () => (await import('./channel-send.js')).channelSendRouter())
  mountLazyRouter(router, '/api/automation', async () => (await import('./automation.js')).automationRouter())
  mountLazyRouter(router, '/api/config', async () => (await import('./config.js')).configRouter())
  mountLazyRouter(router, '/api/diagnostics', async () => (await import('./diagnostics.js')).diagnosticsRouter())
  mountLazyRouter(router, '/api/events', async () => (await import('./events.js')).eventsRouter())
  mountLazyRouter(router, '/api/usage', async () => (await import('./usage.js')).usageRouter())
  mountLazyRouter(router, '/api/voice', async () => (await import('./voice.js')).voiceRouter())
  mountLazyRouter(router, '/api/web-debug', async () => (await import('./web-debug.js')).webDebugRouter())
  mountLazyRouter(router, '/api/webpage', async () => (await import('./webpage.js')).webpageRouter())
  mountLazyRouter(
    router,
    '/api/worktree-environments',
    async () => (await import('./worktree-environments.js')).worktreeEnvironmentsRouter()
  )
  mountLazyRouter(router, '/api/workspace', async () => (await import('./workspace.js')).workspaceRouter())

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

    const staticUiRouter = createStaticUiRouter()
    router.use(mountedClientBase, staticUiRouter.routes(), staticUiRouter.allowedMethods())

    if (clientBase !== DEFAULT_BASE_PLACEHOLDER) {
      const placeholderRouter = createStaticUiRouter()
      router.use(DEFAULT_BASE_PLACEHOLDER, placeholderRouter.routes(), placeholderRouter.allowedMethods())
    }
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
