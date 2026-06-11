import type { IncomingMessage, ServerResponse } from 'node:http'

import { requireAuthPermission } from '../auth/permissions.js'
import { enabledAuthProviders } from '../auth/providers.js'
import {
  createSsoProviderFromBody,
  redactSsoProvider,
  updateSsoProviderFromBody
} from '../auth/sso-provider-management.js'
import { readRequestBody, sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayServerArgs, RelayStore } from '../types.js'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const pathId = (url: URL, prefix: string) => {
  if (url.pathname === prefix) return undefined
  const escaped = url.pathname.slice(prefix.length + 1)
  return escaped === '' ? undefined : decodeURIComponent(escaped)
}

const providerIdFromRequest = async (req: IncomingMessage, url: URL, pathProviderId: string | undefined) => {
  const queryId = cleanString(url.searchParams.get('id'))
  if (pathProviderId != null && pathProviderId !== '') return pathProviderId
  if (queryId !== '') return queryId
  const body = await readRequestBody(req)
  return cleanString(body.id)
}

const configuredProviderIds = (args: RelayServerArgs, store: RelayStore) =>
  new Set([
    ...enabledAuthProviders(args.oauth),
    ...store.ssoProviders.map(provider => provider.id)
  ])

export const handleAdminSsoProviders = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
) => {
  const requiredPermission = req.method === 'GET'
    ? relayPermissions.adminSsoRead
    : relayPermissions.adminSsoWrite
  if (
    requireAuthPermission(req, res, args, store, requiredPermission, { unauthorizedError: 'Admin token required.' }) ==
      null
  ) {
    return
  }
  const providerId = pathId(url, '/api/admin/sso-providers')
  if (req.method === 'GET' && providerId == null) {
    sendJson(res, 200, { providers: store.ssoProviders.map(redactSsoProvider) }, args.allowOrigin)
    return
  }
  if (req.method === 'GET' && providerId != null) {
    const provider = store.ssoProviders.find(item => item.id === providerId)
    if (provider == null) {
      sendJson(res, 404, { error: 'SSO provider not found.' }, args.allowOrigin)
      return
    }
    sendJson(res, 200, { provider: redactSsoProvider(provider) }, args.allowOrigin)
    return
  }
  if (req.method === 'POST' && providerId == null) {
    const body = await readRequestBody(req)
    try {
      const provider = createSsoProviderFromBody(body, configuredProviderIds(args, store))
      store.ssoProviders.push(provider)
      await storeRepository.write(store)
      sendJson(res, 200, { provider: redactSsoProvider(provider) }, args.allowOrigin)
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }, args.allowOrigin)
    }
    return
  }
  if (req.method === 'PATCH') {
    const body = await readRequestBody(req)
    const id = providerId ?? cleanString(body.id)
    if (id === '') {
      sendJson(res, 400, { error: 'SSO provider id is required.' }, args.allowOrigin)
      return
    }
    const provider = store.ssoProviders.find(item => item.id === id)
    if (provider == null) {
      sendJson(res, 404, { error: 'SSO provider not found.' }, args.allowOrigin)
      return
    }
    try {
      const updatedProvider = updateSsoProviderFromBody(provider, body)
      Object.assign(provider, updatedProvider)
      await storeRepository.write(store)
      sendJson(res, 200, { provider: redactSsoProvider(provider) }, args.allowOrigin)
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }, args.allowOrigin)
    }
    return
  }
  if (req.method === 'DELETE') {
    const id = await providerIdFromRequest(req, url, providerId)
    if (id === '') {
      sendJson(res, 400, { error: 'SSO provider id is required.' }, args.allowOrigin)
      return
    }
    const provider = store.ssoProviders.find(item => item.id === id)
    if (provider == null) {
      sendJson(res, 404, { error: 'SSO provider not found.' }, args.allowOrigin)
      return
    }
    store.ssoProviders = store.ssoProviders.filter(item => item.id !== id)
    await storeRepository.write(store)
    sendJson(res, 200, { deleted: true, provider: redactSsoProvider(provider) }, args.allowOrigin)
    return
  }
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
}
