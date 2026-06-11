export interface Logger {
  stream: NodeJS.WritableStream
  paths?: {
    logFilePath: string
    logsRoot: string
    cachesRoot: string
  }
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}
