/* eslint-disable max-lines -- terminal websocket lifecycle and reconnection state are kept together for readability. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TerminalSessionCommand, TerminalSessionEvent, TerminalShellKind } from '@oneworks/types'

import { createSocket } from '#~/ws.js'

const isSocketOpen = (socket: WebSocket | null): socket is WebSocket =>
  socket != null && socket.readyState === WebSocket.OPEN

const splitInitialInputLines = (value: string) =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd().split('\n')
const clearTimer = (timerRef: { current: number | null }) => {
  if (timerRef.current == null) return

  window.clearTimeout(timerRef.current)
  timerRef.current = null
}

export interface RestartTerminalOptions {
  restartRunning?: boolean
}

export type RestartTerminalHandler = (initialCommand?: string, options?: RestartTerminalOptions) => boolean

export function useTerminalSession({
  sessionId,
  shellKind,
  terminalId,
  active,
  autoRestartExitedSession = true,
  initialInput,
  initialCols,
  initialRows,
  onReady,
  onInitialInputSent,
  onOutput,
  onExit
}: {
  sessionId: string
  shellKind?: TerminalShellKind
  terminalId?: string
  active: boolean
  autoRestartExitedSession?: boolean
  initialInput?: string
  initialCols: number
  initialRows: number
  onReady: (event: Extract<TerminalSessionEvent, { type: 'terminal_ready' }>) => void
  onInitialInputSent?: () => void
  onOutput: (data: string) => void
  onExit?: (event: Extract<TerminalSessionEvent, { type: 'terminal_exit' }>) => void
}) {
  const { t } = useTranslation()
  const socketRef = useRef<WebSocket | null>(null)
  const expectedCloseRef = useRef(false)
  const fatalErrorRef = useRef(false)
  const initialInputTimerRef = useRef<number | null>(null)
  const initialInputLinesRef = useRef<string[]>([])
  const initialInputLineIndexRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const restartAfterExitRef = useRef(false)
  const restartRunningOnReadyRef = useRef(true)
  const restartOnReadyRef = useRef(false)
  const restartRequestedRef = useRef(false)
  const latestSizeRef = useRef({ cols: initialCols, rows: initialRows })
  const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const initialInputRef = useRef(initialInput)
  const restartInitialInputRef = useRef<string | undefined>(undefined)
  const initialInputSentRef = useRef(false)
  const terminalStatusRef = useRef<'exited' | 'running' | 'unknown'>('unknown')
  const onReadyRef = useRef(onReady)
  const onInitialInputSentRef = useRef(onInitialInputSent)
  const onOutputRef = useRef(onOutput)
  const onExitRef = useRef(onExit)
  const [connectVersion, setConnectVersion] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastExit, setLastExit] = useState<{ exitCode: number | null; signal: number | null } | null>(null)

  onReadyRef.current = onReady
  onInitialInputSentRef.current = onInitialInputSent
  onOutputRef.current = onOutput
  onExitRef.current = onExit
  initialInputRef.current = initialInput
  latestSizeRef.current = { cols: initialCols, rows: initialRows }

  const sendCommand = useCallback((command: TerminalSessionCommand) => {
    const socket = socketRef.current
    if (!isSocketOpen(socket)) {
      return false
    }

    socket.send(JSON.stringify(command))
    return true
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current)
    }

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      setConnectVersion(current => current + 1)
    }, 800)
  }, [])

  const sendInput = useCallback((data: string) => sendCommand({ type: 'terminal_input', data }), [sendCommand])
  const clearInitialInputQueue = useCallback(() => {
    clearTimer(initialInputTimerRef)
    initialInputLinesRef.current = []
    initialInputLineIndexRef.current = 0
  }, [])
  const queueInitialInput = useCallback((input: string) => {
    const lines = splitInitialInputLines(input)
    if (lines.length === 0) return false

    clearInitialInputQueue()
    initialInputSentRef.current = true
    initialInputLinesRef.current = lines
    initialInputLineIndexRef.current = 0

    const sendNextLine = () => {
      const line = initialInputLinesRef.current[initialInputLineIndexRef.current]
      if (line == null) {
        clearInitialInputQueue()
        restartInitialInputRef.current = undefined
        onInitialInputSentRef.current?.()
        return
      }

      const sent = sendInput(`${line}\r`)
      if (!sent) {
        clearInitialInputQueue()
        initialInputSentRef.current = false
        return
      }

      initialInputLineIndexRef.current += 1
      initialInputTimerRef.current = window.setTimeout(sendNextLine, 90)
    }

    initialInputTimerRef.current = window.setTimeout(sendNextLine, 120)
    return true
  }, [clearInitialInputQueue, sendInput])
  const sendResizeCommand = useCallback(
    (cols: number, rows: number) => sendCommand({ type: 'terminal_resize', cols, rows }),
    [sendCommand]
  )
  const sendRestartCommand = useCallback(() => {
    const restartSize = latestSizeRef.current
    restartRequestedRef.current = true
    setLastExit(null)
    const sent = sendCommand({
      type: 'terminal_restart',
      cols: restartSize.cols,
      rows: restartSize.rows
    })
    if (sent) {
      restartOnReadyRef.current = false
      restartRunningOnReadyRef.current = true
      terminalStatusRef.current = 'running'
    }
    return sent
  }, [sendCommand])
  const terminateTerminal = useCallback(() => {
    restartAfterExitRef.current = false
    restartOnReadyRef.current = false
    restartRunningOnReadyRef.current = true
    return sendCommand({ type: 'terminal_terminate' })
  }, [sendCommand])
  const restartTerminal = useCallback((nextInitialInput?: string, options: RestartTerminalOptions = {}) => {
    const restartRunning = options.restartRunning !== false
    const normalizedInitialInput = nextInitialInput?.trim()
    restartInitialInputRef.current = normalizedInitialInput == null || normalizedInitialInput === ''
      ? undefined
      : normalizedInitialInput
    initialInputSentRef.current = false
    clearInitialInputQueue()
    setErrorMessage(null)
    setLastExit(null)

    if (!isSocketOpen(socketRef.current)) {
      restartAfterExitRef.current = false
      restartRunningOnReadyRef.current = restartRunning
      restartOnReadyRef.current = true
      return false
    }

    if (terminalStatusRef.current === 'unknown') {
      restartAfterExitRef.current = false
      restartRunningOnReadyRef.current = restartRunning
      restartOnReadyRef.current = true
      return false
    }

    if (terminalStatusRef.current === 'running') {
      if (!restartRunning) {
        const restartInitialInput = restartInitialInputRef.current
        return restartInitialInput == null ? true : queueInitialInput(restartInitialInput)
      }

      restartAfterExitRef.current = true
      const terminated = sendCommand({ type: 'terminal_terminate' })
      if (!terminated) restartAfterExitRef.current = false
      return terminated
    }

    restartAfterExitRef.current = false
    const restarted = sendRestartCommand()
    if (!restarted) {
      restartRunningOnReadyRef.current = restartRunning
      restartOnReadyRef.current = true
      return false
    }
    return restarted
  }, [clearInitialInputQueue, queueInitialInput, sendCommand, sendRestartCommand])
  const flushPendingResize = useCallback(() => {
    const pendingResize = pendingResizeRef.current
    if (pendingResize == null) {
      return false
    }

    const sent = sendResizeCommand(pendingResize.cols, pendingResize.rows)
    if (sent) {
      pendingResizeRef.current = null
    }
    return sent
  }, [sendResizeCommand])

  const resizeTerminal = useCallback((cols: number, rows: number) => {
    latestSizeRef.current = { cols, rows }
    pendingResizeRef.current = { cols, rows }
    return flushPendingResize()
  }, [flushPendingResize])

  useEffect(() => {
    if (!active) {
      return
    }

    expectedCloseRef.current = false
    fatalErrorRef.current = false
    restartRequestedRef.current = false
    setErrorMessage(null)
    pendingResizeRef.current = latestSizeRef.current

    const connectSize = latestSizeRef.current

    const socket = createSocket<TerminalSessionEvent>({
      onOpen: () => {
        flushPendingResize()
      },
      onMessage: (event) => {
        switch (event.type) {
          case 'terminal_ready': {
            setErrorMessage(null)
            if (event.info.status === 'exited') {
              terminalStatusRef.current = 'exited'
              if (restartAfterExitRef.current || restartOnReadyRef.current) {
                restartAfterExitRef.current = false
                restartOnReadyRef.current = false
                void sendRestartCommand()
                return
              }

              if (onExitRef.current != null) {
                onExitRef.current({ type: 'terminal_exit', exitCode: null, signal: null })
                return
              }

              if (!autoRestartExitedSession) {
                onReadyRef.current(event)
                setLastExit({ exitCode: null, signal: null })
                return
              }

              if (!restartRequestedRef.current) {
                restartRequestedRef.current = true
                const restartSize = latestSizeRef.current
                socket.send(JSON.stringify(
                  {
                    type: 'terminal_restart',
                    cols: restartSize.cols,
                    rows: restartSize.rows
                  } satisfies TerminalSessionCommand
                ))
              }
              return
            }

            terminalStatusRef.current = 'running'
            restartAfterExitRef.current = false
            if (restartOnReadyRef.current) {
              const shouldRestartRunning = restartRunningOnReadyRef.current
              restartOnReadyRef.current = false
              restartRunningOnReadyRef.current = true
              if (shouldRestartRunning) {
                restartAfterExitRef.current = true
                if (!sendCommand({ type: 'terminal_terminate' })) {
                  restartAfterExitRef.current = false
                }
                return
              }
            }
            restartOnReadyRef.current = false
            restartRunningOnReadyRef.current = true
            restartRequestedRef.current = false
            setLastExit(null)
            onReadyRef.current(event)
            if (initialInputSentRef.current) {
              return
            }

            const nextInitialInput = (restartInitialInputRef.current ?? initialInputRef.current)?.trim()
            if (nextInitialInput != null && nextInitialInput !== '') {
              queueInitialInput(nextInitialInput)
            }
            return
          }
          case 'terminal_output':
            onOutputRef.current(event.data)
            return
          case 'terminal_exit':
            terminalStatusRef.current = 'exited'
            setLastExit({ exitCode: event.exitCode, signal: event.signal })
            if (restartAfterExitRef.current) {
              restartAfterExitRef.current = false
              void sendRestartCommand()
              return
            }

            onExitRef.current?.(event)
            return
          case 'terminal_error':
            fatalErrorRef.current = event.fatal === true
            setErrorMessage(event.message)
        }
      },
      onError: () => {
        setErrorMessage(t('chat.terminal.connectionError'))
      },
      onClose: () => {
        socketRef.current = null
        if (expectedCloseRef.current || fatalErrorRef.current) {
          return
        }

        scheduleReconnect()
      }
    }, {
      channel: 'terminal',
      sessionId,
      shellKind: shellKind ?? 'default',
      terminalId: terminalId ?? '',
      cols: String(connectSize.cols),
      rows: String(connectSize.rows)
    })

    socketRef.current = socket

    return () => {
      expectedCloseRef.current = true
      clearTimer(reconnectTimerRef)
      clearInitialInputQueue()
      socket.close()
      socketRef.current = null
    }
  }, [
    active,
    autoRestartExitedSession,
    connectVersion,
    clearInitialInputQueue,
    flushPendingResize,
    queueInitialInput,
    scheduleReconnect,
    sendRestartCommand,
    sessionId,
    shellKind,
    t,
    terminalId
  ])

  return {
    errorMessage,
    lastExit,
    resizeTerminal,
    restartTerminal,
    sendInput,
    terminateTerminal
  }
}
