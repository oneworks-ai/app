import { useEffect, useState } from 'react'

import { getInitialComposerState } from '#~/components/chat/sender/@core/content-attachments'
import type { SenderInitialContent } from '#~/components/chat/sender/@types/sender-types'

export const useSenderComposerState = (initialContent: SenderInitialContent) => {
  const initialState = getInitialComposerState(initialContent)
  const [input, setInput] = useState(() => initialState.input)
  const [pendingImages, setPendingImages] = useState(() => initialState.pendingImages)
  const [pendingFiles, setPendingFiles] = useState(() => initialState.pendingFiles)
  const [pendingAnnotations, setPendingAnnotations] = useState(() => initialState.pendingAnnotations)
  const [pendingTextSelections, setPendingTextSelections] = useState(() => initialState.pendingTextSelections)
  const [pendingFileComments, setPendingFileComments] = useState(() => initialState.pendingFileComments)

  useEffect(() => {
    const nextState = getInitialComposerState(initialContent)
    setInput(nextState.input)
    setPendingImages(nextState.pendingImages)
    setPendingFiles(nextState.pendingFiles)
    setPendingAnnotations(nextState.pendingAnnotations)
    setPendingTextSelections(nextState.pendingTextSelections)
    setPendingFileComments(nextState.pendingFileComments)
  }, [initialContent])

  const resetComposerContent = () => {
    setInput('')
    setPendingImages([])
    setPendingFiles([])
    setPendingAnnotations([])
    setPendingTextSelections([])
    setPendingFileComments([])
  }

  return {
    input,
    setInput,
    pendingImages,
    setPendingImages,
    pendingFiles,
    setPendingFiles,
    pendingAnnotations,
    setPendingAnnotations,
    pendingTextSelections,
    setPendingTextSelections,
    pendingFileComments,
    setPendingFileComments,
    resetComposerContent
  }
}
