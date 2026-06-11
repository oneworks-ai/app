import Router from '@koa/router'

import { installSkillHubItem, searchSkillHub } from '#~/services/skill-hub/index.js'
import { badRequest, internalServerError } from '#~/utils/http.js'

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizePositiveInteger = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined
}

export function skillHubRouter(): Router {
  const router = new Router()

  router.get('/search', async (ctx) => {
    try {
      ctx.body = await searchSkillHub({
        limit: normalizePositiveInteger(ctx.query.limit),
        query: typeof ctx.query.q === 'string' ? ctx.query.q : '',
        registry: typeof ctx.query.registry === 'string' ? ctx.query.registry : undefined
      })
    } catch (err) {
      throw internalServerError('Failed to search skill hub', { cause: err, code: 'skill_hub_search_failed' })
    }
  })

  router.post('/install', async (ctx) => {
    const body = ctx.request.body as {
      registry?: unknown
      skill?: unknown
      force?: unknown
    }
    const registry = normalizeString(body.registry)
    const skill = normalizeString(body.skill)

    if (registry == null || skill == null) {
      throw badRequest('Missing registry or skill', { registry: body.registry, skill: body.skill }, 'missing_target')
    }

    try {
      ctx.body = await installSkillHubItem({
        registry,
        skill,
        force: body.force === true
      })
    } catch (err) {
      throw internalServerError('Failed to install skill hub item', {
        cause: err,
        code: 'skill_hub_install_failed',
        details: {
          registry,
          skill,
          message: err instanceof Error ? err.message : String(err)
        }
      })
    }
  })

  router.get('/skills-cli/search', async (ctx) => {
    try {
      ctx.body = await searchSkillHub({
        limit: normalizePositiveInteger(ctx.query.limit),
        query: typeof ctx.query.q === 'string' ? ctx.query.q : '',
        registry: typeof ctx.query.registry === 'string' ? ctx.query.registry : undefined
      })
    } catch (err) {
      throw internalServerError('Failed to search skill hub', {
        cause: err,
        code: 'skill_hub_skills_cli_search_failed'
      })
    }
  })

  router.post('/skills-cli/install', async (ctx) => {
    const body = ctx.request.body as {
      registry?: unknown
      skill?: unknown
      force?: unknown
    }
    const registry = normalizeString(body.registry)
    const skill = normalizeString(body.skill)

    if (registry == null || skill == null) {
      throw badRequest('Missing registry or skill', { registry: body.registry, skill: body.skill }, 'missing_target')
    }

    try {
      ctx.body = await installSkillHubItem({
        skill,
        registry,
        force: body.force === true
      })
    } catch (err) {
      throw internalServerError('Failed to install skills CLI skill', {
        cause: err,
        code: 'skill_hub_skills_cli_install_failed',
        details: {
          registry,
          skill,
          message: err instanceof Error ? err.message : String(err)
        }
      })
    }
  })

  return router
}
