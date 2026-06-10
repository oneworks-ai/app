import '@xterm/xterm/css/xterm.css'
import './ChatTerminalView.scss'

import type { TerminalPaneInfo } from './@components/TerminalManagerList'
import { TerminalPane } from './@components/TerminalPane'
import type { RestartTerminalHandler } from './@hooks/use-terminal-session'
import type { TerminalPaneConfig } from './@utils/terminal-panes'

export function ChatTerminalView({
  activeTerminalId,
  autoRestartExitedSession,
  onExit,
  onInfoChange,
  onInitialCommandSent,
  onRestartChange,
  onTerminateChange,
  panes,
  sessionId
}: {
  activeTerminalId: string
  autoRestartExitedSession?: boolean
  onExit?: (terminalId: string) => void
  onInfoChange: (terminalId: string, info: TerminalPaneInfo) => void
  onInitialCommandSent: (terminalId: string) => void
  onRestartChange: (terminalId: string, handler: RestartTerminalHandler | null) => void
  onTerminateChange: (terminalId: string, handler: (() => boolean) | null) => void
  panes: TerminalPaneConfig[]
  sessionId: string
}) {
  return (
    <div className='chat-terminal-view__surface'>
      <div className='chat-terminal-view__terminal-stage'>
        {panes.map(pane => (
          <TerminalPane
            key={pane.id}
            autoRestartExitedSession={autoRestartExitedSession}
            isActive={pane.id === activeTerminalId}
            initialCommand={pane.initialCommand}
            sessionId={sessionId}
            shellKind={pane.shellKind}
            terminalId={pane.id}
            onExit={onExit}
            onInfoChange={onInfoChange}
            onInitialCommandSent={onInitialCommandSent}
            onRestartChange={onRestartChange}
            onTerminateChange={onTerminateChange}
          />
        ))}
      </div>
    </div>
  )
}

export type { TerminalPaneConfig, TerminalPaneInfo }
