import { useCallback, useEffect, useRef, useState } from 'react'

const SCROLL_THRESHOLD = 80

export function useChatScroll({ contentVersion }: { contentVersion: number }) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)
  const lastScrollTopRef = useRef(0)
  const scrollTimeoutRef = useRef<number | null>(null)
  const [hasScrollableContent, setHasScrollableContent] = useState(false)
  const [scrollVersion, setScrollVersion] = useState(0)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  const updateScrollState = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const scrollTop = container.scrollTop
    const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight)
    if (Math.abs(lastScrollTopRef.current - scrollTop) > 0.5) {
      lastScrollTopRef.current = scrollTop
      setScrollVersion(current => current + 1)
    }
    setHasScrollableContent(container.scrollHeight - container.clientHeight > 1)
    setShowScrollBottom(distanceToBottom > SCROLL_THRESHOLD)
  }, [])

  const clearScrollTimeout = useCallback(() => {
    if (scrollTimeoutRef.current == null) {
      return
    }

    window.clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = null
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    clearScrollTimeout()
    scrollTimeoutRef.current = window.setTimeout(() => {
      const container = messagesContainerRef.current
      scrollTimeoutRef.current = null
      if (!container) {
        return
      }

      container.scrollTo({
        top: container.scrollHeight,
        behavior
      })
    }, 50)
  }, [clearScrollTimeout])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    updateScrollState()
    const handleScroll = () => updateScrollState()
    container.addEventListener('scroll', handleScroll, { passive: true })
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => updateScrollState())
    resizeObserver?.observe(container)
    if (messagesContentRef.current != null) {
      resizeObserver?.observe(messagesContentRef.current)
    }

    return () => {
      resizeObserver?.disconnect()
      container.removeEventListener('scroll', handleScroll)
    }
  }, [updateScrollState])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateScrollState)

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [contentVersion, updateScrollState])

  useEffect(() => clearScrollTimeout, [clearScrollTimeout])

  return {
    hasScrollableContent,
    messagesEndRef,
    messagesContainerRef,
    messagesContentRef,
    scrollVersion,
    showScrollBottom,
    scrollToBottom
  }
}
