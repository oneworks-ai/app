import 'dayjs/locale/zh-cn'

import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export function getSidebarDayjsLocale(language?: string) {
  return language?.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en'
}

export function formatSidebarTimeDisplay(value: string | number | Date, language?: string) {
  const date = dayjs(value).locale(getSidebarDayjsLocale(language))
  return {
    relative: date.fromNow(),
    full: date.format('YYYY-MM-DD HH:mm:ss')
  }
}
