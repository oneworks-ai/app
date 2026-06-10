import { readFileSync } from 'node:fs'

import { App as AntApp } from 'antd'
import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RoomItem, buildRoomUrl, createRoomOperationMenuEntries } from '#~/components/sidebar/RoomItem'
import type { SidebarRoomItem } from '#~/components/sidebar/conversation-items'
import en from '#~/resources/locales/en.json'

const createI18n = async () => {
  const i18n = createInstance()
  await i18n
    .use(initReactI18next)
    .init({
      lng: 'en',
      resources: {
        en: {
          translation: en
        }
      }
    })

  return i18n
}

const room: SidebarRoomItem = {
  id: 'room-sidebar-cleanup',
  title: 'Project orchestration hub with a long title that should stay inside the sidebar row',
  hostSessionId: 'host-session',
  status: 'active',
  lastMessage: 'Reviewer is checking the release plan.',
  createdAt: 10,
  updatedAt: 20,
  activeRunCount: 7,
  pendingCount: 5,
  sessionIds: ['host-session']
}

const renderRoomItem = async ({
  inputRoom = room,
  isCompactLayout = false,
  isTouchInteraction = false
}: {
  inputRoom?: SidebarRoomItem
  isCompactLayout?: boolean
  isTouchInteraction?: boolean
} = {}) => {
  const i18n = await createI18n()

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AntApp>
        <RoomItem
          room={inputRoom}
          isActive={false}
          isBatchMode={false}
          isCompactLayout={isCompactLayout}
          isSelected={false}
          isTouchInteraction={isTouchInteraction}
          onArchive={() => undefined}
          onFavorite={() => undefined}
          onSelect={() => undefined}
        />
      </AntApp>
    </I18nextProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('agent room sidebar card', () => {
  it('renders the room title without the label or statistics metadata', async () => {
    const html = await renderRoomItem()

    expect(html).toContain(room.title)
    expect(html).not.toContain('room-item__eyebrow')
    expect(html).not.toContain('Agent room')
    expect(html).not.toContain('7 active')
    expect(html).not.toContain('5 waiting')
    expect(html).not.toContain('room-item__stats')
    expect(html).not.toContain(room.lastMessage)
    expect(html).not.toContain('room-item__last-message')
    expect(html).toContain('room-pixel-avatar')
    expect(html).toContain('room-pixel-avatar__pixel')
    expect(html).not.toContain('>groups</span>')
  })

  it('keeps desktop room actions aligned with session card actions', async () => {
    const html = await renderRoomItem()

    expect(html).toContain('room-item__actions')
    expect(html).toContain('room-item__action-btn--favorite')
    expect(html).toContain('room-item__action-btn--archive')
    expect(html).toContain('room-item__action-btn--more')
    expect(html).toContain('>star</span>')
    expect(html).toContain('>archive</span>')
    expect(html).toContain('more_horiz')
  })

  it('collapses room actions into the more button in compact layouts', async () => {
    const html = await renderRoomItem({ isCompactLayout: true })

    expect(html).toContain('room-item__action-btn--more')
    expect(html).toContain('aria-label="More actions"')
    expect(html).toContain('more_horiz')
    expect(html).not.toContain('room-item__action-btn--favorite')
    expect(html).not.toContain('room-item__action-btn--archive')
  })

  it('keeps the room leading icon centered when the card has a latest message', () => {
    const styles = readFileSync(new URL('../src/components/sidebar/RoomItem.scss', import.meta.url), 'utf8')

    expect(styles).toContain('line-height: 1;')
    expect(styles).toContain('min-width: var(--room-actions-reserved-width);')
    expect(styles).toContain('.room-pixel-avatar')
    expect(styles).toContain('align-items: center;')
    expect(styles).toContain('align-self: center;')
    expect(styles).toContain('--room-item-avatar-size: var(--session-leading-size, 16px);')
    expect(styles).toContain('&.room-pixel-avatar')
    expect(styles).toContain('--room-pixel-avatar-radius: var(--room-item-avatar-radius);')
    expect(styles).toContain('& &__actions &__action-btn')
    expect(styles).toContain('box-shadow: none;')
    expect(styles).not.toContain('align-items: stretch;')
    expect(styles).not.toContain('align-self: stretch;')
  })

  it('renders a lightweight favorite marker without changing the truncated title', async () => {
    const html = await renderRoomItem({
      inputRoom: {
        ...room,
        favoritedAt: 30
      }
    })

    expect(html).toContain('room-item--favorited')
    expect(html).toContain('room-item__favorite-icon')
    expect(html).toContain('aria-label="Favorited room"')
    expect(html).toContain('room-item__title-text')
  })

  it('builds the room operation menu with favorite, archive, open, and copy actions', () => {
    const calls: string[] = []
    const entries = createRoomOperationMenuEntries({
      room,
      labels: {
        openRoom: 'Open room',
        favoriteRoom: 'Favorite room',
        archiveRoom: 'Archive room',
        confirmArchiveRoom: 'Confirm Archive room',
        copyRoomLink: 'Copy room link',
        copyRoomId: 'Copy room ID'
      },
      handlers: {
        onOpen: () => calls.push('open'),
        onFavorite: () => calls.push('favorite'),
        onArchive: () => calls.push('archive'),
        onCopyLink: () => calls.push('copy-link'),
        onCopyId: () => calls.push('copy-id')
      }
    })

    expect(entries.map(entry => entry.key)).toEqual([
      'open-room',
      'divider-metadata',
      'favorite-room',
      'archive-room',
      'divider-copy',
      'copy-room-link',
      'copy-room-id'
    ])
    expect(entries.find(entry => entry.key === 'favorite-room')).toMatchObject({
      label: 'Favorite room',
      icon: 'star_border'
    })
    expect(entries.find(entry => entry.key === 'archive-room')).toMatchObject({
      label: 'Archive room',
      confirmLabel: 'Confirm Archive room',
      icon: 'archive'
    })

    entries.find(entry => entry.key === 'favorite-room')?.onClick()
    entries.find(entry => entry.key === 'archive-room')?.onClick()
    entries.find(entry => entry.key === 'open-room')?.onClick()
    entries.find(entry => entry.key === 'copy-room-link')?.onClick()
    entries.find(entry => entry.key === 'copy-room-id')?.onClick()

    expect(calls).toEqual(['favorite', 'archive', 'open', 'copy-link', 'copy-id'])
  })

  it('uses unfavorite and unarchive icons for rooms with metadata timestamps', () => {
    const entries = createRoomOperationMenuEntries({
      room: {
        ...room,
        archivedAt: 40,
        favoritedAt: 30
      },
      labels: {
        openRoom: 'Open room',
        favoriteRoom: 'Unfavorite room',
        archiveRoom: 'Unarchive room',
        confirmArchiveRoom: 'Confirm Unarchive room',
        copyRoomLink: 'Copy room link',
        copyRoomId: 'Copy room ID'
      },
      handlers: {
        onOpen: () => undefined,
        onFavorite: () => undefined,
        onArchive: () => undefined,
        onCopyLink: () => undefined,
        onCopyId: () => undefined
      }
    })

    expect(entries.find(entry => entry.key === 'favorite-room')).toMatchObject({
      label: 'Unfavorite room',
      icon: 'star'
    })
    expect(entries.find(entry => entry.key === 'archive-room')).toMatchObject({
      label: 'Unarchive room',
      confirmLabel: 'Confirm Unarchive room',
      icon: 'unarchive'
    })
  })

  it('builds room operation links against the room route', () => {
    vi.stubGlobal('location', {
      origin: 'https://oneworks.test'
    })
    vi.stubGlobal('__ONEWORKS_PROJECT_RUNTIME_ENV__', {
      __ONEWORKS_PROJECT_CLIENT_BASE__: '/desk'
    })

    expect(buildRoomUrl(room.id)).toBe('https://oneworks.test/desk/rooms/room-sidebar-cleanup')
  })

  it('normalizes root client base when building room operation links', () => {
    vi.stubGlobal('location', {
      origin: 'https://oneworks.test'
    })
    vi.stubGlobal('__ONEWORKS_PROJECT_RUNTIME_ENV__', {
      __ONEWORKS_PROJECT_CLIENT_BASE__: '/'
    })

    expect(buildRoomUrl('room with space')).toBe('https://oneworks.test/rooms/room%20with%20space')
  })
})
