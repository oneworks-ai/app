export type LauncherInputKeyAction =
  | 'move-active-down'
  | 'move-active-up'
  | 'navigate-parent-directory'
  | 'run-active-command'
  | 'run-active-secondary-command'

export interface LauncherInputKeyState {
  canNavigateToParentDirectory: boolean
  canRunActiveSecondaryAction: boolean
  hasModifier: boolean
  isDirectoryBrowserMode: boolean
  key: string
  selectionEnd: number | null
  selectionStart: number | null
  valueLength: number
}

export const resolveLauncherInputKeyAction = ({
  canNavigateToParentDirectory,
  canRunActiveSecondaryAction,
  hasModifier,
  isDirectoryBrowserMode,
  key,
  selectionEnd,
  selectionStart,
  valueLength
}: LauncherInputKeyState): LauncherInputKeyAction | undefined => {
  if (key === 'ArrowDown') return 'move-active-down'
  if (key === 'ArrowUp') return 'move-active-up'
  if (key === 'Enter') return 'run-active-command'

  if (
    !isDirectoryBrowserMode ||
    hasModifier ||
    selectionStart == null ||
    selectionEnd == null ||
    selectionStart !== selectionEnd
  ) {
    return undefined
  }

  if (key === 'ArrowLeft' && selectionStart === 0 && canNavigateToParentDirectory) {
    return 'navigate-parent-directory'
  }
  if (key === 'ArrowRight' && selectionEnd === valueLength && canRunActiveSecondaryAction) {
    return 'run-active-secondary-command'
  }
  return undefined
}
