import { requestJson } from '../../shared/api/requestJson'
import type { RelayAdminMeResponse } from '../../shared/model/adminTypes'

export const fetchRelayAdminMe = async (token: string) => await requestJson<RelayAdminMeResponse>(token, '/api/auth/me')
