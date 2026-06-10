import { spawn } from 'node:child_process'
import process from 'node:process'

import type { ChildProcess } from 'node:child_process'
import * as vscode from 'vscode'

import { CLIENT_BASE, SERVER_HOST } from './constants'
import { createProcessPath } from './path-search'
import { createMissingBootstrapCommandMessage, resolveBootstrapCommand } from './server-command'
import { assertServerUiReady, getAvailablePort, isRunning, stopChild, waitForServerStartup } from './server-process'
import { normalizeOptionalString } from './utils'

export interface ManagedServer {
  child: ChildProcess
  port: number
  url: string
  workspaceFolder: vscode.WorkspaceFolder
}

const getConfig = () => vscode.workspace.getConfiguration('oneworks')

export class ServerManager {
  private readonly output: vscode.OutputChannel
  private readonly servers = new Map<string, ManagedServer>()
  private readonly starts = new Map<string, Promise<ManagedServer>>()

  constructor(
    private readonly context: vscode.ExtensionContext
  ) {
    this.output = vscode.window.createOutputChannel('One Works')
    this.context.subscriptions.push(this.output)
  }

  async start(workspaceFolder: vscode.WorkspaceFolder) {
    const key = workspaceFolder.uri.fsPath
    const existing = this.servers.get(key)
    if (existing != null && isRunning(existing.child)) {
      return existing
    }

    const pending = this.starts.get(key)
    if (pending != null) {
      return pending
    }

    const startPromise = this.createServer(workspaceFolder)
      .finally(() => this.starts.delete(key))
    this.starts.set(key, startPromise)
    return startPromise
  }

  async restart(workspaceFolder: vscode.WorkspaceFolder) {
    await this.stop(workspaceFolder)
    return this.start(workspaceFolder)
  }

  async stop(workspaceFolder: vscode.WorkspaceFolder) {
    const key = workspaceFolder.uri.fsPath
    const server = this.servers.get(key)
    this.servers.delete(key)
    if (server != null) {
      await stopChild(server.child)
    }
  }

  async stopAll() {
    const servers = [...this.servers.values()]
    this.servers.clear()
    await Promise.all(servers.map(server => stopChild(server.child)))
  }

  private createServer = async (workspaceFolder: vscode.WorkspaceFolder) => {
    const configuredBootstrapCommand = normalizeOptionalString(getConfig().get('bootstrapCommand'))
    const bootstrapCommand = resolveBootstrapCommand(workspaceFolder, configuredBootstrapCommand)
    if (bootstrapCommand == null) {
      throw new Error(createMissingBootstrapCommandMessage())
    }

    const port = await getAvailablePort()
    this.output.appendLine(`[server:${workspaceFolder.name}] starting ${bootstrapCommand.source} web`)

    const args = [
      'web',
      '--host',
      SERVER_HOST,
      '--port',
      String(port),
      '--base',
      CLIENT_BASE,
      '--workspace',
      workspaceFolder.uri.fsPath
    ]

    const env = { ...process.env }
    delete env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
    delete env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
    env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = workspaceFolder.uri.fsPath
    env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceFolder.uri.fsPath
    env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__ = workspaceFolder.uri.fsPath
    env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__ = 'false'

    const child = spawn(bootstrapCommand.command, args, {
      cwd: workspaceFolder.uri.fsPath,
      detached: process.platform !== 'win32',
      env: {
        ...env,
        PATH: createProcessPath(workspaceFolder.uri.fsPath)
      },
      shell: bootstrapCommand.shell,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout?.on(
      'data',
      data => this.output.appendLine(`[server:${workspaceFolder.name}] ${String(data).trimEnd()}`)
    )
    child.stderr?.on(
      'data',
      data => this.output.appendLine(`[server:${workspaceFolder.name}] ${String(data).trimEnd()}`)
    )
    child.once('exit', (code, signal) => {
      const current = this.servers.get(workspaceFolder.uri.fsPath)
      if (current?.child === child) {
        this.servers.delete(workspaceFolder.uri.fsPath)
      }
      this.output.appendLine(
        `[server:${workspaceFolder.name}] exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`
      )
    })

    try {
      await waitForServerStartup(child, port)
      await assertServerUiReady(port)
    } catch (error) {
      await stopChild(child)
      throw error
    }

    const server: ManagedServer = {
      child,
      port,
      url: `http://${SERVER_HOST}:${port}${CLIENT_BASE}/`,
      workspaceFolder
    }
    this.servers.set(workspaceFolder.uri.fsPath, server)
    return server
  }
}
