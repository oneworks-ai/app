import type { MessageLinksConfig } from '@oneworks/types'

export interface ResolvedMessageLinksConfig {
  externalLinkTarget: 'newTab' | 'currentTab'
  workspaceFileTarget: 'fileTab' | 'externalIde' | 'defaultLink'
  workspaceFileOpener: NonNullable<MessageLinksConfig['workspaceFileOpener']>
  imageLinkMode: 'inlinePreview' | 'link'
  plainWorkspacePathMode: 'link' | 'text'
}

export const DEFAULT_MESSAGE_LINKS_CONFIG: ResolvedMessageLinksConfig = {
  externalLinkTarget: 'newTab',
  workspaceFileTarget: 'fileTab',
  workspaceFileOpener: 'auto',
  imageLinkMode: 'inlinePreview',
  plainWorkspacePathMode: 'link'
}

const WORKSPACE_FILE_OPENERS = new Set([
  'auto',
  'vscode',
  'cursor',
  'windsurf',
  'zed',
  'intellij',
  'webstorm',
  'pycharm',
  'goland',
  'textedit'
])

export const resolveMessageLinksConfig = (
  config: MessageLinksConfig | null | undefined
): ResolvedMessageLinksConfig => ({
  externalLinkTarget: config?.externalLinkTarget === 'currentTab'
    ? 'currentTab'
    : DEFAULT_MESSAGE_LINKS_CONFIG.externalLinkTarget,
  workspaceFileTarget: config?.workspaceFileTarget === 'defaultLink'
    ? 'defaultLink'
    : config?.workspaceFileTarget === 'externalIde'
    ? 'externalIde'
    : DEFAULT_MESSAGE_LINKS_CONFIG.workspaceFileTarget,
  workspaceFileOpener: (
      config?.workspaceFileOpener != null &&
      WORKSPACE_FILE_OPENERS.has(config.workspaceFileOpener)
    )
    ? config.workspaceFileOpener
    : DEFAULT_MESSAGE_LINKS_CONFIG.workspaceFileOpener,
  imageLinkMode: config?.imageLinkMode === 'link'
    ? 'link'
    : DEFAULT_MESSAGE_LINKS_CONFIG.imageLinkMode,
  plainWorkspacePathMode: config?.plainWorkspacePathMode === 'text'
    ? 'text'
    : DEFAULT_MESSAGE_LINKS_CONFIG.plainWorkspacePathMode
})
