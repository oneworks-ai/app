import type { RelayEmailPurpose, RelayLocale } from '../types.js'

export interface RelayEmailPurposeContent {
  headline: string
  intro: string
  preheader: string
  subject: string
}

export interface RelayEmailTemplateContent {
  brandName: string
  codeLabel: string
  docsLabel: string
  expiresIn: (minutes: string) => string
  footerDescription: string
  footerLinksLabel: string
  htmlLang: string
  ignoreNotice: string
  purposes: Record<RelayEmailPurpose, RelayEmailPurposeContent>
  securityNotice: string
  sentBy: string
  supportLabel: string
  websiteLabel: string
}

export const relayEmailFooterLinks = {
  docs: 'https://oneworks.cloud/docs/',
  support: 'mailto:support@oneworks.cloud',
  website: 'https://oneworks.cloud/'
}

export const relayEmailContent: Record<RelayLocale, RelayEmailTemplateContent> = {
  en: {
    brandName: 'One Works',
    codeLabel: 'Verification code',
    docsLabel: 'Docs',
    expiresIn: minutes => `This code expires in ${minutes}.`,
    footerDescription: 'One Works helps teams connect AI workspaces, devices, and automation.',
    footerLinksLabel: 'Official links',
    htmlLang: 'en',
    ignoreNotice: 'If you did not request this email, you can safely ignore it.',
    purposes: {
      'email-verification': {
        headline: 'Verify your email address',
        intro: 'Enter this verification code to finish setting up your One Works account.',
        preheader: 'Use this code to verify your One Works email address.',
        subject: 'One Works verification code'
      },
      invite: {
        headline: 'Confirm your One Works invite',
        intro: 'Enter this code to continue accepting your One Works invite.',
        preheader: 'Use this code to continue with your One Works invite.',
        subject: 'One Works invite code'
      },
      login: {
        headline: 'Sign in to One Works',
        intro: 'Enter this sign-in code to continue to your One Works workspace.',
        preheader: 'Use this code to sign in to One Works.',
        subject: 'One Works sign-in code'
      }
    },
    securityNotice: 'Never share this code with anyone. One Works staff will never ask for it.',
    sentBy: 'Sent by One Works',
    supportLabel: 'Support',
    websiteLabel: 'Website'
  },
  'zh-CN': {
    brandName: 'One Works',
    codeLabel: '验证码',
    docsLabel: '文档',
    expiresIn: minutes => `验证码将在 ${minutes}后过期。`,
    footerDescription: 'One Works 帮助团队连接 AI 工作区、设备和自动化流程。',
    footerLinksLabel: '官方链接',
    htmlLang: 'zh-CN',
    ignoreNotice: '如果不是你本人操作，可以安全忽略这封邮件。',
    purposes: {
      'email-verification': {
        headline: '验证你的邮箱',
        intro: '请输入下面的验证码，完成 One Works 账号邮箱验证。',
        preheader: '使用此验证码验证你的 One Works 邮箱。',
        subject: 'One Works 邮箱验证码'
      },
      invite: {
        headline: '确认 One Works 邀请',
        intro: '请输入下面的验证码，继续接受 One Works 邀请。',
        preheader: '使用此验证码继续接受 One Works 邀请。',
        subject: 'One Works 邀请验证码'
      },
      login: {
        headline: '登录 One Works',
        intro: '请输入下面的登录验证码，继续访问你的 One Works 工作区。',
        preheader: '使用此验证码登录 One Works。',
        subject: 'One Works 登录验证码'
      }
    },
    securityNotice: '不要把验证码分享给任何人。One Works 工作人员不会向你索要验证码。',
    sentBy: '由 One Works 发送',
    supportLabel: '支持',
    websiteLabel: '官网'
  }
}
