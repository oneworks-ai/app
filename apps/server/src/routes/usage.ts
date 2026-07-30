import Router from '@koa/router'

import type { UsageQuery } from '@oneworks/types'

import { getWorkspaceUsageReport } from '#~/services/usage/index.js'

const list = (value: unknown) => (
  typeof value === 'string' && value.trim() !== ''
    ? value.split(',').map(item => item.trim()).filter(Boolean)
    : undefined
)

const timestamp = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const parseUsageQuery = (value: Record<string, unknown>): UsageQuery => ({
  accounts: list(value.accounts),
  authorityPlugins: list(value.authorityPlugins),
  devices: list(value.devices),
  from: timestamp(value.from),
  modelServices: list(value.modelServices),
  models: list(value.models),
  tools: list(value.tools),
  to: timestamp(value.to),
  transportPlugins: list(value.transportPlugins),
  workspaces: list(value.workspaces)
})

export function usageRouter(): Router {
  const router = new Router()
  router.get('/', async (ctx) => {
    ctx.body = await getWorkspaceUsageReport(parseUsageQuery(ctx.query))
  })
  return router
}
