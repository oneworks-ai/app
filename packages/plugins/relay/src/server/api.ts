import { buildRelayConfigShareDraft } from '../shared/config-share-draft.js'

import type { RelayController } from './controller.js'
import { normalizeOptions } from './options.js'
import { createErrorResponse, createJsonResponse, readBody } from './responses.js'
import type { PluginProxyRequest } from './types.js'

const readErrorStatus = (error: unknown, fallback: number) => {
  if (error == null || typeof error !== 'object') return fallback
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 600
    ? status
    : fallback
}

const readErrorCode = (error: unknown) => {
  if (error == null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.trim() !== '' ? code.trim() : undefined
}

const controllerJson = async (action: () => Promise<unknown>, errorStatus = 400) => {
  try {
    return createJsonResponse(await action())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = readErrorCode(error)
    return code == null
      ? createErrorResponse(message, readErrorStatus(error, errorStatus))
      : createJsonResponse({ code, error: message }, readErrorStatus(error, errorStatus))
  }
}

export const handleRelayApi = async (request: PluginProxyRequest, controller: RelayController) => {
  const route = request.path.replace(/^\/+|\/+$/g, '')
  if (request.method === 'GET' && (route === '' || route === 'status')) {
    return createJsonResponse(await controller.getPublicStatus())
  }
  if (request.method === 'POST' && route === 'server-info') {
    return await controllerJson(async () => await controller.getServiceInfo(readBody(request)), 502)
  }
  if (request.method === 'POST' && route === 'connect') {
    return createJsonResponse(await controller.connect(readBody(request)))
  }
  if (request.method === 'POST' && route === 'login-url') {
    return await controllerJson(async () => await controller.createLoginUrl(readBody(request)))
  }
  if (request.method === 'POST' && route === 'login-options') {
    return await controllerJson(async () => await controller.getNativeLoginOptions(readBody(request)), 502)
  }
  if (request.method === 'POST' && route === 'native-login') {
    return await controllerJson(async () => await controller.proxyNativeLoginRequest(readBody(request)), 502)
  }
  if (request.method === 'POST' && route === 'login-callback') {
    return await controllerJson(async () => await controller.completeLogin(readBody(request)))
  }
  if (request.method === 'POST' && route === 'workspaces/open') {
    return await controllerJson(async () => await controller.openWorkspaceProxy(readBody(request)), 401)
  }
  if (request.method === 'POST' && route === 'workspaces/directories') {
    return await controllerJson(async () => await controller.listWorkspaceDirectories(readBody(request)), 401)
  }
  if (request.method === 'POST' && route === 'workspaces/create') {
    return await controllerJson(async () => await controller.createWorkspaceInDirectory(readBody(request)), 401)
  }
  if (request.method === 'GET' && route.startsWith('workspaces/') && route.endsWith('/connection')) {
    const workspaceId = decodeURIComponent(route.slice('workspaces/'.length, -'/connection'.length))
    return await controllerJson(async () => await controller.getWorkspaceProxyConnection({ workspaceId }), 404)
  }
  if ((request.method === 'GET' || request.method === 'POST') && route === 'profile') {
    return await controllerJson(async () => await controller.getProfile(readBody(request)), 401)
  }
  if (request.method === 'POST' && route === 'profile/password') {
    return await controllerJson(async () => await controller.changeProfilePassword(readBody(request)), 401)
  }
  if (request.method === 'POST' && route === 'profile/access-tokens') {
    return await controllerJson(async () => await controller.createProfileAccessToken(readBody(request)), 401)
  }
  if (request.method === 'PATCH' && route.startsWith('profile/access-tokens/')) {
    return await controllerJson(async () =>
      await controller.updateProfileAccessToken({
        ...readBody(request),
        tokenId: decodeURIComponent(route.slice('profile/access-tokens/'.length))
      }), 401)
  }
  if (request.method === 'DELETE' && route.startsWith('profile/access-tokens/')) {
    return await controllerJson(async () =>
      await controller.revokeProfileAccessToken({
        ...readBody(request),
        tokenId: decodeURIComponent(route.slice('profile/access-tokens/'.length))
      }), 401)
  }
  if (request.method === 'PATCH' && route.startsWith('profile/devices/')) {
    return await controllerJson(async () =>
      await controller.updateProfileDeviceAlias({
        ...readBody(request),
        deviceId: decodeURIComponent(route.slice('profile/devices/'.length))
      }), 401)
  }
  if (request.method === 'DELETE' && route === 'profile/account') {
    return await controllerJson(async () => await controller.deleteProfileAccount(readBody(request)), 401)
  }
  if ((request.method === 'GET' || request.method === 'POST') && route === 'users') {
    return await controllerJson(async () => await controller.listUsers(readBody(request)))
  }
  if (request.method === 'POST' && route === 'users/delete-local') {
    return await controllerJson(async () => await controller.deleteLocalUser(readBody(request)))
  }
  if (request.method === 'POST' && route === 'users/logout') {
    return await controllerJson(async () => await controller.logoutUser(readBody(request)))
  }
  if (request.method === 'POST' && route === 'users/enable') {
    return await controllerJson(async () => await controller.setUserEnabled(readBody(request), true))
  }
  if (request.method === 'POST' && route === 'users/disable') {
    return await controllerJson(async () => await controller.setUserEnabled(readBody(request), false))
  }
  if (request.method === 'POST' && route === 'config-refresh') {
    return createJsonResponse(await controller.refreshConfigDistribution(readBody(request)))
  }
  if (request.method === 'POST' && route === 'config-share-draft') {
    return createJsonResponse(buildRelayConfigShareDraft(readBody(request)))
  }
  if ((request.method === 'GET' || request.method === 'POST') && route === 'config-share-profile-detail') {
    return await controllerJson(async () => await controller.getConfigShareProfileDetail(readBody(request)))
  }
  if ((request.method === 'GET' || request.method === 'POST') && route === 'config-share-targets') {
    return await controllerJson(async () => await controller.getConfigShareTargets(readBody(request)))
  }
  if (request.method === 'POST' && route === 'config-share-publish') {
    return await controllerJson(async () => await controller.publishConfigShareDraft(readBody(request)))
  }
  if (request.method === 'POST' && route === 'config-share-assignment-update') {
    return await controllerJson(async () => await controller.updateConfigShareAssignment(readBody(request)))
  }
  if (request.method === 'POST' && route === 'config-source-enabled') {
    return await controllerJson(async () => await controller.setConfigSourceEnabled(readBody(request)))
  }
  if (request.method === 'POST' && route === 'personal-document-sync-enabled') {
    return await controllerJson(async () => await controller.setPersonalDocumentSyncEnabled(readBody(request)))
  }
  if (request.method === 'POST' && route === 'personal-document-import-root-agents') {
    return await controllerJson(async () => await controller.importPersonalDocumentRootAgents(readBody(request)))
  }
  if (request.method === 'POST' && route === 'team-document-sync-enabled') {
    return await controllerJson(async () => await controller.setTeamDocumentSyncEnabled(readBody(request)))
  }
  if (request.method === 'POST' && route === 'document-entries') {
    return await controllerJson(async () => await controller.listDocumentEntries(readBody(request)))
  }
  if (request.method === 'POST' && route === 'document-path/open') {
    return await controllerJson(async () => await controller.openDocumentPath(readBody(request)))
  }
  if (request.method === 'POST' && route === 'document-content') {
    return await controllerJson(async () => await controller.readDocumentContent(readBody(request)))
  }
  if (request.method === 'POST' && route === 'disconnect') {
    return createJsonResponse(await controller.disconnect(readBody(request)))
  }
  if (request.method === 'POST' && route === 'forget') {
    return createJsonResponse(await controller.forget(readBody(request)))
  }
  if (request.method === 'POST' && route === 'options-preview') {
    return createJsonResponse({
      options: normalizeOptions(readBody(request))
    })
  }
  return createErrorResponse(`Unknown relay plugin API route: ${request.method} /${route}`, 404)
}
