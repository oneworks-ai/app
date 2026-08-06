import type Router from '@koa/router'

import { DefinitionLoader } from '@oneworks/definition-loader'

import { resolveAssetCreateAuthority } from '#~/services/ai/asset-create-authority.js'
import { markAssetPreCommitFailure } from '#~/services/ai/asset-create-error.js'
import { createAssetOperationRegistry } from '#~/services/ai/asset-create-operation.js'
import { createProjectAsset, getProjectAssetPreview } from '#~/services/ai/asset-create.js'
import type { CreatedProjectAsset, OpenAssetFilesystemAuthority } from '#~/services/ai/asset-create.js'
import { internalServerError, isHttpError, notFound } from '#~/utils/http.js'

export interface AiAssetCreateRouteOptions {
  assetOperationHooks?: {
    beforeResponse?: () => Promise<void>
    onQueued?: (operationId: string) => void
  }
  createAsset?: typeof createProjectAsset
  openAssetAuthority?: OpenAssetFilesystemAuthority
}

export const registerAiAssetCreateRoutes = (
  router: Router,
  options: AiAssetCreateRouteOptions = {}
) => {
  const operations = createAssetOperationRegistry<CreatedProjectAsset>()
  router.post('/assets', async (ctx) => {
    const input = ctx.request.body
    const operationId = operations.queue(ctx, async () => {
      let authority
      try {
        authority = await resolveAssetCreateAuthority()
      } catch (error) {
        throw markAssetPreCommitFailure(error, 'Failed to resolve data asset authority', 'ai_asset_authority_failed')
      }
      try {
        return await (options.createAsset ?? createProjectAsset)({
          input,
          loader: new DefinitionLoader(authority.workspaceRoot),
          openAuthority: options.openAssetAuthority,
          workspaceIdentity: authority.identity,
          workspaceRoot: authority.workspaceRoot
        })
      } catch (error) {
        if (isHttpError(error)) throw error
        throw internalServerError('Asset creation status is indeterminate', {
          cause: error,
          code: 'ai_asset_create_indeterminate',
          details: { committed: 'indeterminate' }
        })
      }
    })
    options.assetOperationHooks?.onQueued?.(operationId)
    await options.assetOperationHooks?.beforeResponse?.()
    ctx.set('Connection', 'close')
    ctx.status = 202
    ctx.body = { operation: { id: operationId, state: 'pending' } }
  })

  router.get('/assets/operations/:operationId', async (ctx) => {
    const operation = operations.get(ctx.params.operationId)
    if (operation == null) {
      throw notFound(
        'Asset operation status is unavailable',
        { committed: 'indeterminate' },
        'asset_operation_unknown'
      )
    }
    if (operation.state === 'pending') {
      ctx.status = 202
      ctx.body = { operation: { id: ctx.params.operationId, state: 'pending' } }
      return
    }
    if (operation.state === 'failed') throw operation.error
    ctx.status = operation.value.commitState === 'committed-indeterminate' ? 202 : 200
    ctx.body = { asset: operation.value }
  })

  router.get('/assets/preview', async (ctx) => {
    try {
      const authority = await resolveAssetCreateAuthority()
      ctx.body = {
        asset: await getProjectAssetPreview(authority.workspaceRoot, {
          kind: ctx.query.kind,
          name: ctx.query.name
        }, authority.identity)
      }
    } catch (error) {
      if (isHttpError(error)) throw error
      throw internalServerError('Failed to preview data asset', { cause: error, code: 'ai_asset_preview_failed' })
    }
  })
}
