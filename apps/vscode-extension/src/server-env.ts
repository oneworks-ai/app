const NODE_RUNTIME_ENV_KEYS = [
  'NODE_OPTIONS',
  'NODE_PATH',
  '__ONEWORKS_CLI_HELPER_LOADER_ACTIVE__',
  '__ONEWORKS_HOOK_LOADER_ACTIVE__',
  ['__IS_', 'LOADER_CLI__'].join(''),
  ['__IS_', 'ONEWORKS_HOOK_LOADER__'].join('')
] as const

// The VSIX is packaged without runtime dependencies, so keep this boundary
// equivalent to @oneworks/utils/process-env and protect it with the same
// polluted-parent regression.
const sanitizeInheritedNodeRuntimeEnv = (
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const sanitizedEnv = { ...env }
  for (const key of NODE_RUNTIME_ENV_KEYS) {
    delete sanitizedEnv[key]
  }
  return sanitizedEnv
}

export const createServerRuntimeEnv = (
  workspaceFolder: string,
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const runtimeEnv = sanitizeInheritedNodeRuntimeEnv(env)
  delete runtimeEnv.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  delete runtimeEnv.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
  runtimeEnv.__ONEWORKS_PROJECT_LAUNCH_CWD__ = workspaceFolder
  runtimeEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceFolder
  runtimeEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__ = workspaceFolder
  runtimeEnv.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__ = 'false'
  return runtimeEnv
}
