/* eslint-disable max-lines -- webview context menu groups are intentionally centralized. */
import { Menu, clipboard, shell } from 'electron'
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

const separator = (): MenuItemConstructorOptions => ({ type: 'separator' })

const isNonEmptyText = (value: string) => value.trim() !== ''

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
  webContents: WebContents
): MenuItemConstructorOptions[] => [
  {
    click: () => runWebContentsAction(webContents, () => webContents.goBack()),
    enabled: canRunWebContentsAction(webContents, () => webContents.canGoBack()),
    label: 'Back'
  },
  {
    click: () => runWebContentsAction(webContents, () => webContents.goForward()),
    enabled: canRunWebContentsAction(webContents, () => webContents.canGoForward()),
    label: 'Forward'
  },
  {
    click: () => runWebContentsAction(webContents, () => webContents.reload()),
    label: 'Reload'
  }
]

const appendLinkItems = (
  template: MenuItemConstructorOptions[],
  params: ContextMenuParams
) => {
  const linkUrl = toExternalUrl(params.linkURL)
  if (linkUrl == null) return

  pushSeparator(template)
  template.push(
    {
      click: () => openExternalUrl(linkUrl),
      label: 'Open Link in External Browser'
    },
    {
      click: () => copyText(linkUrl),
      label: 'Copy Link Address'
    }
  )
}

const appendImageItems = (
  template: MenuItemConstructorOptions[],
  webContents: WebContents,
  params: ContextMenuParams
) => {
  if (params.mediaType !== 'image' && !params.hasImageContents && params.srcURL.trim() === '') {
    return
  }

  pushSeparator(template)
  if (params.hasImageContents) {
    template.push({
      click: () => runWebContentsAction(webContents, () => webContents.copyImageAt(params.x, params.y)),
      label: 'Copy Image'
    })
  }

  if (isNonEmptyText(params.srcURL)) {
    template.push({
      click: () => copyText(params.srcURL),
      label: 'Copy Image Address'
    })

    const imageUrl = toExternalUrl(params.srcURL)
    if (imageUrl != null) {
      template.push({
        click: () => openExternalUrl(imageUrl),
        label: 'Open Image in External Browser'
      })
    }
  }
}

const appendSelectionItems = (
  template: MenuItemConstructorOptions[],
  webContents: WebContents,
  params: ContextMenuParams
) => {
  if (!isNonEmptyText(params.selectionText) && !params.editFlags.canCopy) return

  pushSeparator(template)
  template.push({
    click: () => runWebContentsAction(webContents, () => webContents.copy()),
    enabled: params.editFlags.canCopy || isNonEmptyText(params.selectionText),
    label: 'Copy'
  })
}

const appendEditableItems = (
  template: MenuItemConstructorOptions[],
  webContents: WebContents,
  params: ContextMenuParams
) => {
  if (!params.isEditable) return

  pushSeparator(template)
  template.push(
    {
      click: () => runWebContentsAction(webContents, () => webContents.undo()),
      enabled: params.editFlags.canUndo,
      label: 'Undo'
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.redo()),
      enabled: params.editFlags.canRedo,
      label: 'Redo'
    },
    separator(),
    {
      click: () => runWebContentsAction(webContents, () => webContents.cut()),
      enabled: params.editFlags.canCut,
      label: 'Cut'
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.copy()),
      enabled: params.editFlags.canCopy,
      label: 'Copy'
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.paste()),
      enabled: params.editFlags.canPaste,
      label: 'Paste'
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.pasteAndMatchStyle()),
      enabled: params.editFlags.canPaste,
      label: 'Paste and Match Style'
    },
    {
      click: () => runWebContentsAction(webContents, () => webContents.delete()),
      enabled: params.editFlags.canDelete,
      label: 'Delete'
    },
    separator(),
    {
      click: () => runWebContentsAction(webContents, () => webContents.selectAll()),
      enabled: params.editFlags.canSelectAll,
      label: 'Select All'
    }
  )
}

const appendInspectElementItem = (
  template: MenuItemConstructorOptions[],
  webContents: WebContents,
  params: ContextMenuParams
) => {
  pushSeparator(template)
  template.push({
    click: () => runWebContentsAction(webContents, () => webContents.inspectElement(params.x, params.y)),
    label: 'Inspect Element'
  })
}

const compactTemplate = (template: MenuItemConstructorOptions[]) => {
  while (template.at(-1)?.type === 'separator') {
    template.pop()
  }
  return template
}

export const installWebviewContextMenu = (window: BrowserWindow, webContents: WebContents) => {
  webContents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = [
      ...buildNavigationItems(webContents)
    ]

    appendLinkItems(template, params)
    appendImageItems(template, webContents, params)
    if (params.isEditable) {
      appendEditableItems(template, webContents, params)
    } else {
      appendSelectionItems(template, webContents, params)
    }
    appendInspectElementItem(template, webContents, params)

    const menuTemplate = compactTemplate(template)
    if (menuTemplate.length === 0 || window.isDestroyed()) return
    Menu.buildFromTemplate(menuTemplate).popup({ window })
  })
}
