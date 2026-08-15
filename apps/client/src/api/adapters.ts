import type {
  AdapterAccountDetailResult,
  AdapterAccountsResult,
  AdapterManageAccountOptions,
  AdapterManageAccountProgressEvent,
  AdapterManageAccountResult
} from '@oneworks/types'

import { streamAdapterAccountAction } from './adapter-account-action-stream'
import { createApiUrl, fetchApiJson, jsonHeaders } from './base'

export async function getAdapterAccounts(
  adapter: string,
  options: {
    model?: string
    account?: string
    refresh?: boolean
  } = {}
): Promise<AdapterAccountsResult> {
  const url = createApiUrl(`/api/adapters/${encodeURIComponent(adapter)}/accounts`)
  if (options.model != null && options.model.trim() !== '') {
    url.searchParams.set('model', options.model)
  }
  if (options.account != null && options.account.trim() !== '') {
    url.searchParams.set('account', options.account)
  }
  if (options.refresh === true) {
    url.searchParams.set('refresh', 'true')
  }
  return fetchApiJson<AdapterAccountsResult>(url)
}

export async function getAdapterAccountDetail(
  adapter: string,
  account: string,
  options: {
    model?: string
    refresh?: boolean
  } = {}
): Promise<AdapterAccountDetailResult> {
  const url = createApiUrl(`/api/adapters/${encodeURIComponent(adapter)}/accounts/${encodeURIComponent(account)}`)
  if (options.model != null && options.model.trim() !== '') {
    url.searchParams.set('model', options.model)
  }
  if (options.refresh === true) {
    url.searchParams.set('refresh', 'true')
  }
  return fetchApiJson<AdapterAccountDetailResult>(url)
}

export async function manageAdapterAccount(
  adapter: string,
  options: Pick<
    AdapterManageAccountOptions,
    'action' | 'account' | 'creditId' | 'model' | 'operationId' | 'refresh'
  >,
  requestOptions?: Pick<RequestInit, 'signal'> & {
    onProgress?: (event: Pick<AdapterManageAccountProgressEvent, 'phase'>) => void
  }
): Promise<AdapterManageAccountResult> {
  if (requestOptions?.onProgress != null) {
    return await streamAdapterAccountAction({
      adapter,
      options,
      onProgress: requestOptions.onProgress,
      signal: requestOptions.signal ?? undefined
    })
  }
  return fetchApiJson<AdapterManageAccountResult>(
    createApiUrl(`/api/adapters/${encodeURIComponent(adapter)}/accounts/actions`),
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(options),
      ...requestOptions
    }
  )
}

export const createAdapterAccountOperationId = () => (
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `adapter-account-${Date.now()}-${Math.random().toString(36).slice(2)}`
)
