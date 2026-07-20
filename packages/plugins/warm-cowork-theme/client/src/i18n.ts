export interface WarmCoworkLocalizedText {
  en: string
  'zh-Hans': string
}

export const zh = (value: { en: string; zh: string }): WarmCoworkLocalizedText => ({
  en: value.en,
  'zh-Hans': value.zh
})
