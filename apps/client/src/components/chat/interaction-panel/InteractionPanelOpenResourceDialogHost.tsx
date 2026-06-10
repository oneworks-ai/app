import { useLocation, useNavigate } from 'react-router-dom'

import type { ChatRouteBottomPanelState } from '#~/hooks/chat/use-chat-route-bottom-panel'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import { InteractionPanelOpenResourceDialog } from './InteractionPanelOpenResourceDialog'

export function InteractionPanelOpenResourceDialogHost({
  bottomPanel,
  iframePages,
  open,
  projectUrlHistoryKey,
  recentFilePaths,
  sessionId,
  sessionUrlHistoryKey,
  onClose,
  onFoldChange,
  onOpenWebsite
}: {
  bottomPanel: ChatRouteBottomPanelState
  iframePages: InteractionPanelIframePage[]
  open: boolean
  projectUrlHistoryKey: string
  recentFilePaths: string[]
  sessionId?: string
  sessionUrlHistoryKey: string
  onClose: () => void
  onFoldChange: (isFolded: boolean) => void
  onOpenWebsite: (url: string) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <InteractionPanelOpenResourceDialog
      iframePages={iframePages}
      open={open}
      projectUrlHistoryKey={projectUrlHistoryKey}
      recentFilePaths={recentFilePaths}
      sessionId={sessionId}
      sessionUrlHistoryKey={sessionUrlHistoryKey}
      onClose={onClose}
      onOpenFile={(path) => {
        onFoldChange(false)
        bottomPanel.handleOpenWorkspaceFile(path)
      }}
      onOpenSession={(targetSessionId) => {
        onFoldChange(false)
        void navigate({
          pathname: `/session/${encodeURIComponent(targetSessionId)}`,
          search: location.search
        })
      }}
      onOpenWebsite={(url) => {
        onFoldChange(false)
        onOpenWebsite(url)
      }}
    />
  )
}
