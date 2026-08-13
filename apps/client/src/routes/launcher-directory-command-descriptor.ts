export type LauncherDirectoryCommandAction = () => Promise<void> | void

export interface LauncherDirectoryActionAssembly {
  enterDirectory: (path: string) => Promise<void> | void
  selectDirectory: (path: string) => Promise<void> | void
}

export interface LauncherDirectoryCommandDescriptor {
  contextPrimaryAction: LauncherDirectoryCommandAction
  contextSecondaryAction?: LauncherDirectoryCommandAction
  explicitAction?: LauncherDirectoryCommandAction
  primaryAction: LauncherDirectoryCommandAction
  primaryIntent: 'back' | 'enter-directory' | 'select-directory'
  secondaryIntent?: 'enter-directory' | 'select-directory'
}

export const createLauncherDirectoryCommandDescriptor = (input: {
  actions: LauncherDirectoryActionAssembly
  operation: 'back' | 'enter-directory' | 'select-directory'
  path: string
  withSecondaryAction?: boolean
}): LauncherDirectoryCommandDescriptor => {
  const enterDirectory = () => input.actions.enterDirectory(input.path)
  const selectDirectory = () => input.actions.selectDirectory(input.path)

  if (input.operation === 'back') {
    return {
      contextPrimaryAction: enterDirectory,
      primaryAction: enterDirectory,
      primaryIntent: 'back'
    }
  }

  if (input.operation === 'enter-directory') {
    return {
      contextPrimaryAction: enterDirectory,
      contextSecondaryAction: selectDirectory,
      explicitAction: selectDirectory,
      primaryAction: enterDirectory,
      primaryIntent: 'enter-directory',
      secondaryIntent: 'select-directory'
    }
  }

  return {
    contextPrimaryAction: selectDirectory,
    ...(input.withSecondaryAction === false
      ? {}
      : {
        contextSecondaryAction: enterDirectory,
        explicitAction: enterDirectory,
        secondaryIntent: 'enter-directory' as const
      }),
    primaryAction: selectDirectory,
    primaryIntent: 'select-directory'
  }
}
