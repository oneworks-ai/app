export interface CommandResult {
  ok: boolean
  error?: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunCommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export interface CuaPluginApiRegistration {
  description?: string | Record<string, string>
  headerSchema?: Record<string, unknown>
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  title?: string | Record<string, string>
  handler: (request: unknown) => unknown | Promise<unknown>
}

export interface CuaPluginContext {
  scope: string
  pluginRoot: string
  workspaceFolder: string
  projectHome: string
  options: Record<string, unknown>
  runtime: {
    role: 'manager' | 'workspace'
  }
  logger: {
    info: (...args: unknown[]) => void
  }
  registerApi: (apiId: string, options: CuaPluginApiRegistration) => void
  registerCommand: (commandId: string, handler: (payload?: unknown) => unknown | Promise<unknown>) => void
  dispose: (callback: () => void) => void
}
