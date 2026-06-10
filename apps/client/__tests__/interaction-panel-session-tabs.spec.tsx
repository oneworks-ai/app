import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { createInteractionPanelSessionPage } from '#~/components/chat/interaction-panel/interaction-panel-session-pages'
import { buildInteractionPanelAddMenuItems } from '#~/components/chat/interaction-panel/interaction-panel-tab-menu'
import { buildInteractionPanelTabs } from '#~/components/chat/interaction-panel/interaction-panel-tabs'

describe('interaction panel session tabs', () => {
  it('adds the new session action to the panel add menu', () => {
    const items = buildInteractionPanelAddMenuItems(
      ((key: string) => {
        if (key === 'chat.interactionPanel.addSession') return 'New session'
        if (key === 'chat.interactionPanel.openResource') return 'Open resource'
        if (key === 'chat.terminal.addSession') return 'New terminal'
        if (key === 'chat.interactionPanel.addIframe') return 'New web page'
        return key
      }) as any,
      false
    ) ?? []

    expect(items.map(item => item?.key)).toEqual(['resource', 'terminal', 'session', 'iframe'])
    const sessionItem = items.find(item => item?.key === 'session')
    const sessionLabel = sessionItem != null && 'label' in sessionItem ? sessionItem.label : null
    expect(renderToStaticMarkup(<>{sessionLabel}</>)).toContain('New session')
  })

  it('hides the panel session action before a root session exists', () => {
    const items = buildInteractionPanelAddMenuItems(
      ((key: string) => {
        if (key === 'chat.interactionPanel.addSession') return 'New session'
        if (key === 'chat.interactionPanel.openResource') return 'Open resource'
        if (key === 'chat.terminal.addSession') return 'New terminal'
        if (key === 'chat.interactionPanel.addIframe') return 'New web page'
        return key
      }) as any,
      false,
      { canCreateSessionTab: false }
    ) ?? []

    expect(items.map(item => item?.key)).toEqual(['resource', 'terminal', 'iframe'])
    expect(items.some(item => item?.key === 'session')).toBe(false)
  })

  it('builds tabs for lightweight panel sessions', () => {
    const tabs = buildInteractionPanelTabs({
      filePaths: [],
      iframePages: [],
      sessionPages: [{
        id: 'panel-session-1',
        sessionId: 'session-1',
        title: 'Scratch run'
      }],
      terminalInfoById: {},
      terminalPanes: []
    })

    expect(tabs).toEqual([{
      id: 'panel-session-1',
      kind: 'session',
      icon: 'chat',
      label: 'Scratch run',
      sessionId: 'session-1',
      canClose: true
    }])
  })

  it('can bind a lightweight panel tab to an existing child session', () => {
    const page = createInteractionPanelSessionPage('Child run', 'child-session', 'focus-next')

    expect(page.focusRequestId).toBe('focus-next')
    expect(page.sessionId).toBe('child-session')
    expect(page.title).toBe('Child run')
  })
})
