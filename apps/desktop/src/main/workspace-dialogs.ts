import { dialog } from 'electron'

import { resolveProjectWorkspaceFolder } from '../workspace-state.cjs'
import type { OpenWorkspaceDialogInput, WindowRecord } from './types'
import { ensureWorkspaceFolderExists } from './workspace-folder-create'

interface WorkspaceDialogControllerInput {
  loadWorkspaceInWindow: (windowRecord: WindowRecord, workspaceFolder: string) => Promise<void>
  openWorkspaceWindow: (workspaceFolder: string) => Promise<WindowRecord>
}

export const createWorkspaceDialogController = ({
  loadWorkspaceInWindow,
  openWorkspaceWindow
}: WorkspaceDialogControllerInput) => {
  const promptForWorkspaceFolder = async (windowRecord?: WindowRecord) => {
    const openDialogOptions: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Open Workspace'
    }
    const result = windowRecord == null
      ? await dialog.showOpenDialog(openDialogOptions)
      : await dialog.showOpenDialog(windowRecord.window, openDialogOptions)
    if (result.canceled || result.filePaths[0] == null) {
      return undefined
    }
    return resolveProjectWorkspaceFolder(result.filePaths[0])
  }

  const promptForNewWorkspaceFolder = async (windowRecord?: WindowRecord) => {
    const saveDialogOptions: Electron.SaveDialogOptions = {
      buttonLabel: 'Create Project',
      defaultPath: 'Untitled Project',
      nameFieldLabel: 'Project folder name:',
      properties: ['createDirectory', 'showOverwriteConfirmation'],
      title: 'New Project Folder'
    }
    const result = windowRecord == null
      ? await dialog.showSaveDialog(saveDialogOptions)
      : await dialog.showSaveDialog(windowRecord.window, saveDialogOptions)
    if (result.canceled || result.filePath == null) {
      return undefined
    }

    return await ensureWorkspaceFolderExists(result.filePath)
  }

  const openWorkspaceDialog = async (input: OpenWorkspaceDialogInput = {}) => {
    const targetWindowRecord = input.targetWindowRecord
    const workspaceFolder = await promptForWorkspaceFolder(targetWindowRecord)
    if (workspaceFolder == null) {
      return undefined
    }

    if (input.reuseTargetWindow === true && targetWindowRecord != null) {
      await loadWorkspaceInWindow(targetWindowRecord, workspaceFolder)
      return workspaceFolder
    }

    await openWorkspaceWindow(workspaceFolder)
    return workspaceFolder
  }

  return {
    openWorkspaceDialog,
    promptForNewWorkspaceFolder,
    promptForWorkspaceFolder
  }
}
