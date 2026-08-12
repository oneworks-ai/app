// @vitest-environment happy-dom
import { act, createElement } from 'react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface CapturedBreadcrumb {
  onBack?: () => void
}

interface CapturedSidebar {
  onSelectItem?: (item: { key: string }) => void
}

interface TestButtonProps {
  ariaLabel?: string
  label?: string
  onClick?: () => void
  title?: string
}

describe('oneWorks chat room navigation', () => {
  let breadcrumb: CapturedBreadcrumb | undefined
  let container: HTMLDivElement
  let root: Root
  let sidebar: CapturedSidebar | undefined

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    breadcrumb = undefined
    sidebar = undefined
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    globalThis.history.replaceState(
      {},
      '',
      '/ui/w/workspace-a/plugins/channel-oneworks/oneworks-channel?section=shared'
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses host-relative routes for breadcrumb, sidebar, and shared-room navigation', async () => {
    const clientModulePath = '../../../packages/plugins/channel-oneworks/client/src/index.tsx'
    const {
      buildOneWorksChannelRoute,
      buildOneWorksRoomRoute,
      OneWorksChannelView
    } = await import(/* @vite-ignore */ clientModulePath)
    const navigate = vi.fn()
    const data = {
      rooms: [{
        lastMessage: '',
        platforms: [{ channelType: 'oneworks', labels: ['Local'] }],
        roomId: 'room/local',
        title: 'Local Room'
      }],
      scenarios: [],
      sharedRooms: [],
      shareOwners: [],
      shares: [{
        grantCount: 1,
        permissions: ['view'],
        roomId: 'room/shared',
        roomTitle: 'Shared Room',
        shareRef: 'share-1',
        status: 'active'
      }],
      simulationTargets: [],
      trace: []
    }
    const route = {
      navigate,
      setActions: vi.fn(),
      setBreadcrumb: vi.fn((next?: CapturedBreadcrumb) => {
        if (next != null) breadcrumb = next
      }),
      setSidebar: vi.fn((next?: CapturedSidebar) => {
        if (next != null) sidebar = next
      }),
      setTitle: vi.fn()
    }
    const view = {
      data: {
        useQuery: () => ({ data, isLoading: false, mutate: vi.fn() })
      },
      i18n: {
        resolveText: (value: { 'zh-Hans': string }) => value['zh-Hans']
      },
      route,
      ui: {
        AgentRoom: () => null,
        Button: ({ ariaLabel, label, onClick, title }: TestButtonProps) =>
          createElement('button', { 'aria-label': ariaLabel, onClick, title }, label),
        Icon: () => null,
        Input: () => null,
        Select: () => null
      }
    }

    await act(async () => {
      root.render(createElement(OneWorksChannelView, {
        ctx: { api: { fetch: vi.fn() }, scope: 'channel-oneworks' },
        react: React,
        view
      }))
      await Promise.resolve()
    })

    expect(breadcrumb?.onBack).toBeTypeOf('function')
    expect(sidebar?.onSelectItem).toBeTypeOf('function')

    await act(async () => breadcrumb?.onBack?.())
    expect(navigate).toHaveBeenLastCalledWith(buildOneWorksChannelRoute('channel-oneworks'))

    await act(async () => sidebar?.onSelectItem?.({ key: 'room/local' }))
    expect(navigate).toHaveBeenLastCalledWith(buildOneWorksChannelRoute('channel-oneworks'))

    const sharedRoom = container.querySelector<HTMLButtonElement>('.oneworks-channel__share-room-link')
    expect(sharedRoom?.textContent).toContain('Shared Room')
    await act(async () => sharedRoom?.click())
    expect(navigate).toHaveBeenLastCalledWith(buildOneWorksRoomRoute('room/shared'))

    for (const [target] of navigate.mock.calls) {
      expect(target).not.toContain('/ui/w/')
    }
  })
})
