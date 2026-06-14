import { getClientVersion } from '#~/client-build-info'
import { createServerUrlFromBase } from '#~/runtime-config'
import { areSemverVersionsCompatible } from '#~/version-compatibility'

export const PWA_DOCS_URL = 'https://oneworks.cloud/docs/usage/pwa'

interface ServerPublicStatus {
  version?: string
}

export class UnsupportedServerVersionError extends Error {
  constructor(
    readonly clientVersion: string,
    readonly serverVersion?: string
  ) {
    super('Unsupported server version')
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readPublicStatus = (value: unknown): ServerPublicStatus => {
  const body = isRecord(value) && isRecord(value.data) ? value.data : value
  return isRecord(body) && typeof body.version === 'string' ? { version: body.version } : {}
}

export const pingServer = async (serverBaseUrl: string) => {
  const response = await fetch(createServerUrlFromBase(serverBaseUrl, '/api/auth/status'), {
    credentials: 'include'
  })
  if (!response.ok) {
    throw new Error(`Server responded with ${response.status}`)
  }

  const publicStatus = readPublicStatus(await response.json().catch(() => undefined))
  const clientVersion = getClientVersion()
  if (!areSemverVersionsCompatible(clientVersion, publicStatus.version)) {
    throw new UnsupportedServerVersionError(clientVersion, publicStatus.version)
  }
  return publicStatus
}
