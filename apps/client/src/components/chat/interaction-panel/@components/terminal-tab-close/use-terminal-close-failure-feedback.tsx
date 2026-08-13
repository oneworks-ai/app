import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { TFunction } from 'i18next'

export interface TerminalCloseMessageApi {
  destroy: (key?: string) => void
  error: (config: { content: ReactNode; key: string }) => unknown
}

export function useTerminalCloseFailureFeedback({
  message,
  ownerGeneration,
  ownerId,
  t
}: {
  message: TerminalCloseMessageApi
  ownerGeneration: number
  ownerId: string
  t: TFunction
}) {
  const ownerKey = `${ownerId}:${ownerGeneration}`
  const toastKey = `${ownerId}:terminal-close-error`
  const [announcementState, setAnnouncementState] = useState({ ownerKey, text: '' })
  const announcementFrameRef = useRef<number | null>(null)
  const announcementVersionRef = useRef(0)
  const latestOwnerKeyRef = useRef(ownerKey)
  const activeToastRef = useRef({ message, toastKey })
  latestOwnerKeyRef.current = ownerKey

  const announceFailure = useCallback((count: number) => {
    const error = t('chat.interactionPanel.terminalCloseFailed', { count })
    message.error({ content: <span aria-hidden='true'>{error}</span>, key: toastKey })
    setAnnouncementState({ ownerKey, text: '' })
    if (announcementFrameRef.current != null) window.cancelAnimationFrame(announcementFrameRef.current)
    announcementVersionRef.current += 1
    const scheduledVersion = announcementVersionRef.current
    announcementFrameRef.current = window.requestAnimationFrame(() => {
      announcementFrameRef.current = null
      if (
        announcementVersionRef.current !== scheduledVersion ||
        latestOwnerKeyRef.current !== ownerKey
      ) return
      setAnnouncementState({ ownerKey, text: error })
    })
  }, [message, ownerKey, t, toastKey])

  useEffect(() => {
    const previousToast = activeToastRef.current
    activeToastRef.current = { message, toastKey }
    announcementVersionRef.current += 1
    if (announcementFrameRef.current != null) window.cancelAnimationFrame(announcementFrameRef.current)
    announcementFrameRef.current = null
    setAnnouncementState({ ownerKey, text: '' })
    previousToast.message.destroy(previousToast.toastKey)
  }, [message, ownerKey, toastKey])

  useEffect(() => () => {
    announcementVersionRef.current += 1
    if (announcementFrameRef.current != null) window.cancelAnimationFrame(announcementFrameRef.current)
    activeToastRef.current.message.destroy(activeToastRef.current.toastKey)
  }, [])

  const announcement = announcementState.ownerKey === ownerKey ? announcementState.text : ''
  return { announcement, announceFailure }
}
