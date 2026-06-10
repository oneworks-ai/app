export interface RelayLoginMessages {
  confirmPasswordPlaceholder: string
  confirmPasswordRequired: string
  continueWithInvite: string
  continueWithPassword: string
  continueWithRegistration: string
  emailPlaceholder: string
  emailRequired: string
  invalidCredentials: string
  inviteCodePlaceholder: string
  inviteRequired: string
  passwordMinLength: string
  passwordMismatch: string
  passwordPlaceholder: string
  passwordRequired: string
  recentAccounts: string
  rememberAccount: string
  registerWithInvite: string
  signInMode: string
  signInWithInvite: string
  signInWithPassword: string
  signInWithSso: string
  signingIn: string
}

export interface RelayLoginProviderConfig {
  displayName?: string
  icon: 'google' | 'login'
  id: string
  label: string
  startUrl: string
}

export interface RelayLoginConfig {
  inviteLoginUrl: string
  messages: RelayLoginMessages
  passwordLoginUrl: string
  providers: RelayLoginProviderConfig[]
  redirectUri: string
}

export interface RelayRememberedAccount {
  avatarUrl: string
  email: string
  name: string
  provider: string
  updatedAt: string
}
