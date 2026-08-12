/* eslint-disable max-lines -- the plugin owns its Room, scenario, and delivery-trace workbench. */
/// <reference types="vite/client" />

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

function OneWorksChannelView({ ctx, react, view }) {
  const h = react.createElement
  const { useCallback, useEffect, useMemo, useState } = react
  const { AgentRoom, Button, Icon, Input, Select } = view.ui
  const [languageVersion, setLanguageVersion] = useState(0)
  const [data, setData] = useState(emptyData)
  const t = useMemo(() => (en, chinese) => view.i18n?.resolveText?.({ en, 'zh-Hans': chinese }, en) ?? en, [
    view.i18n,
    languageVersion
  ])
  const sections = useMemo(() => [
    { key: 'rooms', label: t('Chat rooms', '聊天室'), icon: 'meeting_room' },
    { key: 'shared', label: t('Shared', '已分享'), icon: 'group' },
    ...(data.simulationTargets.length > 0
      ? [{ key: 'playground', label: t('Playground', '调试台'), icon: 'play_circle' }]
      : []),
    ...(data.simulationTargets.some(target => target.capabilities?.includes('scenarios'))
      ? [{ key: 'scenarios', label: t('Scenarios', '场景'), icon: 'bookmark' }]
      : []),
    { key: 'trace', label: t('Trace', '链路'), icon: 'timeline' }
  ], [data.simulationTargets, t])
  const [activeTab, setActiveTab] = useState('rooms')
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [sidebarQuery, setSidebarQuery] = useState('')
  const [draft, setDraft] = useState(() => emptyDraft(''))
  const [shareDraft, setShareDraft] = useState(emptyShareDraft)
  const [editingScenarioRef, setEditingScenarioRef] = useState(null)
  const [error, setError] = useState(null)
  const [lastSimulation, setLastSimulation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rooms, sharedRooms, shareOwners, shares, simulationTargets, trace, scenarios] = await Promise.all([
        request(ctx, 'rooms'),
        request(ctx, 'shared'),
        request(ctx, 'share-owners'),
        request(ctx, 'shares'),
        request(ctx, 'simulation-targets'),
        request(ctx, 'trace'),
        request(ctx, 'scenarios')
      ])
      setData({ rooms, scenarios, sharedRooms, shareOwners, shares, simulationTargets, trace })
      setSelectedRoomId(current => rooms.some(room => room.roomId === current) ? current : rooms[0]?.roomId || '')
      const firstTarget = simulationTargets.find(target => target.capabilities?.includes('simulation'))
      setDraft(current => ({ ...current, roomRef: current.roomRef || firstTarget?.roomRef || '' }))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoading(false)
    }
  }, [ctx])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => view.i18n?.subscribe?.(() => setLanguageVersion(value => value + 1))?.dispose, [view.i18n])
  useEffect(() => {
    const activeSection = sections.find(section => section.key === activeTab)
    if (activeTab === 'rooms' || activeSection == null) {
      view.route?.setTitle(t('Chat Rooms', '聊天室'))
      view.route?.setBreadcrumb(undefined)
    } else {
      view.route?.setTitle(activeSection.label)
      view.route?.setBreadcrumb({
        currentTitle: activeSection.label,
        onBack: () => {
          setActiveTab('rooms')
          setShareDraft(emptyShareDraft())
        },
        parentTitle: t('Chat Rooms', '聊天室')
      })
    }
    return () => {
      view.route?.setBreadcrumb(undefined)
      view.route?.setTitle(undefined)
    }
  }, [activeTab, sections, t, view.route])
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
  const selectedRoom = useMemo(() => data.rooms.find(room => room.roomId === selectedRoomId), [
    data.rooms,
    selectedRoomId
  ])
  const sidebarRooms = useMemo(() => {
    const query = sidebarQuery.trim().toLowerCase()
    if (!query) return data.rooms
    return data.rooms.filter(room =>
      [
        room.title,
        room.lastMessage,
        ...room.platforms.flatMap(platform => [platform.channelType, ...platform.labels])
      ].filter(Boolean).some(value => String(value).toLowerCase().includes(query))
    )
  }, [data.rooms, sidebarQuery])
  const updateDraft = (field, value) => setDraft(current => ({ ...current, [field]: value }))

  const execute = async (action, successMessage, onSuccess = undefined) => {
    setWorking(true)
    setError(null)
    setNotice(null)
    try {
      const result = await action()
      onSuccess?.(result)
      setNotice(successMessage)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
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
    const workspacePrefix = globalThis.location.pathname.match(/^\/ui\/w\/[^/]+/u)?.[0] ?? ''
    globalThis.location.assign(`${workspacePrefix}/rooms/${encodeURIComponent(room.roomId)}`)
  }, [])

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
      ariaLabel: t('Chat rooms', '聊天室'),
      emptyText: loading
        ? t('Loading chat rooms...', '正在加载聊天室...')
        : sidebarQuery.trim()
        ? t('No matching chat rooms.', '没有匹配的聊天室。')
        : t('No chat rooms yet.', '暂无聊天室。'),
      groups: [{
        items: sidebarRooms.map(room => ({
          icon: channelIcon(room.platforms[0]?.channelType),
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
        setActiveTab('rooms')
        setShareDraft(emptyShareDraft())
      }
    })
    return () => view.route?.setSidebar(undefined)
  }, [activeTab, loading, selectedRoomId, sidebarQuery, sidebarRooms, t, view.route])

  useEffect(() => {
    const sectionActions = sections.filter(section => section.key !== activeTab).map(section => ({
      active: activeTab === section.key,
      icon: section.icon,
      key: `section:${section.key}`,
      label: section.label,
      onSelect: () => {
        setActiveTab(section.key)
        setShareDraft(emptyShareDraft())
      },
      title: section.label
    }))
    const roomActions = selectedRoom == null || activeTab !== 'rooms'
      ? []
      : [{
        icon: 'open_in_new',
        key: 'open-room',
        label: t('Open Room', '打开聊天室'),
        onSelect: () => openRoom(selectedRoom),
        title: t('Open Room', '打开聊天室')
      }, {
        active: shareDraft.roomId === selectedRoom.roomId,
        icon: 'share',
        key: 'share-room',
        label: t('Share Room', '分享聊天室'),
        onSelect: () => openShareEditor(selectedRoom),
        title: t('Share Room', '分享聊天室')
      }]
    view.route?.setActions([
      ...sectionActions,
      ...roomActions,
      {
        disabled: loading || working,
        icon: 'refresh',
        key: 'refresh',
        label: t('Refresh', '刷新'),
        loading,
        onSelect: () => void load(),
        title: t('Refresh', '刷新')
      }
    ])
    return () => view.route?.setActions(undefined)
  }, [
    activeTab,
    load,
    loading,
    openRoom,
    openShareEditor,
    sections,
    selectedRoom,
    shareDraft.roomId,
    t,
    view.route,
    working
  ])

  const renderRoomDetail = room =>
    room == null
      ? null
      : <div className='oneworks-channel__room-surface'>
        {renderShareEditor()}
        <AgentRoom className='oneworks-channel__room' inset={false} roomId={room.roomId} />
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

  const content = loading
    ? <div className='oneworks-channel__empty'>
      <Icon name='progress_activity' />
    </div>
    : activeTab === 'rooms'
    ? renderRoomDetail(selectedRoom)
    : activeTab === 'shared'
    ? renderShares()
    : activeTab === 'playground'
    ? <div className='oneworks-channel__form'>{renderMessageFields()}</div>
    : activeTab === 'scenarios'
    ? renderScenarios()
    : renderTrace()

  const isRoomSurface = activeTab === 'rooms'

  return <section className={`oneworks-channel ${isRoomSurface ? 'is-room' : ''}`} aria-busy={loading}>
    <main className={`oneworks-channel__panel ${isRoomSurface ? 'is-room' : ''}`}>
      {isRoomSurface
        ? null
        : <div className='oneworks-channel__heading'>
          <h2>{sections.find(section => section.key === activeTab)?.label}</h2>
        </div>}
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
    disposables.push(ctx.slots.register('nav.items', {
      id: 'oneworks-channel',
      title: 'Chat Rooms',
      titleI18n: { en: 'Chat Rooms', 'zh-Hans': '聊天室' },
      descriptionI18n: {
        en: 'Open chat rooms, sharing, simulations, and delivery traces.',
        'zh-Hans': '打开聊天室、分享、模拟场景与投递链路。'
      },
      icon: 'meeting_room',
      route: `/plugins/${ctx.scope}/oneworks-channel`
    }))
  }
  return () => {
    disposables.forEach(disposable => disposable.dispose())
    style.remove()
  }
}
