const resolveConfig = async (context: unknown) => {
  const mod = await import('./config.js')
  return await mod.resolveConfig(context as never)
}

module.exports = resolveConfig
