import { createHash } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { CodexAdapterConfig } from '#~/config-schema.js'

export interface CodexNetworkConfig {
  httpProxy?: string
  httpsProxy?: string
  allProxy?: string
  noProxy?: string
  caCertificate?: string
}

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const readEnv = (
  env: Record<string, string | null | undefined>,
  ...keys: string[]
) => {
  for (const key of keys) {
    const value = readString(env[key])
    if (value != null) return value
  }
  return undefined
}

const normalizeNoProxy = (value: string | string[] | undefined) => (
  Array.isArray(value)
    ? value.map(item => item.trim()).filter(Boolean).join(',')
    : readString(value)
)

const mergeNoProxy = (...values: Array<string | undefined>) => (
  [
    ...new Set(
      values
        .flatMap(value => value?.split(',') ?? [])
        .map(value => value.trim())
        .filter(Boolean)
    )
  ].join(',') || undefined
)

export const resolveCodexNetworkConfig = (params: {
  config?: CodexAdapterConfig['network']
  env: Record<string, string | null | undefined>
}): CodexNetworkConfig => ({
  httpProxy: readString(params.config?.httpProxy) ?? readEnv(params.env, 'HTTP_PROXY', 'http_proxy'),
  httpsProxy: readString(params.config?.httpsProxy) ?? readEnv(params.env, 'HTTPS_PROXY', 'https_proxy'),
  allProxy: readString(params.config?.allProxy) ?? readEnv(params.env, 'ALL_PROXY', 'all_proxy'),
  noProxy: mergeNoProxy(
    normalizeNoProxy(params.config?.noProxy) ?? readEnv(params.env, 'NO_PROXY', 'no_proxy'),
    '127.0.0.1,localhost,::1'
  ),
  caCertificate: readString(params.config?.caCertificate) ??
    readEnv(params.env, 'CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE')
})

const setEnvPair = (
  env: NodeJS.ProcessEnv,
  upperKey: string,
  lowerKey: string,
  value: string | undefined
) => {
  if (value == null) return
  env[upperKey] = value
  env[lowerKey] = value
}

export const applyCodexNetworkEnv = (
  env: NodeJS.ProcessEnv,
  config: CodexNetworkConfig
) => {
  setEnvPair(env, 'HTTP_PROXY', 'http_proxy', config.httpProxy)
  setEnvPair(env, 'HTTPS_PROXY', 'https_proxy', config.httpsProxy)
  setEnvPair(env, 'ALL_PROXY', 'all_proxy', config.allProxy)
  setEnvPair(env, 'NO_PROXY', 'no_proxy', config.noProxy)
  if (config.caCertificate != null) {
    env.CODEX_CA_CERTIFICATE = config.caCertificate
    env.SSL_CERT_FILE = config.caCertificate
  }
  return env
}

export const materializeCodexCaCertificate = async (
  config: CodexNetworkConfig,
  homeDir: string
): Promise<CodexNetworkConfig> => {
  const certificate = config.caCertificate
  if (certificate == null || !certificate.includes('-----BEGIN CERTIFICATE-----')) return config

  const certificateDir = resolve(homeDir, '.codex', 'certificates')
  const certificatePath = resolve(
    certificateDir,
    `${createHash('sha256').update(certificate).digest('hex')}.pem`
  )
  await mkdir(certificateDir, { recursive: true })
  await writeFile(certificatePath, certificate, { encoding: 'utf8', mode: 0o600 })
  await chmod(certificatePath, 0o600)
  return { ...config, caCertificate: certificatePath }
}
