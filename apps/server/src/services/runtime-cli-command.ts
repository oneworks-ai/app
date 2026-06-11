import process from 'node:process'

export const resolveRuntimeProtocolCliCommand = (env: NodeJS.ProcessEnv = process.env) => {
  const prefix = env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__?.trim()
  if (prefix == null || prefix === '') {
    return 'oneworks'
  }
  return prefix
}
