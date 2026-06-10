import type { MessageBoxOptions } from 'electron'

export const QUIT_CONFIRMATION_RESPONSE = {
  cancel: 0,
  quit: 1
} as const

const quitConfirmationMessages = {
  en: {
    cancelButton: 'Cancel',
    detail: 'All One Works windows will close and local project services will stop.',
    menuLabel: (appName: string) => `Quit ${appName}`,
    quitButton: 'Quit',
    title: 'Confirm Quit',
    message: (appName: string) => `Quit ${appName}?`
  },
  zh: {
    cancelButton: '取消',
    detail: '所有 One Works 窗口都会关闭，本地项目服务也会停止。',
    menuLabel: (appName: string) => `退出 ${appName}`,
    quitButton: '退出',
    title: '确认退出',
    message: (appName: string) => `要退出 ${appName} 吗？`
  }
} as const

export type QuitConfirmationLanguage = keyof typeof quitConfirmationMessages

const fallbackQuitConfirmationLanguage: QuitConfirmationLanguage = 'zh'

export const resolveQuitConfirmationAppName = (value: unknown) => {
  if (typeof value !== 'string') return 'One Works'
  const name = value.trim()
  if (name === '' || name === 'Electron' || name.startsWith('@')) return 'One Works'
  return name
}

const normalizeLanguageCode = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const language = value.trim().replaceAll('_', '-').toLowerCase()
  return language === '' ? undefined : language
}

const resolveQuitConfirmationLanguageFromCode = (value: unknown): QuitConfirmationLanguage | undefined => {
  const language = normalizeLanguageCode(value)
  if (language == null) return undefined
  if (language.startsWith('zh')) return 'zh'
  if (language.startsWith('en')) return 'en'
  return undefined
}

export const resolveQuitConfirmationSystemLocale = (params: {
  appLocale?: unknown
  preferredSystemLanguages?: readonly unknown[]
}) => (
  params.preferredSystemLanguages?.find(value => normalizeLanguageCode(value) != null) ??
    params.appLocale
)

export const resolveQuitConfirmationLanguage = (params: {
  appLocale?: unknown
  configuredLanguage?: unknown
  systemLocale?: unknown
}): QuitConfirmationLanguage => (
  resolveQuitConfirmationLanguageFromCode(params.configuredLanguage) ??
    resolveQuitConfirmationLanguageFromCode(params.systemLocale) ??
    resolveQuitConfirmationLanguageFromCode(params.appLocale) ??
    fallbackQuitConfirmationLanguage
)

export const buildQuitConfirmationMenuLabel = (params: {
  appName: string
  includeAppName: boolean
  language: QuitConfirmationLanguage
}) => {
  const messages = quitConfirmationMessages[params.language]
  return params.includeAppName ? messages.menuLabel(params.appName) : messages.quitButton
}

export const buildQuitConfirmationMessageBoxOptions = (params: {
  appName: string
  language: QuitConfirmationLanguage
}): MessageBoxOptions => {
  const messages = quitConfirmationMessages[params.language]
  return {
    buttons: [messages.cancelButton, messages.quitButton],
    cancelId: QUIT_CONFIRMATION_RESPONSE.cancel,
    defaultId: QUIT_CONFIRMATION_RESPONSE.quit,
    detail: messages.detail,
    message: messages.message(params.appName),
    noLink: true,
    title: messages.title,
    type: 'question'
  }
}
