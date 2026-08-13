/* eslint-disable max-lines -- the plugin owns its Room, scenario, and delivery-trace workbench. */
/// <reference types="vite/client" />

import { createSeededAvatarDataUri } from '@oneworks/avatar'

import { oneworksChannelCss } from './styles'

const asError = async response => {
  const payload = await response.json().catch(() => undefined)
  if (payload != null && typeof payload === 'object' && typeof payload.error === 'string') return payload.error
  return `Request failed with HTTP ${response.status}.`
}

const request = async (ctx, path, init = undefined) => {
  const response = await ctx.api.fetch(`product/${path}`, init)
  if (!response.ok) throw new Error(await asError(response))
  return await response.json()
}

const emptyData = () => ({
  entities: [],
  rooms: [],
  scenarios: [],
  sharedRooms: [],
  shareOwners: [],
  shares: [],
  simulationTargets: [],
  trace: []
})
const emptyDraft = roomRef => ({
  actorRole: 'admin',
  name: '',
  roomRef,
  sessionType: 'group',
  text: '',
  userLabel: 'operator'
})
const emptyShareDraft = () => ({
  access: 'collaborate',
  ownerRef: '',
  principalId: '',
  principalType: 'user',
  roomId: ''
})

const sharePermissions = {
  collaborate: ['view', 'send', 'target_member', 'open_run'],
  manage: ['view', 'send', 'target_member', 'open_run', 'approve', 'manage_share'],
  view: ['view']
}

const channelIconByType = {
  discord: 'forum',
  lark: 'flight',
  oneworks: 'all_inclusive',
  telegram: 'send',
  tg: 'send',
  wechat: 'chat'
}

const channelIcon = channelType => channelIconByType[channelType?.toLowerCase()] ?? 'hub'
const getWorkspaceResourceUrl = path => `/api/workspace/resource?path=${encodeURIComponent(path)}`
const roomSettingsJsonSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      titleI18n: { en: 'Group name', 'zh-Hans': '群名' },
      descriptionI18n: { en: 'Shown in the chat list and room header.', 'zh-Hans': '显示在群聊列表和群聊标题中。' },
      'x-oneworks-ui': { icon: 'title', placeholder: 'Group name' }
    },
    description: {
      type: 'string',
      format: 'textarea',
      titleI18n: { en: 'Introduction', 'zh-Hans': '介绍' },
      descriptionI18n: {
        en: 'Explain the room purpose and collaboration boundary.',
        'zh-Hans': '说明群聊用途和协作边界。'
      },
      'x-oneworks-ui': { icon: 'description', placeholder: 'What is this group for?' }
    },
    avatar: {
      type: 'string',
      titleI18n: { en: 'Custom avatar', 'zh-Hans': '自定义头像' },
      descriptionI18n: {
        en: 'Use a workspace path or URL. Leave empty to compose member avatars.',
        'zh-Hans': '填写工作区路径或 URL；留空时自动拼接成员头像。'
      },
      'x-oneworks-ui': {
        control: 'workspace-file',
        icon: 'image',
        placeholder: 'Workspace path or URL'
      }
    },
    isFavorited: {
      type: 'boolean',
      titleI18n: { en: 'Pin to favorites', 'zh-Hans': '收藏群聊' },
      descriptionI18n: { en: 'Keep this room easy to find.', 'zh-Hans': '将群聊保留在便于访问的位置。' },
      'x-oneworks-ui': { icon: 'star' }
    },
    isArchived: {
      type: 'boolean',
      titleI18n: { en: 'Archive', 'zh-Hans': '归档' },
      descriptionI18n: {
        en: 'Hide the room from active work without deleting history.',
        'zh-Hans': '从活跃工作中隐藏群聊，但保留历史记录。'
      },
      'x-oneworks-ui': { icon: 'archive' }
    }
  }
}

export const buildOneWorksChannelRoute = scope => `/plugins/${scope}/oneworks-channel`
export const buildOneWorksRoomRoute = (scope, roomId) =>
  `${buildOneWorksChannelRoute(scope)}/rooms/${encodeURIComponent(roomId)}`

const roomPanelKeys = ['members', 'details']

const readRoomPanelState = () => {
  const params = new URLSearchParams(globalThis.location.search)
  const activePanel = roomPanelKeys.includes(params.get('panel')) ? params.get('panel') : null
  const openedPanels = (params.get('panels') ?? '')
    .split(',')
    .filter(panel => roomPanelKeys.includes(panel))
  return {
    activePanel,
    openedPanels: activePanel == null || openedPanels.includes(activePanel)
      ? openedPanels
      : [...openedPanels, activePanel]
  }
}

const buildOneWorksRoomPanelRoute = (scope, roomId, activePanel, openedPanels) => {
  const params = new URLSearchParams()
  if (activePanel != null) params.set('panel', activePanel)
  if (openedPanels.length > 0) params.set('panels', openedPanels.join(','))
  const query = params.toString()
  return `${buildOneWorksRoomRoute(scope, roomId)}${query === '' ? '' : `?${query}`}`
}

const readRoomIdFromLocation = scope => {
  const marker = `${buildOneWorksChannelRoute(scope)}/rooms/`
  const markerIndex = globalThis.location.pathname.indexOf(marker)
  if (markerIndex < 0) return ''
  const encodedRoomId = globalThis.location.pathname.slice(markerIndex + marker.length).split('/')[0]
  try {
    return decodeURIComponent(encodedRoomId)
  } catch {
    return ''
  }
}

export function OneWorksChannelView({ ctx, react, view }) {
  const h = react.createElement
  const { useCallback, useEffect, useMemo, useState } = react
  const {
    AgentRoom,
    Button,
    EntityCard,
    EntitySummary,
    GroupAvatar,
    Icon,
    Input,
    JsonSchemaForm,
    SearchInput,
    Select,
    Sender,
    SettingsSection
  } = view.ui
  const [languageVersion, setLanguageVersion] = useState(0)
  const t = useMemo(() => (en, chinese) => view.i18n?.resolveText?.({ en, 'zh-Hans': chinese }, en) ?? en, [
    view.i18n,
    languageVersion
  ])
  const readActiveSection = useCallback(() => {
    const section = new URLSearchParams(globalThis.location.search).get('section')
    return ['playground', 'scenarios', 'shared', 'trace'].includes(section) ? section : 'rooms'
  }, [])
  const [activeTab, setActiveTab] = useState(readActiveSection)
  const initialRoomPanelState = useMemo(readRoomPanelState, [])
  const [activeRoomPanel, setActiveRoomPanel] = useState(initialRoomPanelState.activePanel)
  const [openedRoomPanels, setOpenedRoomPanels] = useState(initialRoomPanelState.openedPanels)
  const [selectedRoomId, setSelectedRoomId] = useState(() => readRoomIdFromLocation(ctx.scope))
  const [selectedRoomMemberId, setSelectedRoomMemberId] = useState('')
  const [selectedEntityIds, setSelectedEntityIds] = useState([])
  const [entityQuery, setEntityQuery] = useState('')
  const [sidebarQuery, setSidebarQuery] = useState('')
  const [roomSettings, setRoomSettings] = useState({
    avatar: '',
    description: '',
    isArchived: false,
    isFavorited: false,
    title: ''
  })
  const [confirmingRoomDelete, setConfirmingRoomDelete] = useState(false)
  const [draft, setDraft] = useState(() => emptyDraft(''))
  const [shareDraft, setShareDraft] = useState(emptyShareDraft)
  const [editingScenarioRef, setEditingScenarioRef] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [lastSimulation, setLastSimulation] = useState(null)
  const [notice, setNotice] = useState(null)
  const [working, setWorking] = useState(false)
  const pluginRoute = useMemo(() => buildOneWorksChannelRoute(ctx.scope), [ctx.scope])

  const {
    data: loadedData,
    error: queryError,
    isLoading: loading,
    mutate
  } = view.data.useQuery('oneworks-channel:overview', async () => {
    const [entities, rooms, sharedRooms, shareOwners, shares, simulationTargets, trace, scenarios] = await Promise.all([
      request(ctx, 'entities'),
      request(ctx, 'rooms'),
      request(ctx, 'shared'),
      request(ctx, 'share-owners'),
      request(ctx, 'shares'),
      request(ctx, 'simulation-targets'),
      request(ctx, 'trace'),
      request(ctx, 'scenarios')
    ])
    return { entities, rooms, scenarios, sharedRooms, shareOwners, shares, simulationTargets, trace }
  }, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true
  })
  const data = useMemo(() => loadedData ?? emptyData(), [loadedData])
  const error = actionError ?? (queryError == null
    ? null
    : queryError instanceof Error
    ? queryError.message
    : String(queryError))
  const sections = useMemo(() => [
    { key: 'rooms', label: t('Chat rooms', '聊天室'), icon: 'meeting_room' },
    { key: 'shared', label: t('Shared', '已分享'), icon: 'group' },
    { key: 'playground', label: t('Playground', '调试台'), icon: 'play_circle' },
    { key: 'scenarios', label: t('Scenarios', '场景'), icon: 'bookmark' },
    { key: 'trace', label: t('Trace', '链路'), icon: 'timeline' }
  ], [t])
  const entityById = useMemo(
    () => new Map(data.entities.map(entity => [entity.entityId, entity])),
    [data.entities]
  )
  const memberAvatarOverrides = useMemo(
    () => Object.fromEntries(data.entities.map(entity => [entity.entityId, entity.avatar ?? null])),
    [data.entities]
  )
  const resolveRoomMember = useCallback(member => {
    const entity = entityById.get(member.entityId)
    return entity == null
      ? member
      : {
        ...member,
        avatar: entity.avatar,
        description: entity.description ?? member.description,
        name: entity.name ?? member.name
      }
  }, [entityById])
  const selectedRoomFromData = useMemo(() => data.rooms.find(room => room.roomId === selectedRoomId), [
    data.rooms,
    selectedRoomId
  ])
  const [selectedRoomSnapshot, setSelectedRoomSnapshot] = useState(null)
  const selectedRoom = selectedRoomFromData ?? (
    selectedRoomSnapshot?.roomId === selectedRoomId ? selectedRoomSnapshot : undefined
  )
  const renderRoomAvatar = useCallback(room => (
    <GroupAvatar
      label={room.title}
      members={room.avatar
        ? [{ avatar: room.avatar, key: `room:${room.roomId}`, label: room.title }]
        : room.members.map(member => {
          const resolvedMember = resolveRoomMember(member)
          return {
            avatar: resolvedMember.avatar,
            key: resolvedMember.entityId,
            label: resolvedMember.name
          }
        })}
    />
  ), [GroupAvatar, resolveRoomMember])

  const setRoomPanel = useCallback(panelKey => {
    const nextActivePanel = activeRoomPanel === panelKey ? null : panelKey
    const nextOpenedPanels = openedRoomPanels.includes(panelKey)
      ? openedRoomPanels
      : [...openedRoomPanels, panelKey]
    setActiveRoomPanel(nextActivePanel)
    setOpenedRoomPanels(nextOpenedPanels)
    if (selectedRoomId !== '') {
      view.route?.navigate(
        buildOneWorksRoomPanelRoute(ctx.scope, selectedRoomId, nextActivePanel, nextOpenedPanels),
        { replace: true }
      )
    }
  }, [activeRoomPanel, ctx.scope, openedRoomPanels, selectedRoomId, view.route])

  const handleRoomPanelChange = useCallback((nextActiveTab, nextOpenedTabs) => {
    setActiveRoomPanel(nextActiveTab)
    setOpenedRoomPanels(nextOpenedTabs)
    if (selectedRoomId !== '') {
      view.route?.navigate(
        buildOneWorksRoomPanelRoute(ctx.scope, selectedRoomId, nextActiveTab, nextOpenedTabs),
        { replace: true }
      )
    }
  }, [ctx.scope, selectedRoomId, view.route])

  useEffect(() => {
    if (loading) return
    setSelectedRoomId(current => {
      const routedRoomId = readRoomIdFromLocation(ctx.scope)
      if (routedRoomId) return routedRoomId
      return data.rooms.some(room => room.roomId === current) ? current : ''
    })
    const firstTarget = data.simulationTargets.find(target => target.capabilities?.includes('simulation'))
    setDraft(current => ({ ...current, roomRef: current.roomRef || firstTarget?.roomRef || '' }))
  }, [ctx.scope, data.rooms, data.simulationTargets, loading])
  useEffect(() => {
    if (selectedRoomFromData != null) setSelectedRoomSnapshot(selectedRoomFromData)
  }, [selectedRoomFromData])
  useEffect(() => {
    setSelectedRoomSnapshot(current => current?.roomId === selectedRoomId ? current : null)
    setSelectedRoomMemberId('')
  }, [selectedRoomId])
  useEffect(() => view.i18n?.subscribe?.(() => setLanguageVersion(value => value + 1))?.dispose, [view.i18n])
  useEffect(() => {
    const syncRoute = () => {
      const roomPanelState = readRoomPanelState()
      setActiveTab(readActiveSection())
      setSelectedRoomId(readRoomIdFromLocation(ctx.scope))
      setActiveRoomPanel(roomPanelState.activePanel)
      setOpenedRoomPanels(roomPanelState.openedPanels)
    }
    globalThis.addEventListener('oneworks:plugin-route-change', syncRoute)
    return () => globalThis.removeEventListener('oneworks:plugin-route-change', syncRoute)
  }, [ctx.scope, readActiveSection])
  useEffect(() => {
    const activeSection = sections.find(section => section.key === activeTab)
    if (activeTab === 'rooms' || activeSection == null) {
      view.route?.setTitle(selectedRoom?.title ?? t('Create group chat', '创建群聊'))
      view.route?.setBreadcrumb(undefined)
    } else {
      view.route?.setTitle(activeSection.label)
      view.route?.setBreadcrumb({
        currentTitle: activeSection.label,
        onBack: () => {
          view.route?.navigate(pluginRoute)
          setShareDraft(emptyShareDraft())
        },
        parentTitle: t('Team chats', '团队群聊')
      })
    }
  }, [activeTab, loading, pluginRoute, sections, selectedRoom?.title, t, view.route])
  useEffect(() => {
    view.route?.setIcon(
      activeTab === 'rooms' && selectedRoom != null
        ? renderRoomAvatar(selectedRoom)
        : undefined
    )
  }, [activeTab, renderRoomAvatar, selectedRoom, view.route])
  useEffect(() => () => {
    view.route?.setBreadcrumb(undefined)
    view.route?.setIcon(undefined)
    view.route?.setTitle(undefined)
  }, [view.route])
  useEffect(() => {
    if (!sections.some(section => section.key === activeTab)) setActiveTab('rooms')
  }, [activeTab, sections])

  const simulationRooms = useMemo(
    () => data.simulationTargets.filter(target => target.capabilities?.includes('simulation')),
    [data.simulationTargets]
  )
  const roomOptions = useMemo(
    () => simulationRooms.map(room => ({ label: `${room.channelType} · ${room.label}`, value: room.roomRef })),
    [simulationRooms]
  )
  const selectedSimulationRoom = useMemo(() => simulationRooms.find(room => room.roomRef === draft.roomRef), [
    draft.roomRef,
    simulationRooms
  ])
  const sidebarRooms = useMemo(() => {
    const query = sidebarQuery.trim().toLowerCase()
    if (!query) return data.rooms
    return data.rooms.filter(room =>
      [
        room.title,
        room.lastMessage,
        room.status,
        room.archived ? t('Archived', '已归档') : t('Active', '进行中'),
        ...room.platforms.flatMap(platform => [platform.channelType, ...platform.labels])
      ].filter(Boolean).some(value => String(value).toLowerCase().includes(query))
    )
  }, [data.rooms, sidebarQuery, t])
  const visibleEntities = useMemo(() => {
    const query = entityQuery.trim().toLowerCase()
    if (!query) return data.entities
    return data.entities.filter(entity =>
      [entity.name, entity.description, entity.entityId]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query))
    )
  }, [data.entities, entityQuery])
  const updateDraft = (field, value) => setDraft(current => ({ ...current, [field]: value }))

  const toggleEntity = entityId => {
    setSelectedEntityIds(current =>
      current.includes(entityId)
        ? current.filter(id => id !== entityId)
        : [...current, entityId]
    )
  }

  const createRoom = async (message) => {
    const text = message.trim()
    if (!text || selectedEntityIds.length === 0 || working) return false
    setWorking(true)
    setActionError(null)
    setNotice(null)
    try {
      const room = await request(ctx, 'rooms', {
        body: JSON.stringify({ entityIds: selectedEntityIds, message: text }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      })
      await mutate()
      setSelectedRoomId(room.roomId)
      setSelectedEntityIds([])
      view.route?.navigate(buildOneWorksRoomRoute(ctx.scope, room.roomId))
      return true
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError))
      return false
    } finally {
      setWorking(false)
    }
  }

  const execute = async (action, successMessage, onSuccess = undefined) => {
    setWorking(true)
    setActionError(null)
    setNotice(null)
    try {
      const result = await action()
      onSuccess?.(result)
      setNotice(successMessage)
      await mutate()
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setWorking(false)
    }
  }

  const runSimulation = async () =>
    await execute(
      () =>
        request(ctx, 'simulate', {
          body: JSON.stringify({
            actorRole: draft.actorRole,
            roomRef: draft.roomRef,
            sessionType: draft.sessionType,
            text: draft.text,
            userLabel: draft.userLabel
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST'
        }),
      t('Simulation submitted.', '模拟消息已提交。'),
      setLastSimulation
    )

  const resetScenarioDraft = () => {
    setEditingScenarioRef(null)
    setDraft(emptyDraft(simulationRooms[0]?.roomRef || ''))
  }

  const saveScenario = async () =>
    await execute(
      () =>
        request(
          ctx,
          editingScenarioRef == null
            ? 'scenarios'
            : `scenarios/${encodeURIComponent(editingScenarioRef)}`,
          {
            body: JSON.stringify(draft),
            headers: { 'content-type': 'application/json' },
            method: editingScenarioRef == null ? 'POST' : 'PATCH'
          }
        ),
      editingScenarioRef == null ? t('Scenario saved.', '场景已保存。') : t('Scenario updated.', '场景已更新。'),
      resetScenarioDraft
    )

  const editScenario = scenario => {
    setEditingScenarioRef(scenario.scenarioRef)
    setDraft({
      actorRole: scenario.actorRole,
      name: scenario.name,
      roomRef: scenario.roomRef,
      sessionType: scenario.sessionType,
      text: scenario.text,
      userLabel: scenario.userLabel
    })
  }

  const openRoom = useCallback(room => {
    setSelectedRoomId(room.roomId)
    view.route?.navigate(buildOneWorksRoomRoute(ctx.scope, room.roomId))
  }, [ctx.scope, view.route])

  const createShare = async () =>
    await execute(
      () =>
        request(ctx, `rooms/${encodeURIComponent(shareDraft.roomId)}/shares`, {
          body: JSON.stringify({
            grants: [{
              permissions: sharePermissions[shareDraft.access],
              principalId: shareDraft.principalId,
              principalType: shareDraft.principalType
            }],
            ownerRef: shareDraft.ownerRef
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST'
        }),
      t('Room shared.', '房间已分享。'),
      () => setShareDraft(emptyShareDraft())
    )

  const openShareEditor = useCallback(room => {
    setActiveTab('rooms')
    setShareDraft({
      ...emptyShareDraft(),
      ownerRef: room.ownerRef || (data.shareOwners.length === 1 ? data.shareOwners[0].ownerRef : ''),
      roomId: room.roomId
    })
  }, [data.shareOwners])

  useEffect(() => {
    view.route?.setSidebar({
      activeKey: activeTab === 'rooms' ? selectedRoomId : undefined,
      ariaLabel: t('Team chats', '团队群聊'),
      emptyText: loading
        ? t('Loading chat rooms...', '正在加载聊天室...')
        : sidebarQuery.trim()
        ? t('No matching chat rooms.', '没有匹配的聊天室。')
        : t('No chat rooms yet.', '暂无聊天室。'),
      groups: [{
        items: sidebarRooms.map(room => ({
          icon: renderRoomAvatar(room),
          key: room.roomId,
          label: room.title,
          searchText: [
            room.title,
            room.lastMessage,
            ...room.platforms.flatMap(platform => [platform.channelType, ...platform.labels])
          ].filter(Boolean).join(' ')
        })),
        key: 'rooms'
      }],
      search: {
        onChange: setSidebarQuery,
        placeholder: t('Search chat rooms', '搜索聊天室'),
        value: sidebarQuery
      },
      onSelectItem: item => {
        setSelectedRoomId(item.key)
        view.route?.navigate(buildOneWorksRoomRoute(ctx.scope, item.key))
        setShareDraft(emptyShareDraft())
      }
    })
    return () => view.route?.setSidebar(undefined)
  }, [activeTab, ctx.scope, loading, renderRoomAvatar, selectedRoomId, sidebarQuery, sidebarRooms, t, view.route])

  useEffect(() => {
    if (selectedRoom == null || activeTab !== 'rooms') {
      setActiveRoomPanel(null)
      setOpenedRoomPanels([])
    }
  }, [activeTab, selectedRoom])

  useEffect(() => {
    setRoomSettings({
      avatar: selectedRoom?.avatar ?? '',
      description: selectedRoom?.description ?? '',
      isArchived: selectedRoom?.archived ?? false,
      isFavorited: selectedRoom?.favorited ?? false,
      title: selectedRoom?.title ?? ''
    })
    setConfirmingRoomDelete(false)
  }, [
    selectedRoom?.archived,
    selectedRoom?.avatar,
    selectedRoom?.description,
    selectedRoom?.favorited,
    selectedRoom?.roomId,
    selectedRoom?.title
  ])

  useEffect(() => {
    if (activeRoomPanel !== 'details') setConfirmingRoomDelete(false)
  }, [activeRoomPanel])

  const renderRoomMember = member => {
    const resolvedMember = resolveRoomMember(member)
    return (
      <button
        className='oneworks-channel__panel-member'
        key={resolvedMember.entityId}
        type='button'
        onClick={() => setSelectedRoomMemberId(resolvedMember.entityId)}
      >
        {renderEntityAvatar(resolvedMember)}
        <span className='oneworks-channel__panel-member-copy'>
          <strong>{resolvedMember.name}</strong>
          {resolvedMember.description ? <span>{resolvedMember.description}</span> : null}
        </span>
        <Icon name='chevron_right' size='small' />
      </button>
    )
  }

  const saveRoomSettings = useCallback(nextSettings => {
    if (selectedRoom == null || !nextSettings.title.trim()) return
    setActionError(null)
    setNotice(null)
    void request(ctx, `rooms/${encodeURIComponent(selectedRoom.roomId)}`, {
      body: JSON.stringify({
        avatar: nextSettings.avatar.trim() || null,
        description: nextSettings.description.trim() || null,
        isArchived: nextSettings.isArchived,
        isFavorited: nextSettings.isFavorited,
        title: nextSettings.title.trim()
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    })
      .then(() => mutate())
      .catch(nextError => {
        setActionError(nextError instanceof Error ? nextError.message : String(nextError))
      })
  }, [ctx, mutate, selectedRoom])

  useEffect(() => {
    const roomActions = selectedRoom == null || activeTab !== 'rooms'
      ? []
      : [{
        active: activeRoomPanel === 'members',
        icon: 'group',
        key: 'room-members',
        label: t('Members', '群成员'),
        onSelect: () => setRoomPanel('members'),
        title: t('Members', '群成员')
      }, {
        active: activeRoomPanel === 'details',
        icon: 'settings',
        key: 'room-details',
        label: t('Settings', '设置'),
        onSelect: () => setRoomPanel('details'),
        title: t('Settings', '设置')
      }, {
        icon: 'more_horiz',
        key: 'room-more',
        label: t('More', '更多'),
        menuItems: [{
          icon: 'share',
          key: 'share-room',
          label: t('Share Room', '分享聊天室'),
          onSelect: () => openShareEditor(selectedRoom)
        }, {
          icon: roomSettings.isFavorited ? 'star' : 'star_border',
          key: 'favorite-room',
          label: roomSettings.isFavorited
            ? t('Remove from favorites', '取消收藏')
            : t('Add to favorites', '收藏群聊'),
          onSelect: () =>
            saveRoomSettings({
              ...roomSettings,
              isFavorited: !roomSettings.isFavorited
            })
        }, {
          icon: roomSettings.isArchived ? 'unarchive' : 'archive',
          key: 'archive-room',
          label: roomSettings.isArchived
            ? t('Unarchive', '取消归档')
            : t('Archive', '归档'),
          onSelect: () =>
            saveRoomSettings({
              ...roomSettings,
              isArchived: !roomSettings.isArchived
            })
        }],
        title: t('More', '更多')
      }]
    view.route?.setActions(roomActions)
    return () => view.route?.setActions(undefined)
  }, [
    activeRoomPanel,
    activeTab,
    openShareEditor,
    roomSettings,
    saveRoomSettings,
    selectedRoom,
    setRoomPanel,
    t,
    view.route
  ])

  const deleteRoom = () => {
    if (selectedRoom == null) return
    if (!confirmingRoomDelete) {
      setConfirmingRoomDelete(true)
      return
    }
    void execute(
      () => request(ctx, `rooms/${encodeURIComponent(selectedRoom.roomId)}`, { method: 'DELETE' }),
      t('Chat room deleted.', '群聊已删除。'),
      () => {
        setActiveRoomPanel(null)
        setOpenedRoomPanels([])
        setSelectedRoomId('')
        view.route?.navigate(pluginRoute)
      }
    )
  }

  useEffect(() => {
    if (selectedRoom == null || activeTab !== 'rooms' || activeRoomPanel == null) {
      view.route?.setSidePanel(undefined)
      return () => view.route?.setSidePanel(undefined)
    }

    const selectedRoomMemberSnapshot = selectedRoom.members.find(member => member.entityId === selectedRoomMemberId)
    const selectedRoomMember = selectedRoomMemberSnapshot == null
      ? undefined
      : resolveRoomMember(selectedRoomMemberSnapshot)
    const roomPlatformSummary = selectedRoom.platforms.length === 0
      ? t('OneWorks local', 'OneWorks 本地')
      : selectedRoom.platforms
        .flatMap(platform => platform.labels.length === 0 ? [platform.channelType] : platform.labels)
        .join(' · ')

    view.route?.setSidePanel({
      activeTab: activeRoomPanel,
      ariaLabel: t('Chat room panel', '群聊面板'),
      openedTabs: openedRoomPanels,
      tabs: [{
        content: <div className='oneworks-channel__side-content is-members'>
          {selectedRoomMember == null
            ? <div className='oneworks-channel__panel-members'>
              {selectedRoom.members.map(renderRoomMember)}
            </div>
            : <EntitySummary
              avatar={selectedRoomMember.avatar}
              contextLabel={t('Member in this chat', '当前群聊成员')}
              description={selectedRoomMember.description}
              entityId={selectedRoomMember.entityId}
              items={[{
                icon: 'meeting_room',
                label: t('Chat room', '所在群聊'),
                value: selectedRoom.title
              }, {
                icon: 'hub',
                label: t('Available through', '关联渠道'),
                value: roomPlatformSummary
              }]}
              name={selectedRoomMember.name}
              openDetailsLabel={t('View full entity details', '查看完整实体详情')}
              onBack={() => setSelectedRoomMemberId('')}
              onOpenDetails={() =>
                view.route?.navigate(
                  `/knowledge/entities/${encodeURIComponent(selectedRoomMember.entityId)}`
                )}
            />}
        </div>,
        icon: 'group',
        key: 'members',
        label: t('Members', '群成员'),
        title: t('Members', '群成员')
      }, {
        content: <div className='oneworks-channel__side-content'>
          <div className='oneworks-channel__room-settings'>
            <div className='oneworks-channel__room-settings-summary'>
              <div className='oneworks-channel__room-settings-avatar'>
                {renderRoomAvatar({ ...selectedRoom, avatar: roomSettings.avatar.trim() || undefined })}
              </div>
              <span>
                <strong>{roomSettings.title || selectedRoom.title}</strong>
                <small>{roomSettings.description || t('No introduction yet.', '暂无群聊介绍。')}</small>
              </span>
            </div>
            <SettingsSection
              collapsible
              description={t('Room identity and lifecycle.', '群聊身份和生命周期。')}
              icon='tune'
              title={t('Chat room configuration', '群聊配置')}
            >
              <JsonSchemaForm
                jsonSchema={roomSettingsJsonSchema}
                value={roomSettings}
                onChange={setRoomSettings}
                onCommit={saveRoomSettings}
              />
            </SettingsSection>
            <SettingsSection
              description={t('This action permanently removes local history.', '此操作会永久移除本地历史。')}
              icon='warning'
              title={t('Danger zone', '危险操作')}
            >
              <Button
                className='oneworks-channel__danger-button'
                danger
                disabled={working}
                icon='delete'
                label={confirmingRoomDelete ? t('Confirm delete', '确认删除') : t('Delete', '删除')}
                onClick={deleteRoom}
                type='primary'
              />
            </SettingsSection>
            {confirmingRoomDelete
              ? <p className='oneworks-channel__room-settings-warning'>
                {t(
                  'Deleting permanently removes the room and its local history.',
                  '删除后将永久移除群聊及其本地历史。'
                )}
              </p>
              : null}
          </div>
        </div>,
        icon: 'settings',
        key: 'details',
        label: t('Settings', '设置'),
        title: t('Settings', '设置')
      }],
      onTabChange: handleRoomPanelChange
    })
    return () => view.route?.setSidePanel(undefined)
  }, [
    activeRoomPanel,
    activeTab,
    handleRoomPanelChange,
    openedRoomPanels,
    confirmingRoomDelete,
    pluginRoute,
    renderRoomAvatar,
    resolveRoomMember,
    roomSettings,
    selectedRoom,
    selectedRoomMemberId,
    t,
    view.route,
    working
  ])

  const renderRoomDetail = room =>
    room == null
      ? null
      : <div className='oneworks-channel__room-surface'>
        {renderShareEditor()}
        <AgentRoom
          className='oneworks-channel__room'
          inset={false}
          memberAvatarOverrides={memberAvatarOverrides}
          roomId={room.roomId}
        />
      </div>

  const renderEntityAvatar = entity =>
    <img
      alt=''
      className='oneworks-channel__entity-avatar'
      src={entity.avatar
        ? getWorkspaceResourceUrl(entity.avatar)
        : createSeededAvatarDataUri({ seed: `entity:${entity.entityId}`, size: 72, title: entity.name })}
    />

  const renderRoomCreator = () =>
    <div className='oneworks-channel__creator'>
      <div className='oneworks-channel__entity-picker'>
        <div className='oneworks-channel__entity-picker-content'>
          <div className='oneworks-channel__entity-picker-toolbar'>
            <p className='oneworks-channel__creator-hint'>
              {t('Choose the entities to invite', '选择要邀请进群的实体')}
            </p>
            <SearchInput
              allowClear
              ariaLabel={t('Search entities', '搜索实体')}
              onChange={setEntityQuery}
              placeholder={t('Search entities', '搜索实体')}
              size='small'
              value={entityQuery}
            />
          </div>
          <div className='oneworks-channel__entity-grid'>
            {visibleEntities.map(entity => {
              const selected = selectedEntityIds.includes(entity.entityId)
              return <EntityCard
                avatar={entity.avatar}
                description={entity.description}
                entityId={entity.entityId}
                key={entity.entityId}
                name={entity.name}
                selected={selected}
                onOpenDetails={() => view.route?.navigate(`/knowledge/entities/${encodeURIComponent(entity.entityId)}`)}
                onSelect={() => toggleEntity(entity.entityId)}
              />
            })}
            {visibleEntities.length === 0 && (
              <div className='oneworks-channel__entity-no-results'>
                {t('No matching entities.', '没有匹配的实体。')}
              </div>
            )}
            <button
              className='oneworks-channel__entity-card is-create'
              onClick={() => view.route?.navigate('/knowledge/entities?create=entity')}
              type='button'
            >
              <span className='oneworks-channel__entity-avatar is-create' aria-hidden='true'>
                <Icon name='add' />
              </span>
              <span className='oneworks-channel__entity-copy'>
                <strong>{t('Create entity', '创建实体')}</strong>
                <span>{t('Add another teammate', '添加新的团队成员')}</span>
              </span>
              <Icon name='arrow_forward' />
            </button>
          </div>
        </div>
      </div>
      <div className='oneworks-channel__creator-composer'>
        <Sender
          autoFocus
          density='compact'
          enableVoiceInput
          hideSelectionControls
          layout='adaptive'
          onSend={createRoom}
          placeholder={selectedEntityIds.length === 0
            ? t('Select at least one entity first', '请先选择至少一个实体')
            : t('Send the first message to create the group', '发送第一条消息，创建群聊')}
          showHeader={false}
          showStatusBar={false}
          submitLabel={t('Create group chat', '创建群聊')}
          submitLoading={working}
        />
      </div>
    </div>

  const renderShareEditor = () => {
    if (!shareDraft.roomId) return null
    const room = data.rooms.find(candidate => candidate.roomId === shareDraft.roomId)
    return <div className='oneworks-channel__share-editor'>
      <div className='oneworks-channel__share-heading'>
        <strong>{room?.title ?? t('Room', '聊天室')}</strong>
        <Button
          ariaLabel={t('Close', '关闭')}
          disabled={working}
          icon='close'
          onClick={() => setShareDraft(emptyShareDraft())}
          shape='circle'
          title={t('Close', '关闭')}
          type='text'
        />
      </div>
      <div className='oneworks-channel__share-fields'>
        <div className='oneworks-channel__field'>
          <label>{t('Relay owner', 'Relay 所有者')}</label>
          <Select
            ariaLabel={t('Relay owner', 'Relay 所有者')}
            disabled={working || data.shareOwners.length === 0}
            options={data.shareOwners.map(owner => ({ label: owner.label, value: owner.ownerRef }))}
            value={shareDraft.ownerRef}
            onChange={value => setShareDraft(current => ({ ...current, ownerRef: value }))}
          />
        </div>
        <div className='oneworks-channel__field'>
          <label>{t('Principal type', '主体类型')}</label>
          <Select
            ariaLabel={t('Principal type', '主体类型')}
            disabled={working}
            options={[
              { label: t('User', '用户'), value: 'user' },
              { label: t('Team', '团队'), value: 'team' }
            ]}
            value={shareDraft.principalType}
            onChange={value => setShareDraft(current => ({ ...current, principalType: value }))}
          />
        </div>
        <div className='oneworks-channel__field'>
          <label>{t('Principal ID', '主体 ID')}</label>
          <Input
            ariaLabel={t('Principal ID', '主体 ID')}
            disabled={working}
            value={shareDraft.principalId}
            onChange={value => setShareDraft(current => ({ ...current, principalId: value }))}
          />
        </div>
        <div className='oneworks-channel__field'>
          <label>{t('Access', '权限')}</label>
          <Select
            ariaLabel={t('Access', '权限')}
            disabled={working}
            options={[
              { label: t('View', '查看'), value: 'view' },
              { label: t('Collaborate', '协作'), value: 'collaborate' },
              { label: t('Manage', '管理'), value: 'manage' }
            ]}
            value={shareDraft.access}
            onChange={value => setShareDraft(current => ({ ...current, access: value }))}
          />
        </div>
      </div>
      <div className='oneworks-channel__actions'>
        <Button
          disabled={working || !shareDraft.ownerRef || !shareDraft.principalId.trim()}
          icon='share'
          label={t('Share', '分享')}
          onClick={() => void createShare()}
          type='primary'
        />
      </div>
    </div>
  }

  const renderShares = () =>
    data.sharedRooms.length === 0 && data.shares.length === 0
      ? <div className='oneworks-channel__empty'>
        <Icon name='group' />
        <span>{t('No shared Rooms.', '暂无已分享聊天室。')}</span>
      </div>
      : <div className='oneworks-channel__list'>
        {data.sharedRooms.map(room =>
          <div className='oneworks-channel__row' key={`remote:${room.shareRef}`}>
            <div className='oneworks-channel__row-main'>
              <div className='oneworks-channel__row-title'>{room.title}</div>
              <div className='oneworks-channel__row-detail'>{room.sourceLabel}</div>
            </div>
            <span className={`oneworks-channel__status is-${room.availability === 'online' ? 'connected' : 'idle'}`}>
              {room.availability === 'online' ? t('Online', '在线') : t('Offline', '离线')}
            </span>
          </div>
        )}
        {data.shares.map(share =>
          <div className='oneworks-channel__row' key={share.shareRef}>
            <button
              className='oneworks-channel__share-room-link'
              onClick={() => openRoom(share)}
              type='button'
            >
              <span className='oneworks-channel__row-title'>{share.roomTitle}</span>
              <span className='oneworks-channel__row-detail'>
                {share.grantCount} · {share.permissions.join(', ')}
              </span>
            </button>
            <div className='oneworks-channel__actions'>
              <span className={`oneworks-channel__status is-${share.status}`}>{share.status}</span>
              {share.status === 'active'
                ? <Button
                  ariaLabel={t('Revoke share', '撤销分享')}
                  danger
                  disabled={working}
                  icon='link_off'
                  onClick={() =>
                    void execute(
                      () =>
                        request(
                          ctx,
                          `rooms/${encodeURIComponent(share.roomId)}/shares/${encodeURIComponent(share.shareRef)}`,
                          { method: 'DELETE' }
                        ),
                      t('Share revoked.', '分享已撤销。')
                    )}
                  shape='circle'
                  title={t('Revoke share', '撤销分享')}
                  type='text'
                />
                : null}
            </div>
          </div>
        )}
      </div>

  const renderTrace = () =>
    data.trace.length === 0
      ? <div className='oneworks-channel__empty'>
        <Icon name='timeline' />
        <span>{t('No trace entries.', '暂无链路记录。')}</span>
      </div>
      : <div className='oneworks-channel__list'>
        {data.trace.map(row =>
          <div className='oneworks-channel__row' key={row.traceRef}>
            <div className='oneworks-channel__row-main'>
              <div className='oneworks-channel__row-title'>{row.reason}</div>
              <div className='oneworks-channel__row-detail'>{row.kind}</div>
            </div>
            <span className={`oneworks-channel__status is-${row.status}`}>{row.status}</span>
          </div>
        )}
      </div>

  const renderMessageFields = () =>
    <div className='oneworks-channel__playground-grid'>
      <div className='oneworks-channel__controls'>
        <div className='oneworks-channel__field'>
          <label>{t('OneWorks target', 'OneWorks 目标')}</label>
          <Select
            ariaLabel={t('OneWorks target', 'OneWorks 目标')}
            disabled={working || simulationRooms.length === 0}
            options={roomOptions}
            value={draft.roomRef}
            onChange={value => updateDraft('roomRef', value)}
          />
        </div>
        <div className='oneworks-channel__field'>
          <label>{t('Synthetic user', '模拟用户')}</label>
          <Input
            ariaLabel={t('Synthetic user', '模拟用户')}
            disabled={working}
            value={draft.userLabel}
            onChange={value => updateDraft('userLabel', value)}
          />
        </div>
        <div className='oneworks-channel__field'>
          <label>{t('Conversation', '会话')}</label>
          <Select
            ariaLabel={t('Conversation', '会话')}
            disabled={working}
            options={[
              { label: t('Group', '群聊'), value: 'group' },
              { label: t('Direct', '私聊'), value: 'direct' }
            ]}
            value={draft.sessionType}
            onChange={value => updateDraft('sessionType', value)}
          />
        </div>
        <div className='oneworks-channel__field'>
          <label>{t('Role', '身份')}</label>
          <Select
            ariaLabel={t('Role', '身份')}
            disabled={working}
            options={[
              { label: t('Administrator', '管理员'), value: 'admin' },
              { label: t('Participant', '普通成员'), value: 'participant' }
            ]}
            value={draft.actorRole}
            onChange={value => updateDraft('actorRole', value)}
          />
        </div>
        {selectedSimulationRoom != null
          ? <div className='oneworks-channel__target'>
            <span>{selectedSimulationRoom.channelType}</span>
            <strong>{selectedSimulationRoom.label}</strong>
          </div>
          : null}
      </div>
      <div className='oneworks-channel__composer'>
        <div className='oneworks-channel__field'>
          <label>{t('Message', '消息')}</label>
          <Input
            ariaLabel={t('Message', '消息')}
            disabled={working}
            rows={7}
            type='textarea'
            value={draft.text}
            onChange={value => updateDraft('text', value)}
          />
        </div>
        <div className='oneworks-channel__actions'>
          <Button
            disabled={working || !draft.roomRef || !draft.userLabel.trim() || !draft.text.trim()}
            icon='send'
            label={t('Run', '运行')}
            onClick={() => void runSimulation()}
            type='primary'
          />
        </div>
        {lastSimulation != null
          ? <div className='oneworks-channel__result' role='status'>
            <Icon
              name={lastSimulation.accepted ? 'check_circle' : 'error'}
              tone={lastSimulation.accepted
                ? 'success'
                : 'danger'}
            />
            <span>{lastSimulation.accepted ? t('Accepted', '已接收') : t('Rejected', '已拒绝')}</span>
            <code>HTTP {lastSimulation.status}</code>
          </div>
          : null}
      </div>
    </div>

  const renderScenarios = () =>
    <div className='oneworks-channel__scenario-layout'>
      <div className='oneworks-channel__scenario-editor'>
        <div className='oneworks-channel__field'>
          <label>{t('Scenario name', '场景名称')}</label>
          <Input
            ariaLabel={t('Scenario name', '场景名称')}
            disabled={working}
            value={draft.name}
            onChange={value => updateDraft('name', value)}
          />
        </div>
        {renderMessageFields()}
        <div className='oneworks-channel__actions'>
          <Button
            disabled={working || !draft.name.trim() || !draft.roomRef || !draft.userLabel.trim() || !draft.text.trim()}
            icon='save'
            label={editingScenarioRef == null ? t('Save', '保存') : t('Update', '更新')}
            onClick={() => void saveScenario()}
            type='primary'
          />
          {editingScenarioRef != null
            ? <Button disabled={working} icon='close' label={t('Cancel', '取消')} onClick={resetScenarioDraft} />
            : null}
        </div>
      </div>
      <div className='oneworks-channel__scenario-list'>
        {data.scenarios.length === 0
          ? <div className='oneworks-channel__empty'>
            <Icon name='bookmark_border' />
            <span>{t('No saved scenarios.', '暂无已保存场景。')}</span>
          </div>
          : data.scenarios.map(scenario =>
            <div className='oneworks-channel__row' key={scenario.scenarioRef}>
              <div className='oneworks-channel__row-main'>
                <div className='oneworks-channel__row-title'>{scenario.name}</div>
                <div className='oneworks-channel__row-detail'>{scenario.userLabel} · {scenario.sessionType}</div>
              </div>
              <div className='oneworks-channel__actions'>
                <Button
                  ariaLabel={t('Edit', '编辑')}
                  disabled={working}
                  icon='edit'
                  onClick={() => editScenario(scenario)}
                  shape='circle'
                  title={t('Edit', '编辑')}
                  type='text'
                />
                <Button
                  ariaLabel={t('Run', '运行')}
                  disabled={working}
                  icon='play_arrow'
                  onClick={() =>
                    void execute(
                      () =>
                        request(ctx, `scenarios/${encodeURIComponent(scenario.scenarioRef)}/run`, { method: 'POST' }),
                      t('Scenario submitted.', '场景已提交。'),
                      setLastSimulation
                    )}
                  shape='circle'
                  title={t('Run', '运行')}
                  type='text'
                />
                <Button
                  ariaLabel={t('Delete', '删除')}
                  danger
                  disabled={working}
                  icon='delete'
                  onClick={() =>
                    void execute(
                      () => request(ctx, `scenarios/${encodeURIComponent(scenario.scenarioRef)}`, { method: 'DELETE' }),
                      t('Scenario removed.', '场景已删除。')
                    )}
                  shape='circle'
                  title={t('Delete', '删除')}
                  type='text'
                />
              </div>
            </div>
          )}
      </div>
    </div>

  const hasScenarioTarget = data.simulationTargets.some(target => target.capabilities?.includes('scenarios'))
  const renderUnavailableTarget = () =>
    <div className='oneworks-channel__empty'>
      <Icon name='link_off' />
      <span>{t('No available OneWorks target.', '暂无可用的 OneWorks 目标。')}</span>
    </div>
  const content = loading
    ? <div className='oneworks-channel__empty'>
      <Icon name='progress_activity' />
    </div>
    : activeTab === 'rooms'
    ? selectedRoom == null ? renderRoomCreator() : renderRoomDetail(selectedRoom)
    : activeTab === 'shared'
    ? renderShares()
    : activeTab === 'playground'
    ? simulationRooms.length === 0
      ? renderUnavailableTarget()
      : <div className='oneworks-channel__form'>{renderMessageFields()}</div>
    : activeTab === 'scenarios'
    ? hasScenarioTarget ? renderScenarios() : renderUnavailableTarget()
    : renderTrace()

  const isRoomSurface = activeTab === 'rooms'

  return <section className={`oneworks-channel ${isRoomSurface ? 'is-room' : ''}`} aria-busy={loading}>
    <main className={`oneworks-channel__panel ${isRoomSurface ? 'is-room' : ''}`}>
      {error != null ? <p className='oneworks-channel__message is-error' role='alert'>{error}</p> : null}
      {notice != null ? <p className='oneworks-channel__message' role='status'>{notice}</p> : null}
      {content}
    </main>
  </section>
}

export async function activatePlugin(ctx) {
  const style = document.createElement('style')
  style.textContent = oneworksChannelCss
  document.head.appendChild(style)
  const disposables = [ctx.views.register('oneworks-channel', {
    renderNode: view => ctx.react.createElement(OneWorksChannelView, { ctx, react: ctx.react, view })
  })]
  if (/(?:^|\/)w\/[^/]+(?:\/|$)/u.test(globalThis.location?.pathname ?? '')) {
    const route = buildOneWorksChannelRoute(ctx.scope)
    disposables.push(ctx.slots.register('nav.items', {
      actions: [{
        id: 'shared',
        title: 'Shared',
        titleI18n: { en: 'Shared', 'zh-Hans': '已分享' },
        icon: 'group',
        route: `${route}?section=shared`
      }, {
        id: 'playground',
        title: 'Playground',
        titleI18n: { en: 'Playground', 'zh-Hans': '调试台' },
        icon: 'play_circle',
        route: `${route}?section=playground`
      }, {
        id: 'scenarios',
        title: 'Scenarios',
        titleI18n: { en: 'Scenarios', 'zh-Hans': '场景' },
        icon: 'bookmark',
        route: `${route}?section=scenarios`
      }, {
        id: 'trace',
        title: 'Trace',
        titleI18n: { en: 'Trace', 'zh-Hans': '链路' },
        icon: 'timeline',
        route: `${route}?section=trace`
      }],
      id: 'oneworks-channel',
      placement: 'beforeCore',
      title: 'Team Chats',
      titleI18n: { en: 'Team Chats', 'zh-Hans': '团队群聊' },
      descriptionI18n: {
        en: 'Open chat rooms, sharing, simulations, and delivery traces.',
        'zh-Hans': '打开聊天室、分享、模拟场景与投递链路。'
      },
      icon: 'meeting_room',
      route
    }))
  }
  return () => {
    disposables.forEach(disposable => disposable.dispose())
    style.remove()
  }
}
