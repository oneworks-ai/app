export interface InitChannelsOptions {
  serverBaseUrl?: string
}

const normalizeOptionalString = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed == null || trimmed === '' ? undefined : trimmed
}

export const applyChannelServerDefaults = (
  rawConfig: Record<string, unknown>,
  options: InitChannelsOptions
) => {
  const serverBaseUrl = normalizeOptionalString(options.serverBaseUrl)
  if (serverBaseUrl == null) return rawConfig

  const configuredServerBaseUrl = typeof rawConfig.serverBaseUrl === 'string'
    ? normalizeOptionalString(rawConfig.serverBaseUrl)
    : rawConfig.serverBaseUrl
  if (configuredServerBaseUrl != null) return rawConfig

  return {
    ...rawConfig,
    serverBaseUrl
  }
}
