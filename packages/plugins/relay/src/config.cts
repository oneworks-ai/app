const resolveConfig = async (context: unknown) => {
  try {
    const mod = await import('./config.js')
    return await mod.resolveConfig(context as never)
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ERR_MODULE_NOT_FOUND' ||
      !error.message.includes('/config.js')
    ) {
      throw error
    }

    // eslint-disable-next-line ts/no-require-imports -- Source condition loads the TS hook before dist/config.js exists.
    const mod = require('./config.ts') as { resolveConfig: (context: never) => unknown }
    return await mod.resolveConfig(context as never)
  }
}

module.exports = resolveConfig
