import type { RelayLoginMessages } from './login-page-i18n.js'
import type { RelayLoginProvider } from './login-page-types.js'

export interface RelayLoginClientAssets {
  faviconDarkHref?: string
  faviconLightHref?: string
  scriptSrc?: string
  styleHref?: string
}

interface BuildLoginClientConfigInput {
  providers: RelayLoginProvider[]
  redirectUri: string
  startUrlForProvider: (providerId: string) => string
  t: RelayLoginMessages
}

const isGoogleProvider = (provider: RelayLoginProvider) => (
  [provider.id, provider.displayName]
    .some(value => typeof value === 'string' && value.toLowerCase().includes('google'))
)

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
    recentAccounts: input.t.recentAccounts,
    rememberAccount: input.t.rememberAccount,
    registerWithInvite: input.t.registerWithInvite,
    signInMode: input.t.signInMode,
    signInWithInvite: input.t.signInWithInvite,
    signInWithPassword: input.t.signInWithPassword,
    signInWithSso: input.t.signInWithSso,
    signingIn: input.t.signingIn
  },
  inviteLoginUrl: '/api/auth/invite-login',
  locale: input.t.htmlLang,
  passwordLoginUrl: '/api/auth/password-login',
  providers: input.providers.map(provider => ({
    displayName: provider.displayName,
    icon: isGoogleProvider(provider) ? 'google' : 'login',
    id: provider.id,
    label: input.t.continueWith(provider.displayName ?? provider.id),
    startUrl: input.startUrlForProvider(provider.id)
  })),
  redirectUri: input.redirectUri
})
