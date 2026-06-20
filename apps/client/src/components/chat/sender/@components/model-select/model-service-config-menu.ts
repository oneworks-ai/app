import type { ModelSelectMenuGroup } from '#~/hooks/chat/use-chat-model-adapter-selection'

const OPEN_MODEL_SERVICE_CONFIG_MENU_KEY_PREFIX = 'model-services:open-service-config:'

export const buildOpenModelServiceConfigMenuKey = (serviceKey: string) =>
  `${OPEN_MODEL_SERVICE_CONFIG_MENU_KEY_PREFIX}${encodeURIComponent(serviceKey)}`

export const parseOpenModelServiceConfigMenuKey = (key: string) => {
  if (!key.startsWith(OPEN_MODEL_SERVICE_CONFIG_MENU_KEY_PREFIX)) return undefined

  const rawServiceKey = key.slice(OPEN_MODEL_SERVICE_CONFIG_MENU_KEY_PREFIX.length)
  if (rawServiceKey === '') return undefined

  try {
    return decodeURIComponent(rawServiceKey).trim() || undefined
  } catch {
    return undefined
  }
}

export const resolveModelServiceKeyFromMenuGroup = (group: ModelSelectMenuGroup) => {
  if (!group.key.startsWith('service:')) return undefined

  const optionServiceKey = group.options.find(option => option.serviceKey != null)?.serviceKey?.trim()
  if (optionServiceKey != null && optionServiceKey !== '') return optionServiceKey

  return group.key.slice('service:'.length).trim() || undefined
}
