/* eslint-disable max-lines -- webview context menu groups are intentionally centralized. */
import { Menu, app, clipboard, shell } from 'electron'
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

import { readGlobalInterfaceLanguageConfig } from './interface-language-config'

type WebviewContextMenuLanguage = 'en' | 'zh'

interface WebviewContextMenuLabels {
  back: string
  commentElement: string
  copy: string
  copyImage: string
  copyImageAddress: string
  copyLinkAddress: string
  cut: string
  delete: string
  forward: string
  inspectElement: string
  openImageExternal: string
  openLinkExternal: string
  paste: string
  pasteAndMatchStyle: string
  redo: string
  reload: string
  selectAll: string
  undo: string
}

const webviewContextMenuLabels = {
  en: {
    back: 'Back',
    commentElement: 'Comment on Element',
    copy: 'Copy',
    copyImage: 'Copy Image',
    copyImageAddress: 'Copy Image Address',
    copyLinkAddress: 'Copy Link Address',
    cut: 'Cut',
    delete: 'Delete',
    forward: 'Forward',
    inspectElement: 'Inspect Element',
    openImageExternal: 'Open Image in External Browser',
    openLinkExternal: 'Open Link in External Browser',
    paste: 'Paste',
    pasteAndMatchStyle: 'Paste and Match Style',
    redo: 'Redo',
    reload: 'Reload',
    selectAll: 'Select All',
    undo: 'Undo'
  },
  zh: {
    back: '后退',
    commentElement: '评论此元素',
    copy: '复制',
    copyImage: '复制图片',
    copyImageAddress: '复制图片地址',
    copyLinkAddress: '复制链接地址',
    cut: '剪切',
    delete: '删除',
    forward: '前进',
    inspectElement: '检查元素',
    openImageExternal: '在外部浏览器打开图片',
    openLinkExternal: '在外部浏览器打开链接',
    paste: '粘贴',
    pasteAndMatchStyle: '粘贴并匹配样式',
    redo: '重做',
    reload: '重新加载',
    selectAll: '全选',
    undo: '撤销'
  }
} satisfies Record<WebviewContextMenuLanguage, WebviewContextMenuLabels>

const fallbackWebviewContextMenuLanguage: WebviewContextMenuLanguage = 'en'

const separator = (): MenuItemConstructorOptions => ({ type: 'separator' })

const isNonEmptyText = (value: string) => value.trim() !== ''

const normalizeLanguageCode = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const language = value.trim().replaceAll('_', '-').toLowerCase()
  return language === '' ? undefined : language
}

const resolveWebviewContextMenuLanguageFromCode = (value: unknown): WebviewContextMenuLanguage | undefined => {
  const language = normalizeLanguageCode(value)
  if (language == null) return undefined
  if (language.startsWith('zh')) return 'zh'
  if (language.startsWith('en')) return 'en'
  return undefined
}

const readHostDocumentLanguage = async (window: BrowserWindow) => {
  if (window.isDestroyed()) return undefined

  try {
    return await window.webContents.executeJavaScript(
      'document.documentElement.lang || navigator.language || ""',
      false
    ) as unknown
  } catch {
    return undefined
  }
}

const resolveWebviewContextMenuLanguage = async (window: BrowserWindow): Promise<WebviewContextMenuLanguage> => {
  const appLocale = app.getLocale()
  const hostDocumentLanguage = await readHostDocumentLanguage(window)
  try {
    const config = await readGlobalInterfaceLanguageConfig()
    return resolveWebviewContextMenuLanguageFromCode(hostDocumentLanguage) ??
      resolveWebviewContextMenuLanguageFromCode(config.effectiveLanguage) ??
      resolveWebviewContextMenuLanguageFromCode(appLocale) ??
      fallbackWebviewContextMenuLanguage
  } catch {
    return resolveWebviewContextMenuLanguageFromCode(hostDocumentLanguage) ??
      resolveWebviewContextMenuLanguageFromCode(appLocale) ??
      fallbackWebviewContextMenuLanguage
  }
}

const readWebviewContextMenuLabels = async (window: BrowserWindow) => (
  webviewContextMenuLabels[await resolveWebviewContextMenuLanguage(window)]
)

const toExternalUrl = (url: string) => {
  const trimmedUrl = url.trim()
  if (trimmedUrl === '') return undefined

  try {
    const parsedUrl = new URL(trimmedUrl)
    if (
      parsedUrl.protocol === 'http:' ||
      parsedUrl.protocol === 'https:' ||
      parsedUrl.protocol === 'mailto:' ||
      parsedUrl.protocol === 'tel:'
    ) {
      return parsedUrl.toString()
    }
  } catch {
    return undefined
  }

  return undefined
}

const canRunWebContentsAction = (webContents: WebContents, action: () => boolean) => {
  if (webContents.isDestroyed()) return false
  try {
    return action()
  } catch {
    return false
  }
}

const runWebContentsAction = (webContents: WebContents, action: () => void) => {
  if (webContents.isDestroyed()) return
  try {
    action()
  } catch {
    // The guest page may be navigating or destroyed between menu creation and click.
  }
}

const pushSeparator = (template: MenuItemConstructorOptions[]) => {
  const lastItem = template.at(-1)
  if (lastItem == null || lastItem.type === 'separator') return
  template.push(separator())
}

const copyText = (value: string) => {
  const trimmedValue = value.trim()
  if (trimmedValue === '') return
  clipboard.writeText(trimmedValue)
}

const openExternalUrl = (url: string) => {
  const externalUrl = toExternalUrl(url)
  if (externalUrl == null) return
  void shell.openExternal(externalUrl)
}

const buildNavigationItems = (
  webContents: WebContents,
  labels: WebviewContextMenuLabels
): MenuItemConstructorOptions[] => [
  {
    click: () => runWebContentsAction(webContents, () => webContents.goBack()),
    enabled: canRunWebContentsAction(webContents, () => webContents.canGoBack()),
    label: labels.back
  },
  {
    click: () => runWebContentsAction(webContents, () => webContents.goForward()),
    enabled: canRunWebContentsAction(webContents, () => webContents.canGoForward()),
    label: labels.forward
  },
  {
    click: () => runWebContentsAction(webContents, () => webContents.reload()),
    label: labels.reload
  }
]

const appendLinkItems = (
  template: MenuItemConstructorOptions[],
  params: ContextMenuParams,
  labels: WebviewContextMenuLabels
) => {
  const linkUrl = toExternalUrl(params.linkURL)
  if (linkUrl == null) return

  pushSeparator(template)
  template.push(
    {
      click: () => openExternalUrl(linkUrl),
      label: labels.openLinkExternal
    },
    {
      click: () => copyText(linkUrl),
      label: labels.copyLinkAddress
    }
  )
}

const appendImageItems = (
  template: MenuItemConstructorOptions[],
  webContents: WebContents,
  params: ContextMenuParams,
  labels: WebviewContextMenuLabels
) => {
  if (params.mediaType !== 'image' && !params.hasImageContents && params.srcURL.trim() === '') {
    return
  }

  pushSeparator(template)
  if (params.hasImageContents) {
    template.push({
      click: () => runWebContentsAction(webContents, () => webContents.copyImageAt(params.x, params.y)),
      label: labels.copyImage
    })
  }

  if (isNonEmptyText(params.srcURL)) {
    template.push({
      click: () => copyText(params.srcURL),
      label: labels.copyImageAddress
    })

    const imageUrl = toExternalUrl(params.srcURL)
    if (imageUrl != null) {
      template.push({
        click: () => openExternalUrl(imageUrl),
        label: labels.openImageExternal
      })
    }
  }
}

const appendSelectionItems = (
  template: MenuItemConstructorOptions[],
  webContents: WebContents,
  params: ContextMenuParams,
  labels: WebviewContextMenuLabels
) => {
  if (!isNonEmptyText(params.selectionText) && !params.editFlags.canCopy) return

  pushSeparator(template)
  template.push({
    click: () => runWebContentsAction(webContents, () => webContents.copy()),
    enabled: params.editFlags.canCopy || isNonEmptyText(params.selectionText),
    label: labels.copy
  })
}

const appendCommentElementItem = (
  template: MenuItemConstructorOptions[],
  window: BrowserWindow,
  webContents: WebContents,
  params: ContextMenuParams,
  labels: WebviewContextMenuLabels
) => {
  pushSeparator(template)
  template.push({
    click: () => {
      if (window.isDestroyed() || webContents.isDestroyed()) return
      window.webContents.send('desktop:interaction-panel-webview-comment-element', {
        frameUrl: params.frameURL,
        pageUrl: params.pageURL,
        webContentsId: webContents.id,
        x: params.x,
        y: params.y
      })
    },
    label: labels.commentElement
  })
}

const appendEditableItems = (
  template: MenuItemConstructorOptions[],
  webContents: WebContents,
  params: ContextMenuParams,
  labels: WebviewContextMenuLabels
) => {
  if (!params.isEditable) return

  pushSeparator(template)
  template.push(
    {
      click: () => runWebContentsAction(webContents, () => webContents.undo()),
      enabled: params.editFlags.canUndo,
      label: labels.undo
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.redo()),
      enabled: params.editFlags.canRedo,
      label: labels.redo
    },
    separator(),
    {
      click: () => runWebContentsAction(webContents, () => webContents.cut()),
      enabled: params.editFlags.canCut,
      label: labels.cut
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.copy()),
      enabled: params.editFlags.canCopy,
      label: labels.copy
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.paste()),
      enabled: params.editFlags.canPaste,
      label: labels.paste
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.pasteAndMatchStyle()),
      enabled: params.editFlags.canPaste,
      label: labels.pasteAndMatchStyle
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.delete()),
      enabled: params.editFlags.canDelete,
      label: labels.delete
    },
    separator(),
    {
      click: () => runWebContentsAction(webContents, () => webContents.selectAll()),
      enabled: params.editFlags.canSelectAll,
      label: labels.selectAll
    }
  )
}

const appendInspectElementItem = (
  template: MenuItemConstructorOptions[],
  webContents: WebContents,
  params: ContextMenuParams,
  labels: WebviewContextMenuLabels
) => {
  pushSeparator(template)
  template.push({
    click: () => runWebContentsAction(webContents, () => webContents.inspectElement(params.x, params.y)),
    label: labels.inspectElement
  })
}

const compactTemplate = (template: MenuItemConstructorOptions[]) => {
  while (template.at(-1)?.type === 'separator') {
    template.pop()
  }
  return template
}

const showWebviewContextMenu = async (window: BrowserWindow, webContents: WebContents, params: ContextMenuParams) => {
  const labels = await readWebviewContextMenuLabels(window)
  const template: MenuItemConstructorOptions[] = [
    ...buildNavigationItems(webContents, labels)
  ]

  appendLinkItems(template, params, labels)
  appendImageItems(template, webContents, params, labels)
  if (params.isEditable) {
    appendEditableItems(template, webContents, params, labels)
  } else {
    appendSelectionItems(template, webContents, params, labels)
  }
  appendCommentElementItem(template, window, webContents, params, labels)
  appendInspectElementItem(template, webContents, params, labels)

  const menuTemplate = compactTemplate(template)
  if (menuTemplate.length === 0 || window.isDestroyed()) return
  Menu.buildFromTemplate(menuTemplate).popup({ window })
}

export const installWebviewContextMenu = (window: BrowserWindow, webContents: WebContents) => {
  webContents.on('context-menu', (_event, params) => {
    void showWebviewContextMenu(window, webContents, params)
  })
}
