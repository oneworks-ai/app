// @vitest-environment happy-dom
import { act, createElement } from 'react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EntityCard } from '#~/components/entity-card/EntityCard'

interface TestSenderProps {
  onSend: (message: string) => Promise<boolean>
  placeholder?: string
}

describe('oneWorks Team Chat creator', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    globalThis.history.replaceState(
      {},
      '',
      '/ui/w/workspace-a/plugins/channel-oneworks/oneworks-channel'
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps leaders single-select, auto-selects related members, and submits an explicit leader', async () => {
    const clientModulePath = '../../../packages/plugins/channel-oneworks/client/src/index.tsx'
    const { OneWorksChannelView } = await import(/* @vite-ignore */ clientModulePath)
    const apiFetch = vi.fn(async (_input: string, _init?: RequestInit) => ({
      json: async () => ({ roomId: 'room-created' }),
      ok: true
    }))
    const mutate = vi.fn()
    const navigate = vi.fn()
    const data = {
      entities: [
        {
          description: 'Routes the team',
          entityId: 'leader-a',
          name: 'Leader A',
          relatedEntityIds: ['designer', 'engineer'],
          source: 'project',
          teamRole: 'leader'
        },
        {
          description: 'Another leader',
          entityId: 'leader-b',
          name: 'Leader B',
          relatedEntityIds: [],
          source: 'project',
          teamRole: 'leader'
        },
        {
          description: 'Designs flows',
          entityId: 'designer',
          name: 'Designer',
          relatedEntityIds: [],
          source: 'project',
          teamRole: 'member'
        },
        {
          description: 'Builds features',
          entityId: 'engineer',
          name: 'Engineer',
          relatedEntityIds: [],
          source: 'project',
          teamRole: 'member'
        }
      ],
      roomConnectionCandidates: [],
      rooms: [],
      scenarios: [],
      sharedRooms: [],
      shareOwners: [],
      shares: [],
      simulationTargets: [],
      trace: []
    }
    const Sender = (props: TestSenderProps) =>
      createElement(
        'button',
        {
          'data-placeholder': props.placeholder,
          'data-testid': 'sender',
          onClick: () => props.onSend('Build the roadmap'),
          type: 'button'
        },
        'Send'
      )
    const view = {
      data: { useQuery: () => ({ data, isLoading: false, mutate }) },
      i18n: { resolveText: (value: { en: string }) => value.en },
      route: {
        navigate,
        setActions: vi.fn(),
        setBreadcrumb: vi.fn(),
        setIcon: vi.fn(),
        setLauncherChrome: vi.fn(),
        setSidePanel: vi.fn(),
        setSidebar: vi.fn(),
        setTitle: vi.fn()
      },
      ui: {
        AgentRoom: () => null,
        Button: () => null,
        ChannelPlatformIcon: () => null,
        EntityCard,
        EntitySummary: () => null,
        GroupAvatar: () => null,
        Icon: () => null,
        Input: () => null,
        JsonSchemaForm: () => null,
        SearchInput: () => null,
        Select: () => null,
        Sender,
        SettingsSection: () => null,
        Switch: () => null
      }
    }

    await act(async () => {
      root.render(createElement(OneWorksChannelView, {
        ctx: { api: { fetch: apiFetch }, scope: 'channel-oneworks' },
        react: React,
        view
      }))
      await Promise.resolve()
    })

    const automaticLeader = container.querySelector<HTMLButtonElement>('[data-entity-id="oneworks:auto-leader"]')!
    const leaderA = container.querySelector<HTMLButtonElement>('[data-entity-id="leader-a"]')!
    const leaderB = container.querySelector<HTMLButtonElement>('[data-entity-id="leader-b"]')!
    expect(automaticLeader.getAttribute('role')).toBe('radio')
    expect(automaticLeader.getAttribute('aria-checked')).toBe('true')
    expect(automaticLeader.tabIndex).toBe(0)
    expect(automaticLeader.closest('.entity-card')?.querySelector('.entity-card__name.is-static')?.textContent)
      .toBe('Auto Leader')
    expect(leaderA.getAttribute('role')).toBe('radio')
    expect(leaderB.getAttribute('role')).toBe('radio')
    expect(leaderA.closest('.entity-card')?.querySelectorAll('.entity-card__related-entities .group-avatar'))
      .toHaveLength(
        2
      )
    expect(leaderA.tabIndex).toBe(-1)
    expect(leaderB.tabIndex).toBe(-1)

    const memberGroup = container.querySelector<HTMLElement>('[role="group"]')!
    expect(memberGroup.firstElementChild?.textContent).toContain('Start hiring')
    expect(memberGroup.firstElementChild?.textContent).toContain('Plenty of headcount—join the team.')
    await act(async () => leaderA.click())
    expect(leaderA.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('[data-entity-id="designer"]')?.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('[data-entity-id="engineer"]')?.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      leaderA.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    })
    expect(leaderA.getAttribute('aria-checked')).toBe('false')
    expect(leaderB.getAttribute('aria-checked')).toBe('true')
    expect(leaderA.tabIndex).toBe(-1)
    expect(leaderB.tabIndex).toBe(0)
    expect(document.activeElement).toBe(leaderB)

    const leaderDetails = leaderB.closest('.entity-card')?.querySelector<HTMLButtonElement>('.entity-card__name')
    leaderDetails?.focus()
    leaderDetails?.click()
    expect(document.activeElement).toBe(leaderDetails)
    expect(navigate).toHaveBeenCalledWith('/knowledge/entities/leader-b')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="sender"]')!.click()
      await Promise.resolve()
    })
    expect(JSON.parse(String(apiFetch.mock.calls[0]?.[1]?.body))).toEqual({
      entityIds: ['designer', 'engineer'],
      leaderEntityId: 'leader-b',
      leaderMode: 'entity',
      message: 'Build the roadmap'
    })
    expect(mutate).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith(
      '/plugins/channel-oneworks/oneworks-channel/rooms/room-created'
    )
  })

  it('uses the built-in Auto Leader when no entity leader is selected', async () => {
    const clientModulePath = '../../../packages/plugins/channel-oneworks/client/src/index.tsx'
    const { OneWorksChannelView } = await import(/* @vite-ignore */ clientModulePath)
    const apiFetch = vi.fn(async (_input: string, _init?: RequestInit) => ({
      json: async () => ({ roomId: 'automatic-room' }),
      ok: true
    }))
    const data = {
      entities: [{
        description: 'Builds features',
        entityId: 'engineer',
        name: 'Engineer',
        relatedEntityIds: [],
        source: 'project',
        teamRole: 'member'
      }],
      roomConnectionCandidates: [],
      rooms: [],
      scenarios: [],
      sharedRooms: [],
      shareOwners: [],
      shares: [],
      simulationTargets: [],
      trace: []
    }
    const Sender = (props: TestSenderProps) =>
      createElement(
        'button',
        {
          'data-placeholder': props.placeholder,
          'data-testid': 'sender',
          onClick: () => props.onSend('Build the release'),
          type: 'button'
        },
        'Send'
      )
    const view = {
      data: { useQuery: () => ({ data, isLoading: false, mutate: vi.fn() }) },
      i18n: { resolveText: (value: { en: string }) => value.en },
      route: {
        navigate: vi.fn(),
        setActions: vi.fn(),
        setBreadcrumb: vi.fn(),
        setIcon: vi.fn(),
        setLauncherChrome: vi.fn(),
        setSidePanel: vi.fn(),
        setSidebar: vi.fn(),
        setTitle: vi.fn()
      },
      ui: {
        AgentRoom: () => null,
        Button: () => null,
        ChannelPlatformIcon: () => null,
        EntityCard,
        EntitySummary: () => null,
        GroupAvatar: () => null,
        Icon: () => null,
        Input: () => null,
        JsonSchemaForm: () => null,
        SearchInput: () => null,
        Select: () => null,
        Sender,
        SettingsSection: () => null,
        Switch: () => null
      }
    }

    await act(async () => {
      root.render(createElement(OneWorksChannelView, {
        ctx: { api: { fetch: apiFetch }, scope: 'channel-oneworks' },
        react: React,
        view
      }))
      await Promise.resolve()
    })

    const sender = container.querySelector<HTMLButtonElement>('[data-testid="sender"]')!
    expect(sender.dataset.placeholder).toBe('Select at least one team member')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-entity-id="engineer"]')!.click())
    expect(sender.dataset.placeholder).toBe('Send the first message to create the group')

    await act(async () => {
      sender.click()
      await Promise.resolve()
    })
    expect(JSON.parse(String(apiFetch.mock.calls[0]?.[1]?.body))).toEqual({
      entityIds: ['engineer'],
      leaderMode: 'automatic',
      message: 'Build the release'
    })
  })
})
