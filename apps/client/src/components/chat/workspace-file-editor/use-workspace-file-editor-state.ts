import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'

import { readSessionWorkspaceFile, readWorkspaceFile, updateSessionWorkspaceFile, updateWorkspaceFile } from '#~/api'

const AUTOSAVE_DELAY_MS = 600

export function useWorkspaceFileEditorState({
  autosave = true,
  enabled = true,
  onSaveError,
  path,
  sessionId
}: {
  autosave?: boolean
  enabled?: boolean
  onSaveError: (err: unknown) => void
  path: string
  sessionId?: string
}) {
  const loadedPathRef = useRef<string | null>(null)
  const failedContentRef = useRef<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const hasSession = sessionId != null && sessionId !== ''
  const swrKey = enabled
    ? hasSession
      ? ['workspace-file-editor', sessionId, path]
      : ['workspace-file-editor', 'workspace', path]
    : null
  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () =>
      sessionId != null && sessionId !== ''
        ? readSessionWorkspaceFile(sessionId, path)
        : readWorkspaceFile(path),
    { revalidateOnFocus: false }
  )
  const isDirty = draft !== savedContent

  useEffect(() => {
    if (data == null) {
      loadedPathRef.current = null
      setDraft('')
      setSavedContent('')
      return
    }

    if (loadedPathRef.current === data.path) {
      return
    }

    loadedPathRef.current = data.path
    failedContentRef.current = null
    setDraft(data.content)
    setSavedContent(data.content)
  }, [data])

  const saveContent = useCallback(async (content: string) => {
    if (!enabled) {
      return true
    }
    setIsSaving(true)
    try {
      const result = sessionId != null && sessionId !== ''
        ? await updateSessionWorkspaceFile(sessionId, path, content)
        : await updateWorkspaceFile(path, content)
      failedContentRef.current = null
      setSavedContent(result.content)
      await mutate(result, false)
      return true
    } catch (err) {
      failedContentRef.current = content
      onSaveError(err)
      return false
    } finally {
      setIsSaving(false)
    }
  }, [enabled, mutate, onSaveError, path, sessionId])

  useEffect(() => {
    if (
      !autosave ||
      !isDirty ||
      isSaving ||
      isLoading ||
      error != null ||
      data == null ||
      failedContentRef.current === draft
    ) {
      return
    }

    const timer = window.setTimeout(() => {
      void saveContent(draft)
    }, AUTOSAVE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [autosave, data, draft, error, isDirty, isLoading, isSaving, saveContent])

  const saveNow = useCallback(async () => {
    if (!enabled || !isDirty || isSaving) {
      return true
    }
    return saveContent(draft)
  }, [draft, enabled, isDirty, isSaving, saveContent])

  const discardChanges = useCallback(() => {
    failedContentRef.current = null
    setDraft(savedContent)
  }, [savedContent])

  return {
    data,
    draft,
    error,
    discardChanges,
    isDirty,
    isLoading,
    isSaving,
    saveNow,
    setDraft
  }
}
