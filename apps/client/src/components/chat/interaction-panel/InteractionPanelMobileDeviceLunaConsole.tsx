import { useEffect, useRef } from 'react'

import 'luna-object-viewer/luna-object-viewer.css'
import 'luna-data-grid/luna-data-grid.css'
import 'luna-dom-viewer/luna-dom-viewer.css'
import 'luna-console/luna-console.css'
import LunaConsole from 'luna-console'

const getLogLevel = (line: string) => {
  if (/(?:^|\s)(?:E|ERROR|ERR|FATAL)(?:[/\s:]|$)/iu.test(line)) return 'error'
  if (/(?:^|\s)(?:W|WARN|WARNING)(?:[/\s:]|$)/iu.test(line)) return 'warn'
  if (/(?:^|\s)(?:I|INFO)(?:[/\s:]|$)/iu.test(line)) return 'info'
  if (/(?:^|\s)(?:D|DEBUG|V|VERBOSE)(?:[/\s:]|$)/iu.test(line)) return 'debug'
  return 'log'
}

const parseStructuredLogLine = (line: string) => {
  const trimmedLine = line.trim()
  if (
    !(trimmedLine.startsWith('{') && trimmedLine.endsWith('}')) &&
    !(trimmedLine.startsWith('[') && trimmedLine.endsWith(']'))
  ) {
    return line
  }

  try {
    return JSON.parse(trimmedLine) as unknown
  } catch {
    return line
  }
}

const writeLogLine = (lunaConsole: LunaConsole, line: string) => {
  const logValue = parseStructuredLogLine(line)
  switch (getLogLevel(line)) {
    case 'debug':
      lunaConsole.debug(logValue)
      break
    case 'error':
      lunaConsole.error(logValue)
      break
    case 'info':
      lunaConsole.info(logValue)
      break
    case 'warn':
      lunaConsole.warn(logValue)
      break
    default:
      lunaConsole.log(logValue)
      break
  }
}

export function InteractionPanelMobileDeviceLunaConsole({
  emptyMessage,
  lines
}: {
  emptyMessage: string
  lines: string[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const consoleRef = useRef<LunaConsole>()

  useEffect(() => {
    const container = containerRef.current
    if (container == null) return

    const lunaConsole = new LunaConsole(container, {
      asyncRender: true,
      maxNum: 1000,
      showHeader: false,
      theme: 'light'
    })
    consoleRef.current = lunaConsole

    return () => {
      lunaConsole.destroy()
      if (consoleRef.current === lunaConsole) consoleRef.current = undefined
    }
  }, [])

  useEffect(() => {
    const lunaConsole = consoleRef.current
    if (lunaConsole == null) return

    lunaConsole.clear(true)
    if (lines.length === 0) {
      lunaConsole.info(emptyMessage)
      return
    }

    for (const line of lines) {
      writeLogLine(lunaConsole, line)
    }
  }, [emptyMessage, lines])

  return <div ref={containerRef} className='chat-interaction-panel-mobile-debug__luna-console' />
}
