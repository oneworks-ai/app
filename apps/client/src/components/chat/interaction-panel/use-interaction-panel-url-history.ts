import { useCallback, useMemo, useState } from 'react'

import { readInteractionPanelUrlHistory, upsertInteractionPanelUrlHistory } from './interaction-panel-url-history'
import type { InteractionPanelUrlHistoryEntry, InteractionPanelUrlHistoryScope } from './interaction-panel-url-history'

export function useInteractionPanelUrlHistory({
  projectKey,
  sessionKey
}: {
  projectKey: string
  sessionKey: string
}) {
  const [version, setVersion] = useState(0)
  const scopes = useMemo<InteractionPanelUrlHistoryScope[]>(() => [
    { kind: 'session', key: sessionKey },
    { kind: 'project', key: projectKey }
  ], [projectKey, sessionKey])
  const history = useMemo(() => readInteractionPanelUrlHistory(scopes), [scopes, version])

  const record = useCallback((entry: Omit<InteractionPanelUrlHistoryEntry, 'updatedAt'>) => {
    upsertInteractionPanelUrlHistory(scopes, entry)
    setVersion(current => current + 1)
  }, [scopes])

  return { history, record }
}
