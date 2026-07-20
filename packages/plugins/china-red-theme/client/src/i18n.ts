export interface ChinaRedLocalizedText {
  en: string
  'zh-Hans': string
}

export const zh = (value: { en: string; zh: string }): ChinaRedLocalizedText => ({
  en: value.en,
  'zh-Hans': value.zh
})
