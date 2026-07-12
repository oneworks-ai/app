import type {
  RelayLoginMethod,
  RelayLoginOptions,
  RelayLoginOptionsMessages,
  RelayLoginProviderOption
} from './types.js'

const loginMethods = new Set<RelayLoginMethod>(['passkey', 'password', 'verification_code'])
const messageKeys: Array<keyof RelayLoginOptionsMessages> = [
  'confirmPasswordPlaceholder',
  'confirmPasswordRequired',
  'continueWithRegistration',
  'emailPlaceholder',
  'invalidCredentials',
  'inviteCodePlaceholder',
  'inviteRequired',
  'passkeyCodePlaceholder',
  'passkeySendCode',
  'passkeyTitle',
  'passwordMinLength',
  'passwordMismatch',
  'passwordPlaceholder',
  'recentAccounts',
  'rememberAccount',
  'signInMode',
  'signInWithPassword',
  'signInWithSso',
  'signingIn',
  'useLoginMethodPasskey',
  'useLoginMethodPassword',
  'useLoginMethodVerificationCode',
  'verificationCodeSignIn'
]

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const requiredString = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? undefined : text
}

const sameOriginEndpoint = (value: unknown, remoteBaseUrl: string) => {
  const text = requiredString(value)
  if (text == null) return undefined
  try {
    const base = new URL(remoteBaseUrl)
    const url = new URL(text, base)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === base.origin
      ? text
      : undefined
  } catch {
    return undefined
  }
}

const providerOption = (
  value: unknown,
  allowedOrigins: Set<string>
): RelayLoginProviderOption | undefined => {
  if (!isRecord(value)) return undefined
  const id = requiredString(value.id)
  const label = requiredString(value.label)
  const startUrl = requiredString(value.startUrl)
  if (id == null || label == null || startUrl == null) return undefined
  try {
    const url = new URL(startUrl)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !allowedOrigins.has(url.origin)
    ) return undefined
  } catch {
    return undefined
  }
  return {
    displayName: requiredString(value.displayName),
    icon: requiredString(value.icon),
    id,
    label,
    startUrl
  }
}

const loginMessages = (value: unknown): RelayLoginOptionsMessages | undefined => {
  if (!isRecord(value)) return undefined
  const messages = Object.fromEntries(messageKeys.map(key => [key, requiredString(value[key])]))
  if (Object.values(messages).some(message => message == null)) return undefined
  return messages as unknown as RelayLoginOptionsMessages
}

export const parseRelayLoginOptions = (
  value: unknown,
  input: {
    expectedRedirectUri: string
    loginUrl: string
    remoteBaseUrl: string
  }
): RelayLoginOptions | undefined => {
  if (!isRecord(value) || !isRecord(value.loginMethods)) return undefined
  const enabledValues = value.loginMethods.enabled
  if (!Array.isArray(enabledValues)) return undefined
  const enabled = enabledValues.filter((method): method is RelayLoginMethod => (
    typeof method === 'string' && loginMethods.has(method as RelayLoginMethod)
  ))
  const defaultMethod = requiredString(value.loginMethods.default) as RelayLoginMethod | undefined
  if (
    enabled.length === 0 ||
    enabled.length !== enabledValues.length ||
    new Set(enabled).size !== enabled.length ||
    defaultMethod == null ||
    !enabled.includes(defaultMethod)
  ) return undefined

  const messages = loginMessages(value.messages)
  const passwordLoginUrl = sameOriginEndpoint(value.passwordLoginUrl, input.remoteBaseUrl)
  const emailCodeLoginUrl = sameOriginEndpoint(value.emailCodeLoginUrl, input.remoteBaseUrl)
  const emailVerificationSendUrl = sameOriginEndpoint(value.emailVerificationSendUrl, input.remoteBaseUrl)
  const inviteLoginUrl = sameOriginEndpoint(value.inviteLoginUrl, input.remoteBaseUrl)
  const redirectUri = requiredString(value.redirectUri)
  if (
    messages == null ||
    passwordLoginUrl == null ||
    emailCodeLoginUrl == null ||
    emailVerificationSendUrl == null ||
    inviteLoginUrl == null ||
    redirectUri !== input.expectedRedirectUri ||
    (value.locale !== 'en' && value.locale !== 'zh-CN') ||
    !Array.isArray(value.providers)
  ) return undefined

  const allowedOrigins = new Set<string>()
  try {
    allowedOrigins.add(new URL(input.remoteBaseUrl).origin)
    allowedOrigins.add(new URL(input.loginUrl).origin)
  } catch {
    return undefined
  }
  const providers = value.providers.map(provider => providerOption(provider, allowedOrigins))
  if (providers.some(provider => provider == null)) return undefined
  return {
    emailCodeLoginUrl,
    emailVerificationSendUrl,
    inviteLoginUrl,
    locale: value.locale,
    loginMethods: { default: defaultMethod, enabled },
    messages,
    passwordLoginUrl,
    providers: providers as RelayLoginProviderOption[],
    redirectUri
  }
}
