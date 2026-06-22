import type { RelayLoginMethod, RelayPasskeyConfig } from '../types.js'
import type { RelayLoginMessages } from './login-page-i18n.js'
import type { RelayLoginProvider } from './login-page-types.js'

export interface RelayLoginClientAssets {
  faviconDarkHref?: string
  faviconLightHref?: string
  scriptSrc?: string
  styleHref?: string
}

interface BuildLoginClientConfigInput {
  defaultLoginMethod?: RelayLoginMethod
  emailCodeLoginEnabled?: boolean
  providers: RelayLoginProvider[]
  passkey?: RelayPasskeyConfig
  redirectUri: string
  startUrlForProvider: (providerId: string) => string
  t: RelayLoginMessages
}

const isGoogleProvider = (provider: RelayLoginProvider) => (
  [provider.id, provider.displayName]
    .some(value => typeof value === 'string' && value.toLowerCase().includes('google'))
)

const isGithubProvider = (provider: RelayLoginProvider) => (
  [provider.id, provider.displayName]
    .some(value => typeof value === 'string' && value.toLowerCase().includes('github'))
)

const isFeishuProvider = (provider: RelayLoginProvider) => (
  [provider.id, provider.displayName]
    .some(value => typeof value === 'string' && value.toLowerCase().includes('feishu')) ||
  [provider.id, provider.displayName]
    .some(value => typeof value === 'string' && value.includes('飞书'))
)

const providerIcon = (provider: RelayLoginProvider) => {
  if (isGithubProvider(provider)) return 'github'
  if (isFeishuProvider(provider)) return 'feishu'
  if (isGoogleProvider(provider)) return 'google'
  return 'login'
}

const loginMethods = (input: BuildLoginClientConfigInput) => {
  const enabled: RelayLoginMethod[] = ['password']
  if (input.passkey?.enabled !== false) enabled.push('passkey')
  if (input.emailCodeLoginEnabled === true) enabled.push('verification_code')
  return {
    default: input.defaultLoginMethod != null && enabled.includes(input.defaultLoginMethod)
      ? input.defaultLoginMethod
      : enabled[0] ?? 'password',
    enabled
  }
}

export const buildLoginClientConfig = (input: BuildLoginClientConfigInput) => ({
  messages: {
    confirmPasswordPlaceholder: input.t.confirmPasswordPlaceholder,
    confirmPasswordRequired: input.t.confirmPasswordRequired,
    continueWithInvite: input.t.continueWithInvite,
    continueWithPassword: input.t.continueWithPassword,
    continueWithRegistration: input.t.continueWithRegistration,
    emailPlaceholder: input.t.emailPlaceholder,
    emailRequired: input.t.emailRequired,
    invalidCredentials: input.t.invalidCredentials,
    inviteCodePlaceholder: input.t.inviteCodePlaceholder,
    inviteRequired: input.t.inviteRequired,
    passwordMinLength: input.t.passwordMinLength,
    passwordMismatch: input.t.passwordMismatch,
    passwordPlaceholder: input.t.passwordPlaceholder,
    passwordRequired: input.t.passwordRequired,
    passkeyCodePlaceholder: input.t.passkeyCodePlaceholder,
    passkeySendCode: input.t.passkeySendCode,
    passkeyTitle: input.t.passkeyTitle,
    recentAccounts: input.t.recentAccounts,
    rememberAccount: input.t.rememberAccount,
    registerWithInvite: input.t.registerWithInvite,
    signInWithCode: input.t.signInWithCode,
    signInMode: input.t.signInMode,
    signInWithInvite: input.t.signInWithInvite,
    signInWithPassword: input.t.signInWithPassword,
    signInWithSso: input.t.signInWithSso,
    signingIn: input.t.signingIn,
    switchLoginMethod: input.t.switchLoginMethod,
    useLoginMethodPasskey: input.t.useLoginMethodPasskey,
    useLoginMethodPassword: input.t.useLoginMethodPassword,
    useLoginMethodVerificationCode: input.t.useLoginMethodVerificationCode,
    verificationCodeSignIn: input.t.verificationCodeSignIn
  },
  emailCodeLoginUrl: '/api/auth/email-code-login',
  emailVerificationSendUrl: '/api/auth/email-verification/send',
  inviteLoginUrl: '/api/auth/invite-login',
  locale: input.t.htmlLang,
  loginMethods: loginMethods(input),
  passwordLoginUrl: '/api/auth/password-login',
  passkey: {
    emailVerificationRequired: input.passkey?.emailVerificationRequired !== false,
    enabled: input.passkey?.enabled !== false,
    loginOptionsUrl: '/api/auth/passkey/login/options',
    loginVerifyUrl: '/api/auth/passkey/login/verify',
    registrationMode: input.passkey?.registrationMode ?? 'invite_required',
    registerOptionsUrl: '/api/auth/passkey/register/options',
    registerVerifyUrl: '/api/auth/passkey/register/verify'
  },
  providers: input.providers.map(provider => ({
    displayName: provider.displayName,
    icon: providerIcon(provider),
    id: provider.id,
    label: input.t.continueWith(provider.displayName ?? provider.id),
    startUrl: input.startUrlForProvider(provider.id)
  })),
  redirectUri: input.redirectUri
})
