import type { WorkspaceExternalOpenerId } from '@oneworks/types'

const PREFERRED_WORKSPACE_OPENER_STORAGE_KEY = 'chatInteractionPreferredWorkspaceOpener'

const normalizeWorkspaceOpenerId = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export const readInteractionPanelPreferredWorkspaceOpenerId = (): WorkspaceExternalOpenerId | null => {
  if (typeof window === 'undefined') return null

  try {
    const opener = normalizeWorkspaceOpenerId(window.localStorage.getItem(PREFERRED_WORKSPACE_OPENER_STORAGE_KEY))
    return opener === '' ? null : opener as WorkspaceExternalOpenerId
  } catch {
    return null
  }
}

export const writeInteractionPanelPreferredWorkspaceOpenerId = (
  opener: WorkspaceExternalOpenerId | null
) => {
  if (typeof window === 'undefined') return

  try {
    if (opener == null || opener.trim() === '') {
      window.localStorage.removeItem(PREFERRED_WORKSPACE_OPENER_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(PREFERRED_WORKSPACE_OPENER_STORAGE_KEY, opener.trim())
  } catch {
    // Workspace opener preference is best-effort UI state.
  }
}
