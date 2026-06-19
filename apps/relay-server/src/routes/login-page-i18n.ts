import type { IncomingMessage } from 'node:http'

import type { RelayLocale } from '../types.js'

export type RelayLoginLocale = RelayLocale

export interface RelayLoginMessages {
  brandName: string
  confirmPasswordPlaceholder: string
  confirmPasswordRequired: string
  continueWithInvite: string
  continueWithPassword: string
  continueWithRegistration: string
  continueWith: (providerName: string) => string
  documentTitle: string
  emailPlaceholder: string
  emailRequired: string
  finishingSubtitle: string
  finishingTitle: string
  htmlLang: string
  inviteRequired: string
  inviteCodePlaceholder: string
  invalidRedirect: string
  invalidTitle: string
  invalidCredentials: string
  loginFailedTitle: string
  noAccounts: string
  noProviders: string
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
  tokenMissing: string
  useLoginMethodPasskey: string
  useLoginMethodPassword: string
  useLoginMethodVerificationCode: string
  verificationCodeSignIn: string
}

const defaultLocale: RelayLoginLocale = 'zh-CN'

const messages: Record<RelayLoginLocale, RelayLoginMessages> = {
  en: {
    brandName: 'One Works',
    confirmPasswordPlaceholder: 'Confirm password',
    confirmPasswordRequired: 'Please confirm your password.',
    continueWithInvite: 'Sign in',
    continueWithPassword: 'Sign in',
    continueWithRegistration: 'Create account',
    continueWith: providerName => `Sign in with ${providerName}`,
    documentTitle: 'One Works',
    emailPlaceholder: 'Email or account name',
    emailRequired: 'Email or account name is required.',
    finishingSubtitle: 'Returning to OneWorks...',
    finishingTitle: 'Finishing login',
    htmlLang: 'en',
    inviteRequired: 'An invite is required to sign in with a new account.',
    inviteCodePlaceholder: 'Invite code',
    invalidRedirect: 'The redirect_uri must use http, https, oneworks, or one-works.',
    invalidTitle: 'Login link is invalid',
    invalidCredentials: 'Invalid email or password.',
    loginFailedTitle: 'Login failed',
    noAccounts: 'No remembered accounts in this browser yet.',
    noProviders: 'No SSO providers are configured.',
    passwordMinLength: 'Password must be at least 8 characters.',
    passwordMismatch: 'The passwords do not match.',
    passwordPlaceholder: 'Password',
    passwordRequired: 'Password is required.',
    passkeyCodePlaceholder: 'Verification code',
    passkeySendCode: 'Send code',
    passkeyTitle: 'Sign in or register',
    recentAccounts: 'Recent accounts',
    rememberAccount: 'Remember account',
    registerWithInvite: 'Create account',
    signInWithCode: 'Sign in with code',
    signInMode: 'Sign in',
    signInWithInvite: 'Sign in',
    signInWithPassword: 'Sign in',
    signInWithSso: 'Sign in with SSO',
    signingIn: 'Signing in...',
    switchLoginMethod: 'Other sign-in methods',
    tokenMissing: 'Login token was not returned by the relay server.',
    useLoginMethodPasskey: 'Use PASS KEY',
    useLoginMethodPassword: 'Use password',
    useLoginMethodVerificationCode: 'Use verification code',
    verificationCodeSignIn: 'Sign in with verification code'
  },
  'zh-CN': {
    brandName: 'One Works',
    confirmPasswordPlaceholder: '确认密码',
    confirmPasswordRequired: '请再次输入密码。',
    continueWithInvite: '登陆',
    continueWithPassword: '登陆',
    continueWithRegistration: '注册',
    continueWith: providerName => `使用 ${providerName} 登陆`,
    documentTitle: 'One Works',
    emailPlaceholder: '邮箱或账号名',
    emailRequired: '请输入邮箱或账号名。',
    finishingSubtitle: '正在返回 OneWorks...',
    finishingTitle: '正在完成登录',
    htmlLang: 'zh-CN',
    inviteRequired: '新账号登陆需要邀请码。',
    inviteCodePlaceholder: '邀请码',
    invalidRedirect: 'redirect_uri 必须使用 http、https、oneworks 或 one-works。',
    invalidTitle: '登录链接无效',
    invalidCredentials: '邮箱或密码不正确。',
    loginFailedTitle: '登录失败',
    noAccounts: '这个浏览器还没有记住任何账号。',
    noProviders: '还没有配置可用的 SSO 提供方。',
    passwordMinLength: '密码至少需要 8 个字符。',
    passwordMismatch: '两次输入的密码不一致。',
    passwordPlaceholder: '密码',
    passwordRequired: '请输入密码。',
    passkeyCodePlaceholder: '验证码',
    passkeySendCode: '发送验证码',
    passkeyTitle: '登陆或注册',
    recentAccounts: '最近账号',
    rememberAccount: '记住账号',
    registerWithInvite: '注册',
    signInWithCode: '使用验证码登陆',
    signInMode: '登陆',
    signInWithInvite: '登陆',
    signInWithPassword: '登陆',
    signInWithSso: '使用 SSO 登陆',
    signingIn: '登陆中...',
    switchLoginMethod: '其他登陆方式',
    tokenMissing: '转发服务没有返回登录令牌。',
    useLoginMethodPasskey: '使用 PASS KEY',
    useLoginMethodPassword: '使用密码',
    useLoginMethodVerificationCode: '使用验证码',
    verificationCodeSignIn: '使用验证码登陆'
  }
}

export const normalizeRelayLoginLocale = (value: string | null | undefined): RelayLoginLocale | undefined => {
  const normalized = value?.trim().toLowerCase().replaceAll('_', '-')
  if (!normalized) return undefined
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  return undefined
}

export const parseAcceptLanguage = (value: string | string[] | undefined): string[] => {
  const header = Array.isArray(value) ? value.join(',') : value
  if (!header) return []
  return header
    .split(',')
    .map(part => part.trim().split(';', 1)[0]?.trim() ?? '')
    .filter(Boolean)
}

export const resolveRelayLoginLocale = (req: IncomingMessage, url: URL): RelayLoginLocale => {
  const queryLocale = normalizeRelayLoginLocale(url.searchParams.get('lang'))
  if (queryLocale != null) return queryLocale

  for (const language of parseAcceptLanguage(req.headers['accept-language'])) {
    const locale = normalizeRelayLoginLocale(language)
    if (locale != null) return locale
  }

  return defaultLocale
}

export const getRelayLoginMessages = (locale: RelayLoginLocale) => messages[locale] ?? messages[defaultLocale]
