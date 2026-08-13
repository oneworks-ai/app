export type DesktopWorkspaceStartupReadiness = 'degraded' | 'editable'

export interface DesktopWorkspaceStartupReadyInput {
  readiness: DesktopWorkspaceStartupReadiness
}

export const normalizeDesktopWorkspaceStartupReadiness = (
  input?: unknown
): DesktopWorkspaceStartupReadiness => {
  if (input === undefined) return 'editable'
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return 'degraded'

  const readiness = (input as { readiness?: unknown }).readiness
  return readiness === 'editable' || readiness === 'degraded'
    ? readiness
    : 'degraded'
}
