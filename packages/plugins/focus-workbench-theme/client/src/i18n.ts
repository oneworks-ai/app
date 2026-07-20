export interface FocusWorkbenchLocalizedText {
  en: string
  'zh-Hans': string
}

export const zh = (value: { en: string; zh: string }): FocusWorkbenchLocalizedText => ({
  en: value.en,
  'zh-Hans': value.zh
})
