import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

const readBrowserHistoryIndex = () => {
  if (typeof window === 'undefined') return null
  const index = window.history.state?.idx
  return typeof index === 'number' && Number.isFinite(index) ? index : null
}

const resolveFallbackCanGoBack = () => typeof window !== 'undefined' && window.history.length > 1

interface BrowserHistoryNavigationState {
  canGoBack: boolean
  canGoForward: boolean
}

export function useBrowserHistoryNavigationState() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const initialIndexRef = useRef<number | null>(readBrowserHistoryIndex())
  const maxIndexRef = useRef<number | null>(initialIndexRef.current)
  const [state, setState] = useState<BrowserHistoryNavigationState>(() => {
    const index = initialIndexRef.current
    return {
      canGoBack: index == null ? resolveFallbackCanGoBack() : index > 0,
      canGoForward: false
    }
  })

  useEffect(() => {
    const index = readBrowserHistoryIndex()

    if (index == null) {
      setState({
        canGoBack: resolveFallbackCanGoBack(),
        canGoForward: false
      })
      return
    }

    initialIndexRef.current ??= index

    if (navigationType === 'PUSH') {
      maxIndexRef.current = index
    } else {
      maxIndexRef.current = Math.max(maxIndexRef.current ?? index, index)
    }

    setState({
      canGoBack: index > 0,
      canGoForward: maxIndexRef.current != null && index < maxIndexRef.current
    })
  }, [location.hash, location.key, location.pathname, location.search, navigationType])

  const goBack = useCallback(() => {
    if (!state.canGoBack) return
    if (typeof window === 'undefined') return
    window.history.back()
  }, [state.canGoBack])

  const goForward = useCallback(() => {
    if (!state.canGoForward) return
    if (typeof window === 'undefined') return
    window.history.forward()
  }, [state.canGoForward])

  return {
    ...state,
    goBack,
    goForward
  }
}
