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
  passkeyCodePlaceholder: string
  passkeySendCode: string
  passkeyTitle: string
  recentAccounts: string
  rememberAccount: string
  registerWithInvite: string
  signInWithCode: string
  signInMode: string
  signInWithInvite: string
  signInWithPassword: string
  signInWithSso: string
  signingIn: string
  switchLoginMethod: string
  useLoginMethodPasskey: string
  useLoginMethodPassword: string
  useLoginMethodVerificationCode: string
  verificationCodeSignIn: string
}

export type RelayLoginMethod = 'passkey' | 'password' | 'verification_code'

export interface RelayLoginMethodsConfig {
  default: RelayLoginMethod
  enabled: RelayLoginMethod[]
}

export interface RelayLoginPasskeyConfig {
  emailVerificationRequired: boolean
  enabled: boolean
  loginOptionsUrl: string
  loginVerifyUrl: string
  registrationMode: 'admin_created_only' | 'email_verified' | 'invite_required'
  registerOptionsUrl: string
  registerVerifyUrl: string
}

export interface RelayLoginProviderConfig {
  displayName?: string
  icon: 'feishu' | 'github' | 'google' | 'login'
  id: string
  label: string
  startUrl: string
}

export interface RelayLoginConfig {
  emailCodeLoginUrl: string
  emailVerificationSendUrl: string
  inviteLoginUrl: string
  locale: 'en' | 'zh-CN'
  loginMethods: RelayLoginMethodsConfig
  messages: RelayLoginMessages
  passwordLoginUrl: string
  passkey: RelayLoginPasskeyConfig
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
