import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseDesktopDeepLinkLaunchRequest } from '../src/main/deep-link'
import type { WorkspaceService } from '../src/main/types'
import { openWorkspaceLaunchRequest, stopWorkspaceRuntimeFolder } from '../src/main/workspace-runtime-identity'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

const createWhitespaceWorkspace = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ow-desktop-runtime-identity-'))
  tempRoots.push(root)
  const workspaceFolder = path.join(root, process.platform === 'win32' ? ' workspace' : ' workspace ')
  await mkdir(workspaceFolder)
  return await realpath(workspaceFolder)
}

describe('desktop app runtime workspace identity', () => {
  it('looks up, stops, remembers, and forgets the exact whitespace-bearing service key', async () => {
    const workspaceFolder = await createWhitespaceWorkspace()
    const service = { workspaceFolder } as WorkspaceService
    const services = new Map([[workspaceFolder, service]])
    const stopWorkspaceService = vi.fn(async () => undefined)
    const rememberWorkspaceFolder = vi.fn()
    const forgetWorkspaceFolder = vi.fn()

    await expect(stopWorkspaceRuntimeFolder({
      forgetWorkspaceFolder,
      rememberWorkspaceFolder,
      services,
      stopWorkspaceService,
      workspaceFolder
    })).resolves.toEqual({
      ok: true,
      removed: false,
      stopped: true,
      workspaceFolder
    })
    expect(stopWorkspaceService).toHaveBeenCalledWith(service)
    expect(rememberWorkspaceFolder).toHaveBeenCalledWith(workspaceFolder)
    expect(forgetWorkspaceFolder).not.toHaveBeenCalled()

    await expect(stopWorkspaceRuntimeFolder({
      forgetWorkspaceFolder,
      input: { forget: true },
      rememberWorkspaceFolder,
      services,
      stopWorkspaceService,
      workspaceFolder
    })).resolves.toMatchObject({ removed: true, stopped: true, workspaceFolder })
    expect(forgetWorkspaceFolder).toHaveBeenCalledWith(workspaceFolder)
  })

  it('opens a decoded Relay auth callback against the exact workspace directory', async () => {
    const workspaceFolder = await createWhitespaceWorkspace()
    const url = new URL('oneworks://relay/auth')
    url.searchParams.set('workspace', workspaceFolder)
    url.searchParams.set('scope', 'relay')
    url.hash = new URLSearchParams({ relay_token: 'token' }).toString()
    const launchRequest = parseDesktopDeepLinkLaunchRequest(url.toString())
    expect(launchRequest?.workspaceFolder).toBe(workspaceFolder)

    const windowManager = {
      createLauncherWindow: vi.fn(),
      openLauncherRouteWindow: vi.fn(),
      openStandaloneTabWindow: vi.fn(),
      openWorkspaceRouteWindow: vi.fn(async () => undefined),
      openWorkspaceWindow: vi.fn()
    }
    await openWorkspaceLaunchRequest(launchRequest!, windowManager as never)

    expect(windowManager.openWorkspaceRouteWindow).toHaveBeenCalledWith(
      workspaceFolder,
      'plugins/relay/home?relayLogin=1#relay_token=token'
    )
    expect(windowManager.openWorkspaceWindow).not.toHaveBeenCalled()
  })
})
