interface CommonJsParentModule {
  filename?: string
}

type ResolveFilename = (
  this: unknown,
  request: string,
  parent?: CommonJsParentModule,
  isMain?: boolean,
  options?: unknown
) => string

interface CommonJsModuleWithResolve {
  _resolveFilename?: ResolveFilename
}

interface RelayConfigModule {
  resolveConfig: (context: never) => unknown
}

const isMissingConfigJsError = (error: unknown) => (
  error instanceof Error &&
  'code' in error &&
  error.code === 'ERR_MODULE_NOT_FOUND' &&
  error.message.includes('/config.js')
)

const loadSourceConfigModule = (): RelayConfigModule => {
  // eslint-disable-next-line ts/no-require-imports -- Source condition needs Node's CJS resolver patch before dist/config.js exists.
  const nodeModule = require('node:module') as CommonJsModuleWithResolve
  const originalResolveFilename = nodeModule._resolveFilename
  if (originalResolveFilename == null) {
    // eslint-disable-next-line ts/no-require-imports -- Source condition loads the TS hook before dist/config.js exists.
    return require('./config.ts') as RelayConfigModule
  }

  nodeModule._resolveFilename = function resolveRelaySourceRequest(
    request,
    parent,
    isMain,
    options
  ) {
    const parentFilename = parent?.filename?.replaceAll('\\', '/') ?? ''
    if (
      request.startsWith('.') &&
      request.endsWith('.js') &&
      parentFilename.includes('/packages/plugins/relay/src/')
    ) {
      const tsRequest = `${request.slice(0, -3)}.ts`
      try {
        return originalResolveFilename.call(this, tsRequest, parent, isMain, options)
      } catch {
        // Fall through to the original .js request so unrelated misses keep their native error.
      }
    }

    return originalResolveFilename.call(this, request, parent, isMain, options)
  }

  try {
    // eslint-disable-next-line ts/no-require-imports -- Source condition loads the TS hook before dist/config.js exists.
    return require('./config.ts') as RelayConfigModule
  } finally {
    nodeModule._resolveFilename = originalResolveFilename
  }
}

const resolveConfig = async (context: unknown) => {
  try {
    const mod = await import('./config.js')
    return await mod.resolveConfig(context as never)
  } catch (error) {
    if (!isMissingConfigJsError(error)) {
      throw error
    }

    const mod = loadSourceConfigModule()
    return await mod.resolveConfig(context as never)
  }
}

module.exports = resolveConfig
