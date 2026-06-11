import Router from '@koa/router'
import { createReadStream } from 'node:fs'
import path from 'node:path'

import { isModuleUpdateChannel } from '@oneworks/types'
import type { ModuleUpdateChannel, ModuleUpdateSettingsPatch } from '@oneworks/types'

import {
  checkModuleUpdates,
  installModuleUpdate,
  resolveModuleUpdateChangelogAsset,
  updateModuleUpdateSettings
} from '#~/services/module-updates.js'
import { badRequest, internalServerError, isHttpError, notFound } from '#~/utils/http.js'

const MODULE_UPDATE_ID_PATTERN = /^(?:web|client|server|adapter:[\w.-]+|plugin:[\w.-]+)$/

const assertModuleUpdateId = (id: string | undefined) => {
  const normalized = id?.trim()
  if (normalized == null || normalized === '') {
    throw badRequest('Module id is required', { id }, 'module_update_id_required')
  }
  if (!MODULE_UPDATE_ID_PATTERN.test(normalized)) {
    throw badRequest('Invalid module id', { id }, 'module_update_id_invalid')
  }
  return normalized
}

const handleModuleUpdateError = (error: unknown, message: string, code: string): never => {
  if (isHttpError(error)) {
    throw error
  }
  throw internalServerError(message, {
    cause: error,
    code
  })
}

const getRequestLanguage = (ctx: { get: (name: string) => string }) => {
  const language = ctx.get('accept-language').trim()
  return language === '' ? undefined : language
}

const getChangelogAssetContentType = (filePath: string) => {
  switch (path.extname(filePath).toLowerCase()) {
    case '.apng':
      return 'image/apng'
    case '.avif':
      return 'image/avif'
    case '.gif':
      return 'image/gif'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

const parseModuleUpdateSettingsPatch = (body: unknown): ModuleUpdateSettingsPatch => {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Invalid module update settings patch', { body }, 'module_update_settings_invalid')
  }

  const input = body as {
    defaultChannel?: unknown
    moduleChannels?: unknown
  }
  if (input.defaultChannel != null && !isModuleUpdateChannel(input.defaultChannel)) {
    throw badRequest(
      'Invalid default module update channel',
      { defaultChannel: input.defaultChannel },
      'module_update_default_channel_invalid'
    )
  }
  if (
    input.moduleChannels != null && (typeof input.moduleChannels !== 'object' || Array.isArray(input.moduleChannels))
  ) {
    throw badRequest(
      'Invalid module update channel overrides',
      { moduleChannels: input.moduleChannels },
      'module_update_channel_overrides_invalid'
    )
  }

  const moduleChannels = input.moduleChannels == null
    ? undefined
    : Object.entries(input.moduleChannels as Record<string, unknown>)
      .reduce<Record<string, ModuleUpdateChannel | null>>((acc, [key, value]) => {
        if (value == null) {
          acc[key] = null
          return acc
        }
        if (!isModuleUpdateChannel(value)) {
          throw badRequest(
            'Invalid module update channel override',
            { channel: value, key },
            'module_update_channel_override_invalid'
          )
        }
        acc[key] = value
        return acc
      }, {})

  return {
    ...(input.defaultChannel == null ? {} : { defaultChannel: input.defaultChannel }),
    ...(moduleChannels == null ? {} : { moduleChannels })
  }
}

export function moduleUpdatesRouter(): Router {
  const router = new Router()

  router.get(['/', ''], async (ctx) => {
    try {
      ctx.body = await checkModuleUpdates({ language: getRequestLanguage(ctx) })
    } catch (error) {
      handleModuleUpdateError(error, 'Failed to check module updates', 'module_updates_check_failed')
    }
  })

  router.post('/check', async (ctx) => {
    try {
      ctx.body = await checkModuleUpdates({ language: getRequestLanguage(ctx) })
    } catch (error) {
      handleModuleUpdateError(error, 'Failed to check module updates', 'module_updates_check_failed')
    }
  })

  router.patch('/settings', async (ctx) => {
    const patch = parseModuleUpdateSettingsPatch(ctx.request.body)
    try {
      ctx.body = await updateModuleUpdateSettings(patch, { language: getRequestLanguage(ctx) })
    } catch (error) {
      handleModuleUpdateError(error, 'Failed to update module update settings', 'module_update_settings_update_failed')
    }
  })

  router.get('/changelog-assets/:asset', async (ctx) => {
    const asset = ctx.params.asset?.trim()
    if (asset == null || asset === '') {
      throw badRequest('Changelog asset path is required', { asset }, 'module_update_changelog_asset_required')
    }

    try {
      const resolvedAsset = await resolveModuleUpdateChangelogAsset(asset)
      const responseState = ctx.state as { skipApiEnvelope?: boolean }
      responseState.skipApiEnvelope = true
      ctx.type = getChangelogAssetContentType(resolvedAsset.filePath)
      ctx.body = createReadStream(resolvedAsset.filePath)
    } catch (error) {
      console.warn('[module-updates] failed to resolve changelog asset', error)
      throw notFound(
        'Changelog asset not found',
        { asset },
        'module_update_changelog_asset_not_found'
      )
    }
  })

  router.post('/:id/install', async (ctx) => {
    const id = assertModuleUpdateId(ctx.params.id)
    const body = (ctx.request.body ?? {}) as { version?: unknown }
    try {
      ctx.body = await installModuleUpdate(id, { language: getRequestLanguage(ctx), version: body.version })
    } catch (error) {
      handleModuleUpdateError(error, 'Failed to install module update', 'module_update_install_failed')
    }
  })

  return router
}
