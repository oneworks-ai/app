import * as vscode from 'vscode'

import { SIDEBAR_VIEW_ID } from './constants'
import { ServerManager } from './server-manager'
import { OneWorksSidebarProvider } from './sidebar-provider'

let activeManager: ServerManager | undefined

export function activate(context: vscode.ExtensionContext) {
  const manager = new ServerManager(context)
  const sidebarProvider = new OneWorksSidebarProvider(context, manager)
  activeManager = manager

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SIDEBAR_VIEW_ID,
      sidebarProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    ),
    vscode.commands.registerCommand('oneworks.open', () => sidebarProvider.openWorkspace()),
    vscode.commands.registerCommand('oneworks.reloadView', () => sidebarProvider.reload()),
    vscode.commands.registerCommand('oneworks.restartServer', () => sidebarProvider.restart()),
    vscode.commands.registerCommand('oneworks.stopServer', () => sidebarProvider.stop()),
    vscode.commands.registerCommand('oneworks.stopAllServers', () => sidebarProvider.stopAll()),
    vscode.commands.registerCommand('oneworks.openExternal', () => sidebarProvider.openExternal()),
    {
      dispose: () => {
        void manager.stopAll()
        if (activeManager === manager) {
          activeManager = undefined
        }
      }
    }
  )
}

export function deactivate() {
  return activeManager?.stopAll()
}
