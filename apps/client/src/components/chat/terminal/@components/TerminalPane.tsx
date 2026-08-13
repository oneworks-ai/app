import './TerminalPane.scss'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TerminalShellKind } from '@oneworks/types'

import { useTerminalInstance } from '../@hooks/use-terminal-instance'
import { useTerminalSession } from '../@hooks/use-terminal-session'
import type { RestartTerminalHandler } from '../@hooks/use-terminal-session'

const formatShellLabel = (shell: string | undefined) => shell?.split('/').filter(Boolean).at(-1) ?? 'shell'

export interface TerminalPaneLifecycleTarget {
  generation: number
  terminalId: string
}

export function TerminalPane({
  autoRestartExitedSession,
  initialCommand,
  isActive,
  onExit,
  onInfoChange,
  onInitialCommandSent,
  onProcessReady,
  onProcessRestartAccepted,
  onRestartChange,
  onTerminateChange,
  sessionId,
  shellKind,
  target
}: {
  autoRestartExitedSession?: boolean
  initialCommand?: string
  isActive: boolean
  onExit?: (target: TerminalPaneLifecycleTarget) => void
  onInfoChange: (target: TerminalPaneLifecycleTarget, info: { shellLabel: string; isExited: boolean }) => void
  onInitialCommandSent: (target: TerminalPaneLifecycleTarget) => void
  onProcessReady: (target: TerminalPaneLifecycleTarget, pid?: number) => void
  onProcessRestartAccepted: (target: TerminalPaneLifecycleTarget) => void
  onRestartChange: (target: TerminalPaneLifecycleTarget, handler: RestartTerminalHandler) => () => void
  onTerminateChange: (target: TerminalPaneLifecycleTarget, handler: () => boolean) => () => void
  sessionId: string
  shellKind: TerminalShellKind
  target: TerminalPaneLifecycleTarget
}) {
  const { t } = useTranslation()
  const inputHandlerRef = useRef<(data: string) => void>(() => undefined)
  const resizeHandlerRef = useRef<(cols: number, rows: number) => void>(() => undefined)
  const [shellLabel, setShellLabel] = useState('shell')
  const lifecycleTarget = useMemo(
    () => target,
    [target.generation, target.terminalId]
  )
  const terminalId = lifecycleTarget.terminalId
  const {
    containerRef,
    fitTerminal,
    focusTerminal,
    lastMeasuredSize,
    terminalMounted,
    terminalRef
  } = useTerminalInstance({
    onInput: (data: string) => inputHandlerRef.current(data),
    onResize: (cols: number, rows: number) => resizeHandlerRef.current(cols, rows)
  })

  const {
    errorMessage,
    lastExit,
    resizeTerminal,
    restartTerminal,
    sendInput,
    terminateTerminal
  } = useTerminalSession({
    sessionId,
    shellKind,
    terminalId,
    active: terminalMounted,
    autoRestartExitedSession,
    initialInput: initialCommand,
    initialCols: lastMeasuredSize.cols,
    initialRows: lastMeasuredSize.rows,
    onReady: useCallback((event) => {
      onProcessReady(lifecycleTarget, event.info.pid)
      const terminal = terminalRef.current
      if (terminal == null) return

      terminal.reset()
      setShellLabel(formatShellLabel(event.info.shell))
      if (event.scrollback != null && event.scrollback !== '') {
        terminal.write(event.scrollback)
      }
      fitTerminal()
    }, [fitTerminal, lifecycleTarget, onProcessReady, terminalRef]),
    onProcessRestartAccepted: useCallback(() => {
      onProcessRestartAccepted(lifecycleTarget)
    }, [lifecycleTarget, onProcessRestartAccepted]),
    onInitialInputSent: useCallback(() => {
      onInitialCommandSent(lifecycleTarget)
    }, [lifecycleTarget, onInitialCommandSent]),
    onOutput: useCallback((data) => {
      terminalRef.current?.write(data)
    }, [terminalRef]),
    onExit: useCallback(() => {
      onExit?.(lifecycleTarget)
    }, [lifecycleTarget, onExit])
  })

  useEffect(() => {
    return onTerminateChange(lifecycleTarget, terminateTerminal)
  }, [lifecycleTarget, onTerminateChange, terminateTerminal])

  useEffect(() => {
    return onRestartChange(lifecycleTarget, restartTerminal)
  }, [lifecycleTarget, onRestartChange, restartTerminal])

  useEffect(() => {
    onInfoChange(lifecycleTarget, {
      shellLabel,
      isExited: lastExit != null
    })
  }, [lastExit, lifecycleTarget, onInfoChange, shellLabel])

  useEffect(() => {
    if (!isActive) {
      return
    }

    window.requestAnimationFrame(() => {
      fitTerminal()
      focusTerminal()
    })
  }, [fitTerminal, focusTerminal, isActive])

  inputHandlerRef.current = (data: string) => {
    void sendInput(data)
  }
  resizeHandlerRef.current = (cols: number, rows: number) => {
    void resizeTerminal(cols, rows)
  }

  const exitSummary = lastExit == null
    ? null
    : t('chat.terminal.exitSummary', {
      code: lastExit.exitCode ?? 'null',
      signal: lastExit.signal ?? 'null'
    })

  return (
    <section className={`chat-terminal-pane ${isActive ? 'is-active' : ''}`} aria-hidden={!isActive}>
      <div className='chat-terminal-pane__body'>
        {errorMessage != null && errorMessage !== '' && (
          <div className='chat-terminal-pane__error'>
            {errorMessage}
          </div>
        )}

        <div
          ref={containerRef}
          className='chat-terminal-pane__terminal'
          onClick={focusTerminal}
        />
      </div>

      {exitSummary != null && (
        <div className='chat-terminal-pane__footer'>
          {exitSummary}
        </div>
      )}
    </section>
  )
}
