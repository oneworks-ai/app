export type DesktopWorkspaceStartupReadiness = 'degraded' | 'editable'

export const DESKTOP_FIRST_ACTION_MILESTONES = [
  'first.submit',
  'submit.accepted',
  // The renderer received displayable assistant content. This is neither a provider token nor a paint timestamp.
  'first.response.received',
  'first.success',
  'first.failed',
  'first.terminated'
] as const

export type DesktopFirstActionMilestone = typeof DESKTOP_FIRST_ACTION_MILESTONES[number]

export interface DesktopFirstActionMilestoneInput {
  milestone: DesktopFirstActionMilestone
}

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

const desktopFirstActionMilestones = new Set<string>(DESKTOP_FIRST_ACTION_MILESTONES)

export const normalizeDesktopFirstActionMilestone = (
  input: unknown
): DesktopFirstActionMilestone | undefined => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined

  const milestone = (input as { milestone?: unknown }).milestone
  return typeof milestone === 'string' && desktopFirstActionMilestones.has(milestone)
    ? milestone as DesktopFirstActionMilestone
    : undefined
}
