import type { InteractionPanelRunCommand } from './interaction-panel-run-commands'

export const PENDING_INTERACTION_PANEL_SHORTCUT_STORAGE_KEY = 'chatInteractionPendingShortcutRequest'

export type InteractionPanelShortcutRequest =
  | { action: 'new-session' | 'new-terminal' | 'new-website' | 'open-browser-tab'; id: number }
  | { action: 'open-session'; id: number; sessionId: string; title?: string }
  | { action: 'open-terminal'; id: number; terminalId: string }
  | { action: 'terminate-run-command-task'; id: number; terminalId: string }
  | { action: 'open-website'; id: number; title?: string; url: string }
  | { action: 'open-workspace-file'; id: number; path: string }
  | { action: 'create-menu-item'; id: number; menuKey: string }
  | { action: 'run-command'; command: InteractionPanelRunCommand; id: number }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const readPendingInteractionPanelShortcutRequest = (): InteractionPanelShortcutRequest | null => {
  if (typeof window === 'undefined') return null

  try {
    const value = JSON.parse(window.sessionStorage.getItem(PENDING_INTERACTION_PANEL_SHORTCUT_STORAGE_KEY) ?? 'null')
    if (!isRecord(value) || typeof value.id !== 'number' || typeof value.action !== 'string') {
      return null
    }

    return value as InteractionPanelShortcutRequest
  } catch {
    return null
  }
}

export const writePendingInteractionPanelShortcutRequest = (request: InteractionPanelShortcutRequest | null) => {
  if (typeof window === 'undefined') return

  try {
    if (request == null) {
      window.sessionStorage.removeItem(PENDING_INTERACTION_PANEL_SHORTCUT_STORAGE_KEY)
      return
    }

    window.sessionStorage.setItem(PENDING_INTERACTION_PANEL_SHORTCUT_STORAGE_KEY, JSON.stringify(request))
  } catch {
    // Pending shortcuts are best-effort glue across route reloads.
  }
}
