import type { LauncherWorkspaceSelectorState, UsageQuery } from '@oneworks/types'

export const USAGE_GLOBAL_WORKSPACE_SCOPE_ID = '__global__'

export interface UsageWorkspaceScopeOption {
  id: string
  isCurrent: boolean
  label: string
}

export type UsagePanelDataScope =
  | { kind: 'all' }
  | { kind: 'workspaces'; workspaceIds: string[] }

export const createDefaultUsageWorkspaceSelection = (
  currentWorkspaceId?: string
) =>
  currentWorkspaceId == null
    ? [USAGE_GLOBAL_WORKSPACE_SCOPE_ID]
    : [currentWorkspaceId]

export const createUsageWorkspaceScopeOptions = (
  state: LauncherWorkspaceSelectorState | undefined,
  currentWorkspaceId: string | undefined,
  currentWorkspaceLabel: string
): UsageWorkspaceScopeOption[] => {
  const options = new Map<string, UsageWorkspaceScopeOption>()
  for (const project of state?.runningProjects ?? []) {
    const id = project.workspaceId?.trim()
    if (id == null || id === '') continue
    const label = project.name.trim() || project.description.trim() || id
    options.set(id, {
      id,
      isCurrent: id === currentWorkspaceId || project.isCurrent === true,
      label
    })
  }
  if (currentWorkspaceId != null && !options.has(currentWorkspaceId)) {
    options.set(currentWorkspaceId, {
      id: currentWorkspaceId,
      isCurrent: true,
      label: currentWorkspaceLabel
    })
  }
  const values = Array.from(options.values())
  return [
    ...values.filter(option => option.isCurrent),
    ...values.filter(option => !option.isCurrent)
  ]
}

export const toggleUsageWorkspaceSelection = (
  selection: string[],
  id: string
) => {
  if (id === USAGE_GLOBAL_WORKSPACE_SCOPE_ID) {
    return [USAGE_GLOBAL_WORKSPACE_SCOPE_ID]
  }
  if (selection.includes(USAGE_GLOBAL_WORKSPACE_SCOPE_ID)) {
    return [id]
  }
  if (!selection.includes(id)) {
    return [...selection, id]
  }
  return selection.length === 1
    ? selection
    : selection.filter(value => value !== id)
}

export const resolveUsageWorkspaceSelectionChange = (
  selection: string[],
  nextSelection: string[]
) => {
  const changedId = nextSelection.find(id => !selection.includes(id)) ??
    selection.find(id => !nextSelection.includes(id))
  return changedId == null
    ? selection
    : toggleUsageWorkspaceSelection(selection, changedId)
}

export const normalizeUsageWorkspaceSelection = (
  selection: string[],
  options: UsageWorkspaceScopeOption[],
  currentWorkspaceId?: string
) => {
  if (selection.includes(USAGE_GLOBAL_WORKSPACE_SCOPE_ID)) {
    return [USAGE_GLOBAL_WORKSPACE_SCOPE_ID]
  }
  const availableIds = new Set(options.map(option => option.id))
  const availableSelection = selection.filter(id => availableIds.has(id))
  if (availableSelection.length > 0) return availableSelection
  if (currentWorkspaceId != null && availableIds.has(currentWorkspaceId)) {
    return [currentWorkspaceId]
  }
  return [USAGE_GLOBAL_WORKSPACE_SCOPE_ID]
}

export const resolveUsagePanelDataScope = (
  selection: string[],
  currentWorkspaceId?: string
): UsagePanelDataScope | undefined => {
  if (selection.includes(USAGE_GLOBAL_WORKSPACE_SCOPE_ID)) {
    return { kind: 'all' }
  }
  if (
    currentWorkspaceId != null &&
    selection.length === 1 &&
    selection[0] === currentWorkspaceId
  ) {
    return undefined
  }
  return selection.length === 0
    ? { kind: 'all' }
    : { kind: 'workspaces', workspaceIds: selection }
}

export const resolveUsageReportContext = (
  surface: 'launcher' | 'workspace',
  dataScope?: UsagePanelDataScope
): {
  query: Pick<UsageQuery, 'scope' | 'workspaces'>
  surface: 'launcher' | 'workspace'
} => {
  if (surface === 'workspace' && dataScope == null) {
    return {
      query: { scope: 'workspace' },
      surface: 'workspace'
    }
  }
  return {
    query: {
      scope: 'all',
      ...(dataScope?.kind === 'workspaces'
        ? { workspaces: dataScope.workspaceIds }
        : {})
    },
    surface: 'launcher'
  }
}
