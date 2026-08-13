import { getFilesystemPathComparisonKey, readNonBlankFilesystemPath } from '#~/utils/filesystem-path-identity'

export interface BrowserActivityRouteState {
  browserActivity: {
    projectKeys: string[]
    sessionKey?: string
  }
}

const normalizeBrowserActivityText = (value: string | undefined) => {
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
    projectKeys: (projectKeys ?? []).reduce<string[]>((keys, value) => {
      const path = readNonBlankFilesystemPath(value)
      return path == null ||
          keys.some(key => getFilesystemPathComparisonKey(key) === getFilesystemPathComparisonKey(path))
        ? keys
        : [...keys, path]
    }, []),
    ...(normalizeBrowserActivityText(sessionKey) == null
      ? {}
      : { sessionKey: normalizeBrowserActivityText(sessionKey) })
  }
})

export const getCurrentWorkspaceBrowserActivityRouteState = async () => {
  const workspaceConnection = await window.oneworksDesktop?.getWorkspaceConnection?.()
  const workspaceFolder = readNonBlankFilesystemPath(workspaceConnection?.workspaceFolder)
  if (workspaceFolder == null) return undefined
  return createBrowserActivityRouteState({ projectKeys: [workspaceFolder] })
}
