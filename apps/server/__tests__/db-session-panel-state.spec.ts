import { describe, expect, it } from 'vitest'

import { normalizeSessionPanelState } from '#~/db/sessions/panel-state.js'

describe('session panel state browser view normalization', () => {
  it('round-trips the complete persisted browser view state', () => {
    const state = normalizeSessionPanelState({
      bottom: {
        activeTabId: 'page-1',
        tabs: [{
          browserControlRequestId: 'request-1',
          deviceToolbarOpen: true,
          devtoolsDockSide: 'bottom',
          history: ['https://one.test', 'https://two.test'],
          historyIndex: 1,
          id: 'page-1',
          inspectOpen: true,
          kind: 'web',
          title: 'Page',
          url: 'https://two.test',
          viewport: {
            devicePixelRatio: 2.5,
            deviceType: 'mobile',
            height: 844,
            presetId: 'iphone-12-pro',
            width: 390,
            zoom: 0.75
          }
        }]
      }
    })

    expect(state.bottom.tabs[0]).toMatchObject({
      browserControlRequestId: 'request-1',
      deviceToolbarOpen: true,
      devtoolsDockSide: 'bottom',
      inspectOpen: true,
      viewport: {
        devicePixelRatio: 2.5,
        deviceType: 'mobile',
        height: 844,
        presetId: 'iphone-12-pro',
        width: 390,
        zoom: 0.75
      }
    })
  })

  it('drops invalid browser view enum values while retaining valid dimensions', () => {
    const state = normalizeSessionPanelState({
      right: {
        tabs: [{
          devtoolsDockSide: 'floating',
          id: 'page-1',
          kind: 'web',
          title: 'Page',
          url: 'https://example.test',
          viewport: { deviceType: 'watch', height: 600, zoom: 'huge' }
        }]
      }
    })

    expect(state.right.tabs[0]).toMatchObject({ viewport: { height: 600 } })
    expect(state.right.tabs[0]).not.toHaveProperty('devtoolsDockSide')
  })
})
