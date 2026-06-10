import useSWR from 'swr'

import { getSessionWorkspace } from '#~/api'
import { getServerBaseUrl } from '#~/runtime-config'

export function useInteractionPanelWorkspaceUrlKeys(sessionId: string | undefined, terminalSessionId: string) {
  const workspaceCacheKey = sessionId == null ? null : (['interaction-panel-session-workspace', sessionId] as const)
  const { data: workspaceData } = useSWR(workspaceCacheKey, ([, id]) => getSessionWorkspace(id))
  return {
    projectUrlHistoryKey: workspaceData?.workspace.repositoryRoot ?? workspaceData?.workspace.workspaceFolder ??
      getServerBaseUrl(),
    sessionUrlHistoryKey: sessionId ?? terminalSessionId
  }
}
