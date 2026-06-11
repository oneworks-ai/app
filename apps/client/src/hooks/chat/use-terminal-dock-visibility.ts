import { useEffect, useState } from 'react'

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
  }, [isOpen])

  return {
    isRendered,
    isVisible
  }
}
