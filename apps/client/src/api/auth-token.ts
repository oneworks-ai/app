import { getServerBaseUrl } from '#~/runtime-config'
import {
  clearAuthTokenForServerUrl,
  getAuthTokenForServerUrl,
  setAuthTokenForServerUrl
} from '#~/server-connection-history'

export const getAuthToken = () => {
  const serverUrl = getServerBaseUrl()
  const scopedToken = getAuthTokenForServerUrl(serverUrl)?.trim()
  return scopedToken == null || scopedToken === '' ? undefined : scopedToken
}

export const setAuthToken = (token: string) => {
  const normalized = token.trim()
  if (normalized === '') {
    return
  }
  setAuthTokenForServerUrl(getServerBaseUrl(), normalized)
}

export const clearAuthToken = () => {
  clearAuthTokenForServerUrl(getServerBaseUrl())
}

export const applyAuthHeader = (headers: Headers) => {
  const token = getAuthToken()
  if (token == null || headers.has('Authorization')) {
    return
  }
  headers.set('Authorization', `Bearer ${token}`)
}
