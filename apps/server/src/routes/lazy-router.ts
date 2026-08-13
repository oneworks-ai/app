import type Router from '@koa/router'

export type LazyRouterLoader = () => Promise<Router>

const lazyRouteLayers = new WeakSet<Router.Layer>()
const lazyRouteParents = new WeakMap<Router.Layer, object>()
const primaryLazyRouteLayers = new WeakMap<object, Map<object, Router.Layer>>()

const createMountedRouterMiddleware = (prefix: string, childRouter: Router): Router.Middleware => {
  childRouter.prefix(prefix)
  const routes = childRouter.routes()
  const allowedMethods = childRouter.allowedMethods()

  return async (ctx, next) => {
    await routes(ctx, async () => await allowedMethods(ctx, next))
  }
}

export const mountLazyRouter = (
  parentRouter: Router,
  prefix: string,
  load: LazyRouterLoader
) => {
  let middlewarePromise: Promise<Router.Middleware> | undefined
  const getMiddleware = () => {
    middlewarePromise ??= load()
      .then(childRouter => createMountedRouterMiddleware(prefix, childRouter))
      .catch((error: unknown) => {
        middlewarePromise = undefined
        throw error
      })
    return middlewarePromise
  }

  const lazyRouteLayer = parentRouter.register(
    prefix,
    parentRouter.methods,
    async (ctx, next) => {
      let primaryLayersByRouter = primaryLazyRouteLayers.get(ctx)
      if (primaryLayersByRouter == null) {
        primaryLayersByRouter = new Map()
        primaryLazyRouteLayers.set(ctx, primaryLayersByRouter)
      }
      let primaryLayer = primaryLayersByRouter.get(parentRouter)
      if (primaryLayer == null) {
        primaryLayer = ctx.matched.find(
          (layer: Router.Layer) => lazyRouteParents.get(layer) === parentRouter
        )
        if (primaryLayer != null) {
          primaryLayersByRouter.set(parentRouter, primaryLayer)
        }
      }

      // The catch-all layer exists only to trigger the first module load. Keep it
      // out of Koa Router's method negotiation so the real child routes retain
      // their original 404/405/Allow semantics.
      ctx.matched = ctx.matched.filter((layer: Router.Layer) => !lazyRouteLayers.has(layer))
      if (primaryLayer !== lazyRouteLayer) {
        await next()
        return
      }

      const middleware = await getMiddleware()
      await middleware(ctx, next)
    },
    { end: false, name: null }
  )
  lazyRouteLayers.add(lazyRouteLayer)
  lazyRouteParents.set(lazyRouteLayer, parentRouter)
}
