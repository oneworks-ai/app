import { createReadStream } from 'node:fs'

import Router from '@koa/router'
import type { Context } from 'koa'

import { getWorkspaceGitState, listWorkspaceGitBranches, listWorkspaceGitWorktrees } from '#~/services/git/index.js'
import { getWorkspaceActivitySnapshot } from '#~/services/session/index.js'
import {
  getWorkspacePathActionCapabilities,
  revealWorkspacePathInFileManager
} from '#~/services/workspace/file-manager.js'
import { listWorkspaceFileOpeners, openWorkspaceFileInExternalOpener } from '#~/services/workspace/file-opener.js'
import { readWorkspaceFile, updateWorkspaceFile } from '#~/services/workspace/file.js'
import { resolveWorkspaceMediaResource } from '#~/services/workspace/media.js'
import { getWorkspacePanelState, updateWorkspacePanelState } from '#~/services/workspace/panel-state.js'
import { listWorkspaceTree } from '#~/services/workspace/tree.js'
import { resolveWorkspaceOpenerIconResource } from '#~/services/workspace/workspace-opener-icons.js'
import { openWorkspaceInExternalOpener } from '#~/services/workspace/workspace-opener.js'

import { sendWorkspaceMediaResponse } from './workspace-media-response'

export function workspaceRouter(): Router {
  const router = new Router()

  router.get('/tree', async (ctx) => {
    const { path } = ctx.query as { path?: string }
    ctx.body = await listWorkspaceTree(path)
  })

  router.get('/file', async (ctx) => {
    const { path } = ctx.query as { path?: string }
    ctx.body = await readWorkspaceFile(path)
  })

  router.get('/file-openers', async (ctx) => {
    ctx.body = await listWorkspaceFileOpeners()
  })

  router.get('/path-actions', async (ctx) => {
    ctx.body = await getWorkspacePathActionCapabilities()
  })

  router.get('/activity', (ctx) => {
    ctx.body = getWorkspaceActivitySnapshot()
  })

  router.get('/panel-state', async (ctx) => {
    ctx.body = await getWorkspacePanelState()
  })

  router.patch('/panel-state', async (ctx) => {
    const { panelState } = ctx.request.body as { panelState?: unknown }
    ctx.body = await updateWorkspacePanelState(panelState)
  })

  router.get('/opener-icon', async (ctx) => {
    const { opener } = ctx.query as { opener?: string }
    const resource = await resolveWorkspaceOpenerIconResource(opener)
    ctx.state.skipApiEnvelope = true
    ctx.type = resource.mimeType
    ctx.length = resource.size
    ctx.set('Cache-Control', 'private, max-age=86400')
    ctx.set('X-Content-Type-Options', 'nosniff')
    ctx.body = createReadStream(resource.filePath)
  })

  router.post('/open-file', async (ctx) => {
    const { column, line, opener, path } = ctx.request.body as {
      column?: unknown
      line?: unknown
      opener?: unknown
      path?: string
    }
    ctx.body = await openWorkspaceFileInExternalOpener(path, { column, line, opener })
  })

  router.post('/open-workspace', async (ctx) => {
    const { opener } = ctx.request.body as { opener?: unknown }
    ctx.body = await openWorkspaceInExternalOpener({ opener })
  })

  router.post('/reveal-path', async (ctx) => {
    const { path } = ctx.request.body as { path?: string }
    ctx.body = await revealWorkspacePathInFileManager(path)
  })

  const handleWorkspaceResource = async (ctx: Context) => {
    const { path } = ctx.query as { path?: string }
    const resource = await resolveWorkspaceMediaResource(path)
    await sendWorkspaceMediaResponse(ctx, resource)
  }

  router.get('/resource', handleWorkspaceResource)
  router.head('/resource', handleWorkspaceResource)

  router.put('/file', async (ctx) => {
    const { content, path } = ctx.request.body as { content?: unknown; path?: string }
    ctx.body = await updateWorkspaceFile(path, content)
  })

  router.get('/git', async (ctx) => {
    ctx.body = await getWorkspaceGitState()
  })

  router.get('/git/branches', async (ctx) => {
    ctx.body = await listWorkspaceGitBranches()
  })

  router.get('/git/worktrees', async (ctx) => {
    ctx.body = await listWorkspaceGitWorktrees()
  })

  return router
}
