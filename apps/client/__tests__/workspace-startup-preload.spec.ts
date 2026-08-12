/* eslint-disable import/first -- Vitest mocks must be installed before importing the preload module. */
import { describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => ({
  authenticatedApp: vi.fn(),
  chatRoute: vi.fn(),
  workspaceApp: vi.fn()
}))

vi.mock('#~/AuthenticatedApp', () => {
  loaded.authenticatedApp()
  return { AuthenticatedApp: () => null }
})

vi.mock('#~/routes/ChatRoute', () => {
  loaded.chatRoute()
  return { ChatRoute: () => null }
})

vi.mock('#~/WorkspaceApp', () => {
  loaded.workspaceApp()
  return { WorkspaceApp: () => null }
})

import { preloadWorkspaceSurface } from '#~/workspace-startup-preload'

describe('workspace startup preload', () => {
  it('loads the real workspace, authenticated app, and chat route modules in parallel', async () => {
    await preloadWorkspaceSurface()

    expect(loaded.workspaceApp).toHaveBeenCalledOnce()
    expect(loaded.authenticatedApp).toHaveBeenCalledOnce()
    expect(loaded.chatRoute).toHaveBeenCalledOnce()
  })
})
