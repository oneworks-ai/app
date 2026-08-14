const CREDENTIAL_KEY_PATTERN =
  /(?:^|_)(?:api_?key|access_?key|account_?key|secret(?:_access)?_?key|client_?secret|password|passwd|token|credential|authorization|private_?key)(?:_|$)/iu

const ALWAYS_SENSITIVE_ENV_KEYS = new Set([
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'SSH_AUTH_SOCK'
])

const SENSITIVE_ENV_PREFIXES = [
  'ANTHROPIC_',
  'AWS_',
  'AZURE_',
  'CLINE_API_KEY',
  'GCE_',
  'GCLOUD_',
  'GCP_',
  'GEMINI_',
  'GH_',
  'GITHUB_',
  'GIT_',
  'GOOGLE_',
  'ONEWORKS_',
  'OPENAI_',
  '__ONEWORKS_'
]

const SIMPLE_PROVIDER_KEYS: Record<string, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  cline: ['CLINE_API_KEY'],
  'cline-pass': ['CLINE_API_KEY'],
  gemini: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY']
}

const NATIVE_PROVIDER_KEYS: Record<string, readonly string[]> = {
  bedrock: [
    'AWS_ACCESS_KEY_ID',
    'AWS_BEARER_TOKEN_BEDROCK',
    'AWS_CONFIG_FILE',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_DEFAULT_REGION',
    'AWS_PROFILE',
    'AWS_REGION',
    'AWS_ROLE_ARN',
    'AWS_ROLE_SESSION_NAME',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_WEB_IDENTITY_TOKEN_FILE'
  ],
  vertex: [
    'GCLOUD_PROJECT',
    'GCP_PROJECT_ID',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_QUOTA_PROJECT',
    'GOOGLE_VERTEX_LOCATION',
    'GOOGLE_VERTEX_PROJECT'
  ]
}

const normalizeEnvKey = (key: string) => (
  key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').replace(/-/gu, '_').toUpperCase()
)

export const isClineSensitiveEnvKey = (key: string) => {
  const normalized = normalizeEnvKey(key)
  return ALWAYS_SENSITIVE_ENV_KEYS.has(normalized) ||
    SENSITIVE_ENV_PREFIXES.some(prefix => normalized.startsWith(prefix)) ||
    CREDENTIAL_KEY_PATTERN.test(normalized)
}

export const omitClineSensitiveEnv = (
  env: Record<string, string | null | undefined>
): Record<string, string | null | undefined> =>
  Object.fromEntries(
    Object.entries(env).filter(([key]) => !isClineSensitiveEnvKey(key))
  )

export interface ClineSelectedCredentialEnv {
  childEnv: Record<string, string>
  mode: 'cline-api-key' | 'native-provider' | 'none'
  selectedSourceKeys: string[]
}

export const resolveClineSelectedCredentialEnv = (params: {
  credentialEnv?: string[]
  env: Record<string, string | null | undefined>
  provider?: string
}): ClineSelectedCredentialEnv => {
  const selectedKeys = [...new Set(params.credentialEnv ?? [])]
  if (selectedKeys.length === 0) return { childEnv: {}, mode: 'none', selectedSourceKeys: [] }

  const provider = params.provider?.trim().toLowerCase()
  if (provider == null || provider === '') {
    throw new Error('Cline credentialEnv requires an explicit native provider selection.')
  }
  const simpleKeys = SIMPLE_PROVIDER_KEYS[provider]
  const nativeKeys = NATIVE_PROVIDER_KEYS[provider]
  const allowedKeys = new Set(simpleKeys ?? nativeKeys ?? [])
  if (allowedKeys.size === 0) {
    throw new Error(`Cline provider "${params.provider}" has no verified process-only credential environment mapping.`)
  }

  const childEnv: Record<string, string> = {}
  for (const sourceKey of selectedKeys) {
    if (!allowedKeys.has(sourceKey)) {
      throw new Error(`Cline provider "${params.provider}" does not allow selected credential env "${sourceKey}".`)
    }
    const value = params.env[sourceKey]
    if (typeof value !== 'string' || value === '' || value.includes('\0')) {
      throw new Error(`Cline selected credential env "${sourceKey}" is unavailable.`)
    }
    if (simpleKeys != null) {
      if (selectedKeys.length !== 1) {
        throw new Error(
          `Cline provider "${params.provider}" accepts exactly one selected API-key environment variable.`
        )
      }
      childEnv.CLINE_API_KEY = value
    } else {
      childEnv[sourceKey] = value
    }
  }

  return {
    childEnv,
    mode: simpleKeys == null ? 'native-provider' : 'cline-api-key',
    selectedSourceKeys: selectedKeys
  }
}

export const getVerifiedClineCredentialEnvKeys = (provider: string) => [
  ...(SIMPLE_PROVIDER_KEYS[provider.trim().toLowerCase()] ?? []),
  ...(NATIVE_PROVIDER_KEYS[provider.trim().toLowerCase()] ?? [])
]
