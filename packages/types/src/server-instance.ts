export const SERVER_INSTANCE_FILE_NAME = 'instance.json'

export interface ServerInstanceState {
  pid: number
  role: 'manager' | 'workspace'
  serverBaseUrl: string
  startedAt: string
}

export const isServerInstanceState = (value: unknown): value is ServerInstanceState => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return (
    typeof state.pid === 'number' && Number.isInteger(state.pid) && state.pid > 0 &&
    (state.role === 'manager' || state.role === 'workspace') &&
    typeof state.serverBaseUrl === 'string' && state.serverBaseUrl.trim() !== '' &&
    typeof state.startedAt === 'string'
  )
}
