import { requestJson } from '../../shared/api/requestJson'
import type {
  CreateSsoProviderInput,
  RelayAdminSsoProvider,
  UpdateSsoProviderInput
} from '../../shared/model/adminTypes'

export const fetchRelayAdminSsoProviders = async (token: string) =>
  await requestJson<{ providers: RelayAdminSsoProvider[] }>(token, '/api/admin/sso-providers')

export const createRelayAdminSsoProvider = async (token: string, input: CreateSsoProviderInput) =>
  await requestJson<{ provider: RelayAdminSsoProvider }>(token, '/api/admin/sso-providers', {
    body: JSON.stringify(input),
    method: 'POST'
  })

export const updateRelayAdminSsoProvider = async (token: string, input: UpdateSsoProviderInput) =>
  await requestJson<{ provider: RelayAdminSsoProvider }>(
    token,
    `/api/admin/sso-providers/${encodeURIComponent(input.id)}`,
    {
      body: JSON.stringify(input),
      method: 'PATCH'
    }
  )

export const deleteRelayAdminSsoProvider = async (token: string, id: string) =>
  await requestJson<{ deleted: boolean }>(token, `/api/admin/sso-providers/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
