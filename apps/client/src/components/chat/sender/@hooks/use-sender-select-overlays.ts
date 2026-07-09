import type { RefObject } from 'react'
import { useEffect, useState } from 'react'

import type { RefSelectProps } from 'antd'

import type { SenderInitialContent } from '#~/components/chat/sender/@types/sender-types'

export const useSenderSelectOverlays = ({
  initialContent,
  isInlineEdit,
  isThinking,
  modelUnavailable,
  supportsEffort,
  modelSelectRef,
  effortSelectRef
}: {
  initialContent: SenderInitialContent
  isInlineEdit: boolean
  isThinking: boolean
  modelUnavailable?: boolean
  supportsEffort: boolean
  modelSelectRef: RefObject<RefSelectProps>
  effortSelectRef: RefObject<HTMLInputElement>
}) => {
  const [showModelSelect, setShowModelSelect] = useState(false)
  const [showEffortSelect, setShowEffortSelect] = useState(false)
  const [modelSearchValue, setModelSearchValue] = useState('')

  useEffect(() => {
    resetSelectOverlays()
  }, [initialContent])

  const resetSelectOverlays = () => {
    setShowModelSelect(false)
    setShowEffortSelect(false)
    setModelSearchValue('')
  }

  useEffect(() => {
    if (!showModelSelect && modelSearchValue !== '') {
      setModelSearchValue('')
    }
  }, [modelSearchValue, showModelSelect])

  const focusModelSelect = () => {
    window.requestAnimationFrame(() => {
      modelSelectRef.current?.focus?.()
    })
  }

  const focusEffortSlider = () => {
    window.requestAnimationFrame(() => {
      effortSelectRef.current?.focus()
    })
  }

  const openModelSelector = () => {
    if (isInlineEdit || modelUnavailable || isThinking) {
      return false
    }
    setShowEffortSelect(false)
    setModelSearchValue('')
    setShowModelSelect(true)
    focusModelSelect()
    return true
  }

  const openEffortSelector = () => {
    if (isInlineEdit || modelUnavailable || isThinking || !supportsEffort) {
      return false
    }
    setShowModelSelect(false)
    setShowEffortSelect(true)
    focusEffortSlider()
    return true
  }

  return {
    showModelSelect,
    setShowModelSelect,
    showEffortSelect,
    setShowEffortSelect,
    modelSearchValue,
    setModelSearchValue,
    resetSelectOverlays,
    openModelSelector,
    openEffortSelector
  }
}
