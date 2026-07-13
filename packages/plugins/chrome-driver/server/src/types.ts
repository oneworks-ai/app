export interface ChromePluginApiRegistration {
  description?: string | Record<string, string>
  headerSchema?: Record<string, unknown>
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  title?: string | Record<string, string>
  handler: (request: unknown) => unknown | Promise<unknown>
}

export interface ChromePluginContext {
  logger: {
    error: (...args: unknown[]) => void
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
  }
  projectHome: string
  workspaceFolder: string
  registerApi: (id: string, options: ChromePluginApiRegistration) => void
  registerCommand: (id: string, handler: (payload?: unknown) => unknown | Promise<unknown>) => void
  registerLocalService: (id: string, start: () => unknown | Promise<unknown>) => void
}
