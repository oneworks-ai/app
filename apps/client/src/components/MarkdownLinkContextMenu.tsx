import './MarkdownLinkContextMenu.scss'

import { App } from 'antd'
import React, { cloneElement, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { copyTextWithFeedback } from '#~/utils/copy'
import { parseWorkspaceFileLinkForWorkspaceRoot } from '#~/utils/link-targets'
import type { WorkspaceFileLinkTarget } from '#~/utils/link-targets'
import { buildMarkdownLinkIntentTitle } from '#~/utils/markdown-link-intent'
import type { MarkdownLinkIntent } from '#~/utils/markdown-link-intent'

import {
  buildMarkdownLinkText,
  getAppBrowserLinkUrl,
  getExternalLinkUrl,
  openExternalLink
} from './markdown-link-context-menu-utils'

interface MarkdownLinkContextMenuProps {
  children: React.ReactElement<{ onContextMenu?: (event: React.MouseEvent<HTMLAnchorElement>) => void }>
  href: string
  intent?: MarkdownLinkIntent
  label: string
  workspaceRootPath?: string
  onOpenUrlInAppBrowser?: (url: string, title?: string) => void
  onOpenWorkspaceFile?: (target: WorkspaceFileLinkTarget) => void
}

interface LinkContextMenuState {
  appBrowserUrl: string
  externalUrl: string
  href: string
  intent?: MarkdownLinkIntent
  label: string
  workspaceTarget: WorkspaceFileLinkTarget | null
  x: number
  y: number
}

const LINK_CONTEXT_MENU_WIDTH = 276

const getLinkContextMenuHeight = (itemCount: number) => 42 + itemCount * 40

export function MarkdownLinkContextMenu({
  children,
  href,
  intent,
  label,
  workspaceRootPath,
  onOpenUrlInAppBrowser,
  onOpenWorkspaceFile
}: MarkdownLinkContextMenuProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [menuState, setMenuState] = useState<LinkContextMenuState | null>(null)
  const workspaceTarget = useMemo(
    () => parseWorkspaceFileLinkForWorkspaceRoot(href, workspaceRootPath),
    [href, workspaceRootPath]
  )
  const closeMenu = useCallback(() => setMenuState(null), [])

  useEffect(() => {
    if (menuState == null || typeof window === 'undefined') return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeMenu, menuState])

  const openMenu = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    children.props.onContextMenu?.(event)
    if (event.defaultPrevented || href.trim() === '') return

    event.preventDefault()
    event.stopPropagation()

    const appBrowserUrl = getAppBrowserLinkUrl(href)
    const externalUrl = getExternalLinkUrl(href)
    const itemCount = 1 +
      (workspaceTarget != null && onOpenWorkspaceFile != null ? 1 : 0) +
      (appBrowserUrl !== '' && onOpenUrlInAppBrowser != null ? 1 : 0) +
      (externalUrl !== '' ? 1 : 0)
    const menuHeight = getLinkContextMenuHeight(itemCount)
    const viewportWidth = typeof window === 'undefined' ? LINK_CONTEXT_MENU_WIDTH : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? menuHeight : window.innerHeight
    setMenuState({
      appBrowserUrl,
      externalUrl,
      href,
      intent,
      label: label || href,
      workspaceTarget,
      x: Math.max(8, Math.min(event.clientX, viewportWidth - LINK_CONTEXT_MENU_WIDTH - 8)),
      y: Math.max(8, Math.min(event.clientY, viewportHeight - menuHeight - 8))
    })
  }, [children.props, href, intent, label, onOpenUrlInAppBrowser, onOpenWorkspaceFile, workspaceTarget])

  const handleOpenWorkspaceFile = useCallback(() => {
    if (menuState?.workspaceTarget == null) return
    closeMenu()
    onOpenWorkspaceFile?.(menuState.workspaceTarget)
  }, [closeMenu, menuState, onOpenWorkspaceFile])

  const handleOpenInAppBrowser = useCallback(() => {
    if (menuState?.appBrowserUrl == null || menuState.appBrowserUrl === '') return
    closeMenu()
    onOpenUrlInAppBrowser?.(menuState.appBrowserUrl, menuState.label)
  }, [closeMenu, menuState, onOpenUrlInAppBrowser])

  const handleOpenExternal = useCallback(() => {
    if (menuState?.externalUrl == null || menuState.externalUrl === '') return
    closeMenu()
    openExternalLink(menuState.externalUrl)
  }, [closeMenu, menuState])

  const handleCopyMarkdownLink = useCallback(() => {
    if (menuState == null) return
    closeMenu()
    void copyTextWithFeedback({
      failureMessage: t('common.copyFailed'),
      messageApi: message,
      successMessage: t('chat.markdownLinkActions.copyMarkdownSuccess'),
      text: buildMarkdownLinkText({
        ...menuState,
        title: menuState.intent == null ? undefined : buildMarkdownLinkIntentTitle(menuState.intent)
      })
    })
  }, [closeMenu, menuState, message, t])

  const renderMenuItem = (icon: string, labelText: string, onClick: () => void) => (
    <button
      type='button'
      role='menuitem'
      className='markdown-link-context-menu__item'
      onClick={onClick}
    >
      <span className='material-symbols-rounded markdown-link-context-menu__icon'>{icon}</span>
      <span className='markdown-link-context-menu__label'>
        {labelText}
      </span>
    </button>
  )

  return (
    <>
      {cloneElement(children, { onContextMenu: openMenu })}
      {menuState != null && typeof document !== 'undefined' &&
        createPortal(
          <div
            className='markdown-link-context-menu'
            role='menu'
            style={{ left: menuState.x, top: menuState.y }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {menuState.workspaceTarget != null && onOpenWorkspaceFile != null && (
              renderMenuItem('draft', t('chat.markdownLinkActions.openWorkspaceFileInApp'), handleOpenWorkspaceFile)
            )}
            {menuState.appBrowserUrl !== '' && onOpenUrlInAppBrowser != null && (
              renderMenuItem('language', t('chat.markdownLinkActions.openInAppBrowser'), handleOpenInAppBrowser)
            )}
            {menuState.externalUrl !== '' && (
              renderMenuItem('open_in_new', t('chat.markdownLinkActions.openInExternalBrowser'), handleOpenExternal)
            )}
            <div className='markdown-link-context-menu__divider' />
            {renderMenuItem('link', t('chat.markdownLinkActions.copyMarkdownLink'), handleCopyMarkdownLink)}
          </div>,
          document.body
        )}
    </>
  )
}
