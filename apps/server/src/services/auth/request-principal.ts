import type Koa from 'koa'

import type { PluginRequestPrincipal } from '@oneworks/types'

const WORKSPACE_PERMISSIONS: PluginRequestPrincipal['permissions'] = [
  'workspace:read',
  'workspace:manage'
]

export const LOCAL_WORKSPACE_REQUEST_PRINCIPAL: PluginRequestPrincipal = Object.freeze({
  id: 'local-workspace',
  kind: 'local_workspace',
  permissions: Object.freeze([...WORKSPACE_PERMISSIONS]) as PluginRequestPrincipal['permissions']
})

export const createWebAccountRequestPrincipal = (username: string): PluginRequestPrincipal => ({
  id: `web-account:${username}`,
  kind: 'web_account',
  permissions: [...WORKSPACE_PERMISSIONS]
})

export const setWorkspaceRequestPrincipal = (
  ctx: Koa.Context,
  principal: PluginRequestPrincipal
) => {
  ;(ctx.state as { workspaceRequestPrincipal?: PluginRequestPrincipal }).workspaceRequestPrincipal = principal
}

export const getWorkspaceRequestPrincipal = (ctx: Koa.Context) =>
  (ctx.state as { workspaceRequestPrincipal?: PluginRequestPrincipal }).workspaceRequestPrincipal
