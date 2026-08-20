import {
  adapterDisplayName as claudeCodeDisplayName,
  adapterIcon as claudeCodeIcon
} from '@oneworks/adapter-claude-code/icon'
import {
  adapterDisplayName as clineDisplayName,
  adapterIcon as clineIcon,
  adapterIconDark as clineIconDark
} from '@oneworks/adapter-cline/icon'
import {
  adapterDisplayName as codexDisplayName,
  adapterIcon as codexIcon,
  adapterIconDark as codexIconDark
} from '@oneworks/adapter-codex/icon'
import { adapterDisplayName as copilotDisplayName, adapterIcon as copilotIcon } from '@oneworks/adapter-copilot/icon'
import {
  adapterDisplayName as cursorDisplayName,
  adapterIcon as cursorIcon,
  adapterIconDark as cursorIconDark
} from '@oneworks/adapter-cursor/icon'
import {
  adapterDisplayName as droidDisplayName,
  adapterIcon as droidIcon,
  adapterIconDark as droidIconDark
} from '@oneworks/adapter-droid/icon'
import { adapterDisplayName as dshDisplayName, adapterIcon as dshIcon } from '@oneworks/adapter-dsh/icon'
import { adapterDisplayName as geminiDisplayName, adapterIcon as geminiIcon } from '@oneworks/adapter-gemini/icon'
import { adapterDisplayName as gooseDisplayName, adapterIcon as gooseIcon } from '@oneworks/adapter-goose/icon'
import {
  adapterDisplayName as grokDisplayName,
  adapterIcon as grokIcon,
  adapterIconDark as grokIconDark
} from '@oneworks/adapter-grok/icon'
import { adapterDisplayName as junieDisplayName, adapterIcon as junieIcon } from '@oneworks/adapter-junie/icon'
import { adapterDisplayName as kimiDisplayName, adapterIcon as kimiIcon } from '@oneworks/adapter-kimi/icon'
import { adapterDisplayName as kiroDisplayName, adapterIcon as kiroIcon } from '@oneworks/adapter-kiro/icon'
import { adapterDisplayName as opencodeDisplayName, adapterIcon as opencodeIcon } from '@oneworks/adapter-opencode/icon'
import {
  adapterDisplayName as piDisplayName,
  adapterIcon as piIcon,
  adapterIconDark as piIconDark
} from '@oneworks/adapter-pi/icon'
import {
  adapterDisplayName as qwenCodeDisplayName,
  adapterIcon as qwenCodeIcon
} from '@oneworks/adapter-qwen-code/icon'

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
  cline: {
    title: clineDisplayName,
    icon: clineIcon,
    darkIcon: clineIconDark
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
  cursor: {
    title: cursorDisplayName,
    icon: cursorIcon,
    darkIcon: cursorIconDark
  },
  dsh: {
    title: dshDisplayName,
    icon: dshIcon
  },
  droid: {
    title: droidDisplayName,
    icon: droidIcon,
    darkIcon: droidIconDark
  },
  gemini: {
    title: geminiDisplayName,
    icon: geminiIcon
  },
  goose: {
    title: gooseDisplayName,
    icon: gooseIcon
  },
  grok: {
    title: grokDisplayName,
    icon: grokIcon,
    darkIcon: grokIconDark
  },
  kiro: {
    title: kiroDisplayName,
    icon: kiroIcon
  },
  junie: {
    title: junieDisplayName,
    icon: junieIcon
  },
  kimi: {
    title: kimiDisplayName,
    icon: kimiIcon
  },
  opencode: {
    title: opencodeDisplayName,
    icon: opencodeIcon
  },
  pi: {
    title: piDisplayName,
    icon: piIcon,
    darkIcon: piIconDark
  },
  'qwen-code': {
    title: qwenCodeDisplayName,
    icon: qwenCodeIcon
  }
} as const satisfies Record<string, AdapterDisplay>

export const builtInAdapterKeys = Object.keys(adapterDisplayMap)

export const builtInAdapterSupportsAccounts = (adapterKey: string) => (
  builtInAdapterKeys.includes(adapterKey) && adapterKey !== 'droid'
)

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
