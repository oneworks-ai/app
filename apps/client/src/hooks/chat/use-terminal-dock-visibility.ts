import { useEffect, useState } from 'react'

const TERMINAL_DOCK_EXIT_DURATION_MS = 240

export function useTerminalDockVisibility(isOpen: boolean) {
  const [isRendered, setIsRendered] = useState(isOpen)
  const [isVisible, setIsVisible] = useState(isOpen)

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true)
      const timeoutId = window.setTimeout(() => {
        setIsVisible(true)
      }, 0)
      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    setIsVisible(false)
    const timeoutId = window.setTimeout(() => {
      setIsRendered(false)
    }, TERMINAL_DOCK_EXIT_DURATION_MS)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isOpen])

  return {
    isRendered,
    isVisible
  }
}
