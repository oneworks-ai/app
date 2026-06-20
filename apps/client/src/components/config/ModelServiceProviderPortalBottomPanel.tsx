import { useEffect, useState } from 'react'

import { DockPanel } from '#~/components/dock-panel/DockPanel'
import { DOCK_PANEL_WORKSPACE_CHROME_MINIMIZED_HEIGHT } from '#~/components/dock-panel/dockPanelConstants'
import { RouteContainerPanelDockWorkspace } from '#~/components/layout/RouteContainerPanelTabs'
import type { RouteContainerPanelDockTabItem } from '#~/components/layout/RouteContainerPanelTabs'

import { ModelServiceProviderPortalFrame } from './ModelServiceProviderPortal'
import type { TranslationFn } from './configUtils'

export interface ModelServiceProviderPortalRequest {
  title: string
  url: string
}

export interface ModelServiceProviderPortalTab extends ModelServiceProviderPortalRequest {
  key: string
}

export interface ModelServiceProviderPortalTabsState {
  activeTabKey?: string
  tabs: ModelServiceProviderPortalTab[]
}

export const emptyModelServiceProviderPortalTabsState: ModelServiceProviderPortalTabsState = { tabs: [] }

export const toModelServiceProviderPortalTabKey = (url: string) => `model-service-portal:${url}`

export const addModelServiceProviderPortalTab = (
  current: ModelServiceProviderPortalTabsState,
  request: ModelServiceProviderPortalRequest
): ModelServiceProviderPortalTabsState => {
  const tabKey = toModelServiceProviderPortalTabKey(request.url)
  const nextTab: ModelServiceProviderPortalTab = {
    key: tabKey,
    title: request.title,
    url: request.url
  }
  const tabs = current.tabs.some(tab => tab.key === tabKey)
    ? current.tabs.map(tab => tab.key === tabKey ? nextTab : tab)
    : [...current.tabs, nextTab]

  return {
    activeTabKey: tabKey,
    tabs
  }
}

export const closeModelServiceProviderPortalTab = (
  current: ModelServiceProviderPortalTabsState,
  tabKey: string
): ModelServiceProviderPortalTabsState => {
  const tabIndex = current.tabs.findIndex(tab => tab.key === tabKey)
  const tabs = current.tabs.filter(tab => tab.key !== tabKey)
  if (current.activeTabKey !== tabKey) {
    return {
      ...current,
      tabs
    }
  }

  return {
    activeTabKey: tabs[Math.min(Math.max(tabIndex, 0), tabs.length - 1)]?.key,
    tabs
  }
}

export const syncModelServiceProviderPortalTabs = (
  current: ModelServiceProviderPortalTabsState,
  activeTabKey: string | null,
  openedTabKeys: readonly string[]
): ModelServiceProviderPortalTabsState => {
  const openedTabKeySet = new Set(openedTabKeys)
  const tabs = current.tabs.filter(tab => openedTabKeySet.has(tab.key))

  return {
    activeTabKey: activeTabKey ?? tabs[0]?.key,
    tabs
  }
}

const CONFIG_MODEL_SERVICE_PORTAL_BOTTOM_PANEL_HEIGHT_STORAGE_KEY = 'config:model-service-portal-bottom-panel-height'

export function ModelServiceProviderPortalBottomPanel({
  activeTabKey,
  isOpen,
  tabs,
  t,
  onClose,
  onOpenExternal,
  onTabChange,
  onTabClose
}: {
  activeTabKey?: string
  isOpen: boolean
  tabs: ModelServiceProviderPortalTab[]
  t: TranslationFn
  onClose: () => void
  onOpenExternal: (url: string) => void
  onTabChange: (tabKey: string | null, openedTabs: string[]) => void
  onTabClose: (tabKey: string) => void
}) {
  const [isPanelMinimized, setIsPanelMinimized] = useState(false)
  const dockTabs: Array<RouteContainerPanelDockTabItem<string>> = tabs.map(tab => ({
    content: (
      <ModelServiceProviderPortalFrame
        url={tab.url}
        title={tab.title}
      />
    ),
    icon: 'web_asset',
    key: tab.key,
    label: tab.title,
    title: tab.title
  }))
  const openedTabs = tabs.map(tab => tab.key)
  const activePortalTab = tabs.find(tab => tab.key === activeTabKey) ?? tabs[0]
  const panelMinimizeLabel = t(isPanelMinimized ? 'common.expandPanel' : 'common.collapsePanel')
  const handlePanelClose = () => {
    setIsPanelMinimized(false)
    onClose()
  }

  useEffect(() => {
    if (!isOpen) setIsPanelMinimized(false)
  }, [isOpen])

  return (
    <DockPanel
      allowFullscreen
      className='config-view__model-service-portal-bottom-panel'
      closeLabel={t('config.modelServices.portal.closePanel')}
      defaultHeight={360}
      fullscreenEnterLabel={t('common.enterFullscreen')}
      fullscreenExitLabel={t('common.exitFullscreen')}
      hideHeader
      isMinimized={isPanelMinimized}
      isOpen={isOpen}
      maxHeight={640}
      minimizedHeight={DOCK_PANEL_WORKSPACE_CHROME_MINIMIZED_HEIGHT}
      minHeight='20%'
      onExpandMinimized={() => setIsPanelMinimized(false)}
      resizeLabel={t('config.modelServices.portal.resizePanel')}
      storageKey={CONFIG_MODEL_SERVICE_PORTAL_BOTTOM_PANEL_HEIGHT_STORAGE_KEY}
      onClose={handlePanelClose}
    >
      {({ isFullscreen, onToggleFullscreen }) => (
        <RouteContainerPanelDockWorkspace
          activeTab={activeTabKey ?? null}
          ariaLabel={t('config.modelServices.portal.tabsLabel')}
          className='config-view__model-service-portal-bottom-panel-dock'
          closable
          closeLabel={(title) => `${t('common.close')} ${title}`}
          minOpenTabs={0}
          labelMode='responsive'
          openedTabs={openedTabs}
          panelChromeActions={{
            beforeFullscreen: {
              disabled: activePortalTab == null,
              icon: 'open_in_new',
              key: 'open-external',
              label: t('config.modelServices.actions.openExternal'),
              onSelect: () => {
                if (activePortalTab != null) onOpenExternal(activePortalTab.url)
              }
            },
            close: {
              label: t('config.modelServices.portal.closePanel'),
              onSelect: handlePanelClose
            },
            fullscreen: {
              active: isFullscreen,
              activeIcon: 'fullscreen_exit',
              icon: 'fullscreen',
              label: isFullscreen ? t('common.exitFullscreen') : t('common.enterFullscreen'),
              onSelect: onToggleFullscreen
            },
            minimize: {
              active: isPanelMinimized,
              activeIcon: 'bottom_panel_open',
              label: panelMinimizeLabel,
              onSelect: () => setIsPanelMinimized(current => !current)
            }
          }}
          panelKey='config-model-service-portal'
          tabs={dockTabs}
          onTabChange={onTabChange}
          onTabClose={onTabClose}
        />
      )}
    </DockPanel>
  )
}
