import '@xterm/xterm/css/xterm.css'
import './ChatTerminalView.scss'

import type { TerminalPaneInfo } from './@components/TerminalManagerList'
import { TerminalPane } from './@components/TerminalPane'
import type { TerminalPaneLifecycleTarget } from './@components/TerminalPane'
import type { RestartTerminalHandler } from './@hooks/use-terminal-session'
import type { TerminalPaneConfig } from './@utils/terminal-panes'

export function ChatTerminalView({
  activeTerminalId,
  autoRestartExitedSession,
  getTerminalGeneration,
  onExit,
  onInfoChange,
  onInitialCommandSent,
  onProcessReady,
  onProcessRestartAccepted,
  onRestartChange,
  onTerminateChange,
  panes,
  sessionId
}: {
  activeTerminalId: string
  autoRestartExitedSession?: boolean
  getTerminalGeneration: (terminalId: string) => number | undefined
  onExit?: (target: TerminalPaneLifecycleTarget) => void
  onInfoChange: (target: TerminalPaneLifecycleTarget, info: TerminalPaneInfo) => void
  onInitialCommandSent: (target: TerminalPaneLifecycleTarget) => void
  onProcessReady: (target: TerminalPaneLifecycleTarget, pid?: number) => void
  onProcessRestartAccepted: (target: TerminalPaneLifecycleTarget) => void
  onRestartChange: (target: TerminalPaneLifecycleTarget, handler: RestartTerminalHandler) => () => void
  onTerminateChange: (target: TerminalPaneLifecycleTarget, handler: () => boolean) => () => void
  panes: TerminalPaneConfig[]
  sessionId: string
}) {
  return (
    <div className='chat-terminal-view__surface'>
      <div className='chat-terminal-view__terminal-stage'>
        {panes.map((pane) => {
          const generation = getTerminalGeneration(pane.id)
          if (generation == null) return null
          return (
            <TerminalPane
              key={pane.id}
              autoRestartExitedSession={autoRestartExitedSession}
              isActive={pane.id === activeTerminalId}
              initialCommand={pane.initialCommand}
              sessionId={sessionId}
              shellKind={pane.shellKind}
              target={{ generation, terminalId: pane.id }}
              onExit={onExit}
              onInfoChange={onInfoChange}
              onInitialCommandSent={onInitialCommandSent}
              onProcessReady={onProcessReady}
              onProcessRestartAccepted={onProcessRestartAccepted}
              onRestartChange={onRestartChange}
              onTerminateChange={onTerminateChange}
            />
          )
        })}
      </div>
    </div>
  )
}

export type { TerminalPaneConfig, TerminalPaneInfo }
