export const RELAY_WORKSPACE_HTTP_MODE = 'workspace-http'
export const RELAY_WORKSPACE_WS_OPEN_MODE = 'workspace-ws-open'
export const RELAY_WORKSPACE_WS_SEND_MODE = 'workspace-ws-send'
export const RELAY_WORKSPACE_WS_RECEIVE_MODE = 'workspace-ws-receive'
export const RELAY_WORKSPACE_WS_CLOSE_MODE = 'workspace-ws-close'

const relayWorkspaceWebSocketModes = new Set<string>([
  RELAY_WORKSPACE_WS_OPEN_MODE,
  RELAY_WORKSPACE_WS_SEND_MODE,
  RELAY_WORKSPACE_WS_RECEIVE_MODE,
  RELAY_WORKSPACE_WS_CLOSE_MODE
])

export const isRelayWorkspaceWebSocketMode = (mode: string | undefined) => (
  mode != null && relayWorkspaceWebSocketModes.has(mode)
)
