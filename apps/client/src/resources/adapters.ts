import {
  adapterDisplayName as claudeCodeDisplayName,
  adapterIcon as claudeCodeIcon
} from '@oneworks/adapter-claude-code/icon'
import {
  adapterDisplayName as codexDisplayName,
  adapterIcon as codexIcon,
  adapterIconDark as codexIconDark
} from '@oneworks/adapter-codex/icon'
import { adapterDisplayName as copilotDisplayName, adapterIcon as copilotIcon } from '@oneworks/adapter-copilot/icon'
import { adapterDisplayName as geminiDisplayName, adapterIcon as geminiIcon } from '@oneworks/adapter-gemini/icon'
import { adapterDisplayName as kimiDisplayName, adapterIcon as kimiIcon } from '@oneworks/adapter-kimi/icon'
import { adapterDisplayName as opencodeDisplayName, adapterIcon as opencodeIcon } from '@oneworks/adapter-opencode/icon'

export interface AdapterDisplay {
  darkIcon?: string
  icon?: string
  title: string
}

export const adapterDisplayMap = {
  'claude-code': {
    title: claudeCodeDisplayName,
    icon: claudeCodeIcon
  },
  codex: {
    title: codexDisplayName,
    icon: codexIcon,
    darkIcon: codexIconDark
  },
  copilot: {
    title: copilotDisplayName,
    icon: copilotIcon
  },
  gemini: {
    title: geminiDisplayName,
    icon: geminiIcon
  },
  kimi: {
    title: kimiDisplayName,
    icon: kimiIcon
  },
  opencode: {
    title: opencodeDisplayName,
    icon: opencodeIcon
  }
} as const satisfies Record<string, AdapterDisplay>

export const builtInAdapterKeys = Object.keys(adapterDisplayMap)

export const getAdapterDisplay = (adapterKey: string): AdapterDisplay => {
  return adapterDisplayMap[adapterKey as keyof typeof adapterDisplayMap] ?? {
    title: adapterKey,
    icon: undefined
  }
}

export const resolveAdapterDisplayIcon = (
  display: AdapterDisplay,
  resolvedThemeMode: 'dark' | 'light'
) =>
  resolvedThemeMode === 'dark'
    ? display.darkIcon ?? display.icon
    : display.icon
