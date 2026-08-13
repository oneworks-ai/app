import { readNonBlankFilesystemPath } from '#~/utils/filesystem-path-identity'

export interface WorkspaceFilePanelState {
  openPaths: string[]
  selectedPath: string | null
  isOpen: boolean
}

export const uniqueNonEmptyPaths = (paths: Array<string | null | undefined>) => {
  const result: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    const rawPath = readNonBlankFilesystemPath(path)
    if (rawPath == null || seen.has(rawPath)) continue
    seen.add(rawPath)
    result.push(rawPath)
  }
  return result
}

export const normalizeWorkspaceFileState = (
  state: WorkspaceFilePanelState | undefined
): WorkspaceFilePanelState => {
  const selectedPath = readNonBlankFilesystemPath(state?.selectedPath) ?? null
  const openPaths = uniqueNonEmptyPaths([
    ...(state?.openPaths ?? []),
    selectedPath
  ])
  const normalizedSelectedPath = selectedPath != null && openPaths.includes(selectedPath)
    ? selectedPath
    : openPaths.at(0) ?? null
  return {
    openPaths,
    selectedPath: normalizedSelectedPath,
    isOpen: state?.isOpen === true && normalizedSelectedPath != null
  }
}
