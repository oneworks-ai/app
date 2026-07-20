export interface NeoWorkshopLocalizedText {
  en: string
  'zh-Hans': string
}

export const zh = (value: { en: string; zh: string }): NeoWorkshopLocalizedText => ({
  en: value.en,
  'zh-Hans': value.zh
})
