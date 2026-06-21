export interface BrowserActivityRouteState {
  browserActivity: {
    projectKeys: string[]
    sessionKey?: string
  }
}

const normalizeBrowserActivityKey = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

export const createBrowserActivityRouteState = ({
  projectKeys,
  sessionKey
}: {
  projectKeys?: Array<string | undefined>
  sessionKey?: string
}): BrowserActivityRouteState => ({
  browserActivity: {
    projectKeys: Array.from(
      new Set((projectKeys ?? []).map(normalizeBrowserActivityKey).filter((value): value is string => value != null))
    ),
    ...(normalizeBrowserActivityKey(sessionKey) == null ? {} : { sessionKey: normalizeBrowserActivityKey(sessionKey) })
  }
})

export const getCurrentWorkspaceBrowserActivityRouteState = async () => {
  const workspaceConnection = await window.oneworksDesktop?.getWorkspaceConnection?.()
  const workspaceFolder = normalizeBrowserActivityKey(workspaceConnection?.workspaceFolder)
  if (workspaceFolder == null) return undefined
  return createBrowserActivityRouteState({ projectKeys: [workspaceFolder] })
}
