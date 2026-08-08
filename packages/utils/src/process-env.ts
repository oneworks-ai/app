export const ONEWORKS_INTERNAL_LOADER_ENV_KEYS = [
  '__ONEWORKS_CLI_HELPER_LOADER_ACTIVE__',
  '__ONEWORKS_HOOK_LOADER_ACTIVE__'
] as const

export const ONEWORKS_LEGACY_LOADER_ENV_KEYS = [
  '__IS_LOADER_CLI__',
  '__IS_ONEWORKS_HOOK_LOADER__'
] as const

const ONEWORKS_LOADER_ENV_KEYS = [
  ...ONEWORKS_INTERNAL_LOADER_ENV_KEYS,
  ...ONEWORKS_LEGACY_LOADER_ENV_KEYS
] as const

const omitEnvKeys = (
  env: NodeJS.ProcessEnv,
  keys: readonly string[]
): NodeJS.ProcessEnv => {
  const sanitizedEnv = { ...env }
  for (const key of keys) {
    delete sanitizedEnv[key]
  }
  return sanitizedEnv
}

export const sanitizeOneWorksLoaderEnv = (
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => omitEnvKeys(env, ONEWORKS_LOADER_ENV_KEYS)

export const sanitizeInheritedNodeRuntimeEnv = (
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv =>
  omitEnvKeys(
    sanitizeOneWorksLoaderEnv(env),
    ['NODE_OPTIONS', 'NODE_PATH']
  )
