/* eslint-disable max-lines -- Entity detail coordinates one shared runtime draft across role, channel, room, config, and memory tabs. */
import './EntityDetailView.scss'

import { App, Button, Empty, Input, Modal, Spin, Switch, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import {
  createEntityChannelLink,
  createEntityDocument,
  deleteEntityChannelLink,
  getEntityDetail,
  getEntityRuntime,
  updateEntityChannelAccount,
  updateEntityConfig,
  updateEntityMemory
} from '#~/api'
import { MarkdownContent } from '#~/components/MarkdownContent'
import { ActionSearchFilterPanel } from '#~/components/action-search-toolbar/ActionSearchFilterPanel'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { ChannelPlatformIcon } from '#~/components/channel-platform-icon/ChannelPlatformIcon'
import { WorkspaceFileEditorView } from '#~/components/chat/workspace-file-editor/WorkspaceFileEditorView'
import type { WorkspaceFileEditorActions } from '#~/components/chat/workspace-file-editor/WorkspaceFileEditorView'
import { SchemaObjectEditor } from '#~/components/config/record-editors/SchemaObjectEditor'
import { EntitySummary } from '#~/components/entity-summary'
import { GroupAvatar } from '#~/components/group-avatar/GroupAvatar'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { NativeTabs } from '#~/components/native-tabs/NativeTabs'
import { buildConfigUiSchemaFromJsonSchema } from '#~/components/plugins/plugin-config-json-schema'
import type { EntityRuntimeDetail } from '@oneworks/types'
import type { KnowledgeEntityPage } from '../knowledge-routes'

const channelLabelByType: Record<string, string> = {
  discord: 'Discord',
  lark: '飞书',
  oneworks: 'OneWorks',
  telegram: 'Telegram',
  tg: 'Telegram',
  wechat: '微信'
}

const getChannelLabel = (type: string) => channelLabelByType[type.toLowerCase()] ?? type

const normalizeSearchQuery = (value: string) => value.trim().toLocaleLowerCase()

const matchesSearchQuery = (query: string, values: unknown[]) => (
  query === '' || values.some(value => String(value ?? '').toLocaleLowerCase().includes(query))
)

const entityDocumentPresentation: Record<
  EntityRuntimeDetail['documents'][number]['kind'],
  { icon: string; labelKey: string }
> = {
  identity: { icon: 'badge', labelKey: 'knowledge.entities.documentIdentity' },
  soul: { icon: 'favorite', labelKey: 'knowledge.entities.documentSoul' },
  role: { icon: 'person', labelKey: 'knowledge.entities.documentRole' },
  operations: { icon: 'account_tree', labelKey: 'knowledge.entities.documentOperations' },
  tools: { icon: 'build', labelKey: 'knowledge.entities.documentTools' },
  knowledge: { icon: 'library_books', labelKey: 'knowledge.entities.documentKnowledge' },
  memoryPolicy: { icon: 'policy', labelKey: 'knowledge.entities.documentMemoryPolicy' },
  memory: { icon: 'keep', labelKey: 'knowledge.entities.documentMemory' }
}

export function EntityDetailView({
  activePage,
  entityId,
  onNavigatePage,
  path,
  resolving = false
}: {
  activePage: KnowledgeEntityPage
  entityId: string
  onNavigatePage: (page: KnowledgeEntityPage) => void
  path?: string
  resolving?: boolean
}) {
  const { i18n, t } = useTranslation()
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const [editingPath, setEditingPath] = useState<string>()
  const [editorActions, setEditorActions] = useState<WorkspaceFileEditorActions>()
  const [selectedDocumentKind, setSelectedDocumentKind] = useState<
    EntityRuntimeDetail['documents'][number]['kind']
  >('role')
  const [documentQuery, setDocumentQuery] = useState('')
  const [effectiveContextOpen, setEffectiveContextOpen] = useState(false)
  const [documentCreating, setDocumentCreating] = useState(false)
  const [channelQuery, setChannelQuery] = useState('')
  const [channelFiltersOpen, setChannelFiltersOpen] = useState(false)
  const [channelTypeFilter, setChannelTypeFilter] = useState('all')
  const [channelStatusFilter, setChannelStatusFilter] = useState('all')
  const [channelLinkOpen, setChannelLinkOpen] = useState(false)
  const [channelLinkSaving, setChannelLinkSaving] = useState(false)
  const [channelLinkDraft, setChannelLinkDraft] = useState({
    channelKey: '',
    description: '',
    externalId: '',
    externalType: 'chat',
    name: ''
  })
  const [roomQuery, setRoomQuery] = useState('')
  const [roomFiltersOpen, setRoomFiltersOpen] = useState(false)
  const [roomStatusFilter, setRoomStatusFilter] = useState('all')
  const [roomArchiveFilter, setRoomArchiveFilter] = useState('all')
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memoryFiltersOpen, setMemoryFiltersOpen] = useState(false)
  const [memorySubjectFilter, setMemorySubjectFilter] = useState('all')
  const [memorySensitivityFilter, setMemorySensitivityFilter] = useState('all')
  const [memoryPinnedFilter, setMemoryPinnedFilter] = useState('all')
  const [memoryTagFilter, setMemoryTagFilter] = useState<string[]>([])
  const [memoryConversationTypeFilter, setMemoryConversationTypeFilter] = useState<string[]>([])
  const [memoryEntityFilter, setMemoryEntityFilter] = useState<string[]>([])
  const [memoryOrgFilter, setMemoryOrgFilter] = useState<string[]>([])
  const [memoryRoomFilter, setMemoryRoomFilter] = useState<string[]>([])
  const [memoryChannelFilter, setMemoryChannelFilter] = useState<string[]>([])
  const [editingMemory, setEditingMemory] = useState<EntityRuntimeDetail['memories'][number]>()
  const [memorySaving, setMemorySaving] = useState(false)
  const [memoryDraft, setMemoryDraft] = useState({ content: '', keywords: [] as string[], pinned: false })
  const [entityConfigDraft, setEntityConfigDraft] = useState<Record<string, unknown>>({})
  const [entityConfigSaving, setEntityConfigSaving] = useState(false)
  const { data, error, isLoading } = useSWR(
    path == null ? null : ['knowledge-entity-detail', path],
    () => getEntityDetail(path!)
  )
  const {
    data: runtimeData,
    error: runtimeError,
    isLoading: runtimeLoading,
    mutate: mutateRuntime
  } = useSWR(
    path == null ? null : ['knowledge-entity-runtime', path],
    () => getEntityRuntime(path!)
  )
  useEffect(() => {
    setEntityConfigDraft(runtimeData?.runtime.entityConfig.overrides ?? {})
  }, [runtimeData?.runtime.entityConfig.overrides])
  useEffect(() => {
    setEditingPath(undefined)
    setEditorActions(undefined)
  }, [activePage, path])
  const entity = data?.entity
  const entityConfigUiSchema = useMemo(() => {
    const schema = buildConfigUiSchemaFromJsonSchema(
      runtimeData?.runtime.entityConfig.jsonSchema,
      i18n.language
    )
    if (schema == null) return undefined

    const projectRuntimeDefaults: Record<string, string | undefined> = {
      adapter: runtimeData?.runtime.modelDefaults.adapter,
      modelService: runtimeData?.runtime.modelDefaults.modelService,
      model: runtimeData?.runtime.modelDefaults.model
    }
    return {
      ...schema,
      fields: schema.fields.map((field) => {
        if (field.path.length !== 2 || field.path[0] !== 'runtime') return field
        const inheritedValue = projectRuntimeDefaults[field.path[1] ?? '']
        const inheritedDescription = inheritedValue == null
          ? t('knowledge.entities.inheritProjectRuntime', '留空时继承项目配置。')
          : t(
            'knowledge.entities.inheritProjectRuntimeValue',
            '留空时继承项目值：{{value}}',
            { value: inheritedValue }
          )
        return {
          ...field,
          description: [field.description, inheritedDescription].filter(Boolean).join(' '),
          placeholder: inheritedValue == null
            ? field.placeholder
            : t('knowledge.entities.inheritedValue', '继承：{{value}}', { value: inheritedValue })
        }
      })
    }
  }, [
    i18n.language,
    runtimeData?.runtime.entityConfig.jsonSchema,
    runtimeData?.runtime.modelDefaults.adapter,
    runtimeData?.runtime.modelDefaults.model,
    runtimeData?.runtime.modelDefaults.modelService,
    t
  ])

  if (resolving || (path != null && isLoading)) return <Spin className='knowledge-entity-detail' />
  if (error != null || entity == null) {
    return <div className='knowledge-entity-detail'>{t('common.notFound', '未找到实体')}</div>
  }

  const runtime = runtimeData?.runtime
  const tabs = [
    { key: 'role' as const, label: t('knowledge.entities.role', '角色'), icon: 'person' },
    { key: 'channels' as const, label: t('knowledge.entities.channels', '频道'), icon: 'hub' },
    { key: 'rooms' as const, label: t('knowledge.entities.rooms', '群聊'), icon: 'meeting_room' },
    { key: 'models' as const, label: t('knowledge.entities.models', '配置'), icon: 'tune' },
    { key: 'memory' as const, label: t('knowledge.entities.memory', '记忆'), icon: 'memory' }
  ]
  const renderEditor = () =>
    editingPath == null
      ? null
      : (
        <div className='knowledge-entity-detail__editor'>
          <WorkspaceFileEditorView
            autosave={false}
            isOpen
            markdownPreviewMode='editor'
            openPaths={[editingPath]}
            path={editingPath}
            showTabs={false}
            variant='content'
            onActionsChange={setEditorActions}
            onClose={() => setEditingPath(undefined)}
            onCloseAllPaths={() => setEditingPath(undefined)}
            onCloseOtherPaths={() => undefined}
            onClosePath={() => setEditingPath(undefined)}
            onClosePathsToRight={() => undefined}
            onSelectPath={setEditingPath}
          />
        </div>
      )

  const openDocumentEditor = (document: EntityRuntimeDetail['documents'][number]) => {
    if (document.path == null || !document.editable) return
    setEditingPath(document.path)
  }

  const createDocument = async (document: EntityRuntimeDetail['documents'][number]) => {
    if (!document.editable) return
    setDocumentCreating(true)
    try {
      const result = await createEntityDocument(runtime?.entityPath ?? entity.id, document.kind)
      setEditingPath(result.path)
      await mutateRuntime()
    } catch {
      message.error(t('knowledge.entities.documentCreateFailed', '实体文档创建失败'))
    } finally {
      setDocumentCreating(false)
    }
  }

  const filterEntityDocuments = (value: EntityRuntimeDetail) => {
    const query = normalizeSearchQuery(documentQuery)
    return value.documents.filter(document =>
      matchesSearchQuery(query, [
        t(entityDocumentPresentation[document.kind].labelKey),
        document.kind,
        document.body,
        document.fragments.map(fragment => fragment.entity).join(' ')
      ])
    )
  }

  const renderRole = (value: EntityRuntimeDetail) => {
    const documents = filterEntityDocuments(value)
    const selectedDocument = documents.find(document => document.kind === selectedDocumentKind) ?? documents[0]

    return (
      <div className='knowledge-entity-detail__document-page'>
        <ActionSearchToolbar
          inset={false}
          placeholder={t('knowledge.entities.searchDocuments', '搜索角色文档')}
          query={documentQuery}
          onQueryChange={setDocumentQuery}
        />
        <div className='knowledge-entity-detail__document-workbench'>
          <div className='knowledge-entity-detail__document-list'>
            {documents.map(document => {
              const presentation = entityDocumentPresentation[document.kind]
              return (
                <button
                  className={[
                    'knowledge-entity-detail__document-row',
                    selectedDocument?.kind === document.kind ? 'is-active' : undefined
                  ].filter(Boolean).join(' ')}
                  key={document.kind}
                  type='button'
                  onClick={() => setSelectedDocumentKind(document.kind)}
                >
                  <span className='material-symbols-rounded' aria-hidden='true'>{presentation.icon}</span>
                  <span>
                    <strong>{t(presentation.labelKey)}</strong>
                    <small>
                      {document.exists
                        ? `${document.fragments.length} ${
                          t('knowledge.entities.documentSources', '个来源')
                        } · ${document.inherit}`
                        : t('knowledge.entities.documentNotCreated', '尚未创建')}
                    </small>
                  </span>
                </button>
              )
            })}
          </div>
          <div className='knowledge-entity-detail__document-preview'>
            {selectedDocument == null
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.noData', '暂无数据')} />
              : selectedDocument.body === ''
              ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('knowledge.entities.emptyDocument', '该文档尚未创建')}
                >
                  {selectedDocument.editable
                    ? (
                      <Button
                        loading={documentCreating}
                        onClick={() => void createDocument(selectedDocument)}
                      >
                        {t('knowledge.entities.createDocument', '创建文档')}
                      </Button>
                    )
                    : null}
                </Empty>
              )
              : (
                <>
                  {selectedDocument.fragments.length > 1
                    ? (
                      <div className='knowledge-entity-detail__document-sources'>
                        {selectedDocument.fragments.map(fragment => (
                          <Tag key={`${fragment.entity}:${fragment.path ?? fragment.source}`}>
                            {fragment.entity}
                            {fragment.inherited ? ` · ${t('knowledge.entities.inherited', '继承')}` : ''}
                          </Tag>
                        ))}
                      </div>
                    )
                    : null}
                  <MarkdownContent content={selectedDocument.body} />
                </>
              )}
          </div>
        </div>
        <Modal
          footer={null}
          open={effectiveContextOpen}
          title={t('knowledge.entities.effectiveContext', '有效实体上下文')}
          width={860}
          onCancel={() => setEffectiveContextOpen(false)}
        >
          <div className='knowledge-entity-detail__effective-context-meta'>
            {value.effectiveContext.sectionCount} {t('knowledge.entities.sections', '个区段')} ·{' '}
            {value.effectiveContext.sourceCount} {t('knowledge.entities.documentSources', '个来源')}
          </div>
          <pre className='knowledge-entity-detail__effective-context'>{value.effectiveContext.body}</pre>
        </Modal>
      </div>
    )
  }

  const renderChannels = (value: EntityRuntimeDetail) => {
    const query = normalizeSearchQuery(channelQuery)
    const hasActiveFilters = channelTypeFilter !== 'all' || channelStatusFilter !== 'all'
    const accounts = value.channelAccounts.filter(account => (
      (channelTypeFilter === 'all' || account.type === channelTypeFilter) &&
      (channelStatusFilter === 'all' || (channelStatusFilter === 'enabled') === account.enabled) &&
      matchesSearchQuery(query, [
        getChannelLabel(account.type),
        account.title,
        account.channelKey,
        account.description,
        account.enabled ? t('common.enabled', '已启用') : t('common.disabled', '已停用')
      ])
    ))
    const channelTypes = [...new Set(value.channelAccounts.map(account => account.type))]
    const associationAccounts = [...value.channelAccounts, ...value.availableChannelAccounts]
      .filter((account, index, items) => items.findIndex(item => item.channelKey === account.channelKey) === index)

    const openChannelAssociation = () => {
      const firstAccount = associationAccounts[0]
      setChannelLinkDraft({
        channelKey: firstAccount?.channelKey ?? '',
        description: '',
        externalId: '',
        externalType: firstAccount?.type === 'oneworks' ? 'room' : 'chat',
        name: ''
      })
      setChannelLinkOpen(true)
    }

    const saveChannelAssociation = async () => {
      if (
        channelLinkDraft.channelKey === '' || channelLinkDraft.name.trim() === '' ||
        channelLinkDraft.externalId.trim() === ''
      ) return
      setChannelLinkSaving(true)
      try {
        await createEntityChannelLink({
          ...channelLinkDraft,
          entityPath: value.entityPath
        })
        setChannelLinkOpen(false)
        await mutateRuntime()
        message.success(t('knowledge.entities.channelLinked', '频道关联已添加'))
      } catch {
        message.error(t('knowledge.entities.channelLinkFailed', '添加频道关联失败'))
      } finally {
        setChannelLinkSaving(false)
      }
    }

    const removeAccountLinks = (channelKey: string) => {
      const links = value.channelLinks.filter(link => link.channelKey === channelKey && link.editable)
      if (links.length === 0) return
      modal.confirm({
        title: t('knowledge.entities.unlinkChannel', '解除频道关联'),
        content: t(
          'knowledge.entities.unlinkChannelDescription',
          '将解除当前实体通过该账号建立的全部会话关联，账号配置本身会保留。'
        ),
        okButtonProps: { danger: true },
        okText: t('common.remove', '解除'),
        async onOk() {
          await Promise.all(links.map(link => deleteEntityChannelLink(link.path)))
          await mutateRuntime()
        }
      })
    }

    return (
      <div className='knowledge-entity-detail__list-page'>
        <ActionSearchToolbar
          inset={false}
          placeholder={t('knowledge.entities.searchChannels', '搜索频道账号')}
          query={channelQuery}
          actions={[{
            ariaLabel: t('knowledge.entities.addChannelLink', '新增频道关联'),
            icon: 'add_link',
            key: 'add-channel-link',
            onClick: openChannelAssociation
          }, {
            active: channelFiltersOpen,
            ariaLabel: t('knowledge.entities.filterChannels', '过滤频道账号'),
            hasIndicator: hasActiveFilters,
            icon: 'filter_alt',
            key: 'channel-filters',
            onClick: () => setChannelFiltersOpen(open => !open),
            pressed: channelFiltersOpen
          }]}
          onQueryChange={setChannelQuery}
        />
        <ActionSearchFilterPanel open={channelFiltersOpen}>
          <Select
            value={channelTypeFilter}
            options={[
              { label: t('knowledge.entities.allPlatforms', '全部平台'), value: 'all' },
              ...channelTypes.map(type => ({ label: getChannelLabel(type), value: type }))
            ]}
            onChange={value => setChannelTypeFilter(String(value))}
          />
          <Select
            value={channelStatusFilter}
            options={[
              { label: t('knowledge.entities.allStatuses', '全部状态'), value: 'all' },
              { label: t('common.enabled', '已启用'), value: 'enabled' },
              { label: t('common.disabled', '已停用'), value: 'disabled' }
            ]}
            onChange={value => setChannelStatusFilter(String(value))}
          />
        </ActionSearchFilterPanel>
        {accounts.length === 0
          ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={value.channelAccounts.length === 0
                ? t('knowledge.entities.noChannels', '尚未绑定频道')
                : t('knowledge.entities.noSearchResults', '没有匹配结果')}
            />
          )
          : (
            <div className='knowledge-entity-detail__runtime-list'>
              {accounts.map(account => {
                const accountLinks = value.channelLinks.filter(link => link.channelKey === account.channelKey)
                const hasEditableLinks = accountLinks.some(link => link.editable)
                return (
                  <div
                    className='knowledge-entity-detail__runtime-row knowledge-entity-detail__channel-row'
                    key={account.channelKey}
                  >
                    <ChannelPlatformIcon
                      channelType={account.type}
                      className='knowledge-entity-detail__platform-icon'
                    />
                    <span className='knowledge-entity-detail__runtime-copy'>
                      <button
                        className='knowledge-entity-detail__text-action'
                        type='button'
                        onClick={() =>
                          navigate(
                            `/config/channels/${encodeURIComponent(account.channelKey)}?source=${account.configSource}`
                          )}
                      >
                        <strong>{account.title}</strong>
                      </button>
                      <span>{t('knowledge.entities.channelAccount', '账号配置')} · {account.channelKey}</span>
                      {account.description === '' ? null : <span>{account.description}</span>}
                      {accountLinks.length === 0
                        ? null
                        : (
                          <span className='knowledge-entity-detail__channel-links'>
                            {accountLinks.map(link => (
                              <span className='knowledge-entity-detail__channel-link' key={link.path}>
                                <span className='material-symbols-rounded' aria-hidden='true'>link</span>
                                <span>{link.name}</span>
                                <small>
                                  {link.externalType}
                                  {link.externalId == null ? '' : ` · ${link.externalId}`}
                                </small>
                              </span>
                            ))}
                          </span>
                        )}
                    </span>
                    <span className='knowledge-entity-detail__row-actions'>
                      <Switch
                        checked={account.enabled}
                        size='small'
                        title={account.enabled ? t('common.enabled', '已启用') : t('common.disabled', '已停用')}
                        onChange={async enabled => {
                          try {
                            await updateEntityChannelAccount(account.channelKey, enabled)
                            await mutateRuntime()
                          } catch {
                            message.error(t('knowledge.entities.channelStatusFailed', '频道状态更新失败'))
                          }
                        }}
                      />
                      <Button
                        danger
                        disabled={!hasEditableLinks}
                        icon={<span className='material-symbols-rounded' aria-hidden='true'>link_off</span>}
                        size='small'
                        title={t('knowledge.entities.unlinkChannel', '解除频道关联')}
                        type='text'
                        onClick={() => removeAccountLinks(account.channelKey)}
                      />
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        <Modal
          destroyOnClose
          okButtonProps={{
            disabled: channelLinkDraft.channelKey === '' || channelLinkDraft.name.trim() === '' ||
              channelLinkDraft.externalId.trim() === ''
          }}
          okText={t('common.add', '添加')}
          open={channelLinkOpen}
          title={t('knowledge.entities.addChannelLink', '新增频道关联')}
          confirmLoading={channelLinkSaving}
          onCancel={() => setChannelLinkOpen(false)}
          onOk={() => void saveChannelAssociation()}
        >
          <div className='knowledge-entity-detail__modal-fields'>
            <label>
              <span>{t('knowledge.entities.channelAccount', '频道账号')}</span>
              <Select
                value={channelLinkDraft.channelKey || undefined}
                options={associationAccounts.map(account => ({
                  label: account.title,
                  value: account.channelKey
                }))}
                onChange={next => {
                  const channelKey = String(next)
                  const account = associationAccounts.find(item => item.channelKey === channelKey)
                  setChannelLinkDraft(current => ({
                    ...current,
                    channelKey,
                    externalType: account?.type === 'oneworks' ? 'room' : 'chat'
                  }))
                }}
              />
            </label>
            <label>
              <span>{t('knowledge.entities.associationName', '关联名称')}</span>
              <Input
                value={channelLinkDraft.name}
                onChange={event => setChannelLinkDraft(current => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label>
              <span>{t('knowledge.entities.externalType', '会话类型')}</span>
              <Select
                value={channelLinkDraft.externalType}
                options={[
                  { label: t('knowledge.entities.groupChat', '群聊'), value: 'chat' },
                  { label: t('knowledge.entities.directChat', '私聊'), value: 'direct' },
                  { label: t('knowledge.entities.room', '房间'), value: 'room' },
                  { label: t('knowledge.entities.thread', '话题'), value: 'thread' }
                ]}
                onChange={next =>
                  setChannelLinkDraft(current => ({
                    ...current,
                    externalType: String(next)
                  }))}
              />
            </label>
            <label>
              <span>{t('knowledge.entities.externalId', '外部会话 ID')}</span>
              <Input
                value={channelLinkDraft.externalId}
                onChange={event =>
                  setChannelLinkDraft(current => ({
                    ...current,
                    externalId: event.target.value
                  }))}
              />
            </label>
            <label>
              <span>{t('common.description', '描述')}</span>
              <Input
                value={channelLinkDraft.description}
                onChange={event =>
                  setChannelLinkDraft(current => ({
                    ...current,
                    description: event.target.value
                  }))}
              />
            </label>
          </div>
        </Modal>
      </div>
    )
  }

  const renderRooms = (value: EntityRuntimeDetail) => {
    const query = normalizeSearchQuery(roomQuery)
    const hasActiveFilters = roomStatusFilter !== 'all' || roomArchiveFilter !== 'all'
    const rooms = value.rooms.filter(room => (
      (roomStatusFilter === 'all' || room.status === roomStatusFilter) &&
      (roomArchiveFilter === 'all' || (roomArchiveFilter === 'archived') === room.archived) &&
      matchesSearchQuery(query, [
        room.title,
        room.status,
        room.id,
        room.members.map(member => `${member.label} ${member.key}`).join(' ')
      ])
    ))
    const roomStatuses = [...new Set(value.rooms.map(room => room.status))]

    return (
      <div className='knowledge-entity-detail__list-page'>
        <ActionSearchToolbar
          inset={false}
          placeholder={t('knowledge.entities.searchRooms', '搜索群聊')}
          query={roomQuery}
          actions={[{
            active: roomFiltersOpen,
            ariaLabel: t('knowledge.entities.filterRooms', '过滤群聊'),
            hasIndicator: hasActiveFilters,
            icon: 'filter_alt',
            key: 'room-filters',
            onClick: () => setRoomFiltersOpen(open => !open),
            pressed: roomFiltersOpen
          }]}
          onQueryChange={setRoomQuery}
        />
        <ActionSearchFilterPanel open={roomFiltersOpen}>
          <Select
            value={roomStatusFilter}
            options={[
              { label: t('knowledge.entities.allStatuses', '全部状态'), value: 'all' },
              ...roomStatuses.map(status => ({ label: status, value: status }))
            ]}
            onChange={value => setRoomStatusFilter(String(value))}
          />
          <Select
            value={roomArchiveFilter}
            options={[
              { label: t('knowledge.entities.allArchiveStates', '全部群聊'), value: 'all' },
              { label: t('knowledge.entities.activeRooms', '进行中'), value: 'active' },
              { label: t('knowledge.entities.archivedRooms', '已归档'), value: 'archived' }
            ]}
            onChange={value => setRoomArchiveFilter(String(value))}
          />
        </ActionSearchFilterPanel>
        {rooms.length === 0
          ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={value.rooms.length === 0
                ? t('knowledge.entities.noRooms', '尚未加入群聊')
                : t('knowledge.entities.noSearchResults', '没有匹配结果')}
            />
          )
          : (
            <div className='knowledge-entity-detail__runtime-list'>
              {rooms.map(room => (
                <button
                  className='knowledge-entity-detail__runtime-row knowledge-entity-detail__runtime-row--action'
                  key={room.id}
                  type='button'
                  onClick={() =>
                    navigate(
                      `/plugins/channel-oneworks/oneworks-channel/rooms/${encodeURIComponent(room.id)}`
                    )}
                >
                  <GroupAvatar label={room.title} members={room.members} />
                  <span className='knowledge-entity-detail__runtime-copy'>
                    <strong>{room.title}</strong>
                    <span>{room.members.length} {t('knowledge.entities.roomMembers', '位成员')} · {room.status}</span>
                    <small>{new Date(room.updatedAt).toLocaleString()}</small>
                  </span>
                  <span className='material-symbols-rounded' aria-hidden='true'>chevron_right</span>
                </button>
              ))}
            </div>
          )}
      </div>
    )
  }

  const saveEntityConfig = async () => {
    if (runtime == null) return
    setEntityConfigSaving(true)
    try {
      await updateEntityConfig(runtime.entityPath, entityConfigDraft)
      await mutateRuntime()
      message.success(t('knowledge.entities.configSaved', '实体配置已保存'))
    } catch {
      message.error(t('knowledge.entities.configSaveFailed', '实体配置保存失败'))
    } finally {
      setEntityConfigSaving(false)
    }
  }

  const renderModels = (_value: EntityRuntimeDetail) => {
    return (
      <div className='knowledge-entity-detail__config-page'>
        {entityConfigUiSchema == null
          ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.loadFailed', '加载失败')} />
          : (
            <SchemaObjectEditor
              schema={entityConfigUiSchema}
              t={t}
              value={entityConfigDraft}
              onChange={setEntityConfigDraft}
            />
          )}
      </div>
    )
  }

  const renderMemory = (value: EntityRuntimeDetail) => {
    const query = normalizeSearchQuery(memoryQuery)
    const matchesVisibilityGroup = (
      values: string[] | undefined,
      selected: string[],
      required = false
    ) => (
      selected.length === 0 || (!required && values == null) || selected.some(item => values?.includes(item))
    )
    const hasActiveFilters = memorySubjectFilter !== 'all' ||
      memorySensitivityFilter !== 'all' || memoryPinnedFilter !== 'all' || memoryTagFilter.length > 0 ||
      memoryConversationTypeFilter.length > 0 || memoryEntityFilter.length > 0 ||
      memoryOrgFilter.length > 0 || memoryRoomFilter.length > 0 || memoryChannelFilter.length > 0
    const memories = value.memories.filter(memory => (
      (memorySubjectFilter === 'all' || memory.subjectType === memorySubjectFilter) &&
      (memorySensitivityFilter === 'all' || memory.sensitivity === memorySensitivityFilter) &&
      (memoryPinnedFilter === 'all' || (memoryPinnedFilter === 'pinned') === memory.pinned) &&
      memoryTagFilter.every(tag => memory.keywords.includes(tag)) &&
      matchesVisibilityGroup(memory.visibility?.conversationTypes, memoryConversationTypeFilter) &&
      matchesVisibilityGroup(memory.visibility?.entities, memoryEntityFilter) &&
      matchesVisibilityGroup(memory.visibility?.orgs, memoryOrgFilter, true) &&
      matchesVisibilityGroup(memory.visibility?.rooms, memoryRoomFilter) &&
      matchesVisibilityGroup(memory.visibility?.channels, memoryChannelFilter) &&
      matchesSearchQuery(query, [
        memory.content,
        memory.keywords.join(' '),
        memory.subjectType,
        memory.sensitivity,
        JSON.stringify(memory.source),
        JSON.stringify(memory.visibility)
      ])
    ))
    const memorySubjectTypes = [...new Set(value.memories.map(memory => memory.subjectType))]
    const memoryTags = [...new Set(value.memories.flatMap(memory => memory.keywords))].sort()
    const memoryConversationTypes = [
      ...new Set(value.memories.flatMap(
        memory => memory.visibility?.conversationTypes ?? []
      ))
    ].sort()
    const memoryEntities = [
      ...new Set(value.memories.flatMap(
        memory => memory.visibility?.entities ?? []
      ))
    ].sort()
    const memoryOrgs = [
      ...new Set(value.memories.flatMap(
        memory => memory.visibility?.orgs ?? []
      ))
    ].sort()
    const memoryRooms = [
      ...new Set(value.memories.flatMap(
        memory => memory.visibility?.rooms ?? []
      ))
    ].sort()
    const memoryChannels = [
      ...new Set(value.memories.flatMap(
        memory => memory.visibility?.channels ?? []
      ))
    ].sort()
    const openMemoryEditor = (memory: EntityRuntimeDetail['memories'][number]) => {
      setEditingMemory(memory)
      setMemoryDraft({
        content: memory.content,
        keywords: memory.keywords,
        pinned: memory.pinned
      })
    }

    const saveMemory = async () => {
      if (editingMemory == null || memoryDraft.content.trim() === '') return
      setMemorySaving(true)
      try {
        await updateEntityMemory(editingMemory.id, memoryDraft)
        setEditingMemory(undefined)
        await mutateRuntime()
        message.success(t('knowledge.entities.memorySaved', '记忆已保存'))
      } catch {
        message.error(t('knowledge.entities.memorySaveFailed', '记忆保存失败'))
      } finally {
        setMemorySaving(false)
      }
    }

    return (
      <div className='knowledge-entity-detail__list-page knowledge-entity-detail__list-page--memory'>
        <ActionSearchToolbar
          inset={false}
          placeholder={t('knowledge.entities.searchMemory', '搜索记忆')}
          query={memoryQuery}
          actions={[{
            active: memoryFiltersOpen,
            ariaLabel: t('knowledge.entities.filterMemory', '过滤记忆'),
            hasIndicator: hasActiveFilters,
            icon: 'filter_alt',
            key: 'memory-filters',
            onClick: () => setMemoryFiltersOpen(open => !open),
            pressed: memoryFiltersOpen
          }]}
          onQueryChange={setMemoryQuery}
        />
        <ActionSearchFilterPanel open={memoryFiltersOpen}>
          <Select
            value={memorySubjectFilter}
            options={[
              { label: t('knowledge.entities.allMemoryTypes', '全部类型'), value: 'all' },
              ...memorySubjectTypes.map(type => ({ label: type, value: type }))
            ]}
            onChange={value => setMemorySubjectFilter(String(value))}
          />
          <Select
            value={memorySensitivityFilter}
            options={[
              { label: t('knowledge.entities.allSensitivity', '全部敏感级别'), value: 'all' },
              { label: t('knowledge.entities.normalMemory', '普通'), value: 'normal' },
              { label: t('knowledge.entities.sensitiveMemory', '敏感'), value: 'sensitive' }
            ]}
            onChange={value => setMemorySensitivityFilter(String(value))}
          />
          <Select
            value={memoryPinnedFilter}
            options={[
              { label: t('knowledge.entities.allPinnedStates', '全部记忆'), value: 'all' },
              { label: t('knowledge.entities.pinnedOnly', '仅置顶'), value: 'pinned' },
              { label: t('knowledge.entities.unpinnedOnly', '未置顶'), value: 'unpinned' }
            ]}
            onChange={value => setMemoryPinnedFilter(String(value))}
          />
          <Select
            allowClear
            mode='multiple'
            maxTagCount='responsive'
            placeholder={t('knowledge.entities.filterByTags', '按标签过滤')}
            value={memoryTagFilter}
            options={memoryTags.map(tag => ({ label: tag, value: tag }))}
            onChange={values => setMemoryTagFilter(Array.isArray(values) ? values.map(String) : [])}
          />
          <Select
            allowClear
            mode='multiple'
            maxTagCount='responsive'
            placeholder={t('knowledge.entities.filterByConversationType', '按会话类型过滤')}
            value={memoryConversationTypeFilter}
            options={memoryConversationTypes.map(item => ({ label: item, value: item }))}
            onChange={items => setMemoryConversationTypeFilter(Array.isArray(items) ? items.map(String) : [])}
          />
          <Select
            allowClear
            mode='multiple'
            maxTagCount='responsive'
            placeholder={t('knowledge.entities.filterByEntity', '按实体过滤')}
            value={memoryEntityFilter}
            options={memoryEntities.map(item => ({ label: item, value: item }))}
            onChange={items => setMemoryEntityFilter(Array.isArray(items) ? items.map(String) : [])}
          />
          <Select
            allowClear
            mode='multiple'
            maxTagCount='responsive'
            placeholder={t('knowledge.entities.filterByOrg', '按组织过滤')}
            value={memoryOrgFilter}
            options={memoryOrgs.map(item => ({ label: item, value: item }))}
            onChange={items => setMemoryOrgFilter(Array.isArray(items) ? items.map(String) : [])}
          />
          <Select
            allowClear
            mode='multiple'
            maxTagCount='responsive'
            placeholder={t('knowledge.entities.filterByRoom', '按群聊过滤')}
            value={memoryRoomFilter}
            options={memoryRooms.map(item => ({ label: item, value: item }))}
            onChange={items => setMemoryRoomFilter(Array.isArray(items) ? items.map(String) : [])}
          />
          <Select
            allowClear
            mode='multiple'
            maxTagCount='responsive'
            placeholder={t('knowledge.entities.filterByChannel', '按频道过滤')}
            value={memoryChannelFilter}
            options={memoryChannels.map(item => ({ label: item, value: item }))}
            onChange={items => setMemoryChannelFilter(Array.isArray(items) ? items.map(String) : [])}
          />
        </ActionSearchFilterPanel>
        {memories.length === 0
          ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={value.memories.length === 0
                ? t('knowledge.entities.noMemory', '尚无实体记忆')
                : t('knowledge.entities.noSearchResults', '没有匹配结果')}
            />
          )
          : (
            <div className='knowledge-entity-detail__memory-grid'>
              {memories.map(memory => (
                <div className='knowledge-entity-detail__memory-card' key={memory.id}>
                  <span
                    className='knowledge-entity-detail__memory-card-icon material-symbols-rounded'
                    aria-hidden='true'
                  >
                    {memory.pinned ? 'keep' : 'memory'}
                  </span>
                  <span className='knowledge-entity-detail__runtime-copy'>
                    <strong>
                      {memory.pinned
                        ? t('knowledge.entities.pinnedMemory', '置顶记忆')
                        : t('knowledge.entities.learnedMemory', '学习记忆')}
                    </strong>
                    <span>{memory.content}</span>
                    <span>
                      {[
                        memory.subjectType,
                        memory.sensitivity,
                        `importance ${memory.importance.toFixed(2)}`,
                        `confidence ${memory.confidence.toFixed(2)}`,
                        memory.source?.channelType,
                        memory.source?.sessionType
                      ].filter(Boolean).join(' · ')}
                    </span>
                    {memory.keywords.length === 0
                      ? null
                      : (
                        <span className='knowledge-entity-detail__memory-tags'>
                          {memory.keywords.map(keyword => <Tag key={keyword}>{keyword}</Tag>)}
                        </span>
                      )}
                    {memory.visibility == null
                      ? null
                      : <span>
                        {Object.entries(memory.visibility)
                          .filter(([, items]) => items != null && items.length > 0)
                          .map(([key, items]) => `${key}: ${items?.join(', ')}`)
                          .join(' · ')}
                      </span>}
                    <small>{new Date(memory.updatedAt).toLocaleString()}</small>
                  </span>
                  {memory.editable
                    ? (
                      <Button
                        className='knowledge-entity-detail__memory-edit'
                        icon={<span className='material-symbols-rounded' aria-hidden='true'>edit</span>}
                        size='small'
                        title={t('knowledge.entities.editMemory', '编辑记忆')}
                        type='text'
                        onClick={() => openMemoryEditor(memory)}
                      />
                    )
                    : null}
                </div>
              ))}
            </div>
          )}
        <Modal
          okButtonProps={{ disabled: memoryDraft.content.trim() === '' }}
          okText={t('common.save', '保存')}
          open={editingMemory != null}
          title={t('knowledge.entities.editMemory', '编辑记忆')}
          confirmLoading={memorySaving}
          onCancel={() => setEditingMemory(undefined)}
          onOk={() => void saveMemory()}
        >
          <div className='knowledge-entity-detail__modal-fields'>
            <label>
              <span>{t('knowledge.entities.memoryContent', '内容')}</span>
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 10 }}
                value={memoryDraft.content}
                onChange={event =>
                  setMemoryDraft(current => ({
                    ...current,
                    content: event.target.value
                  }))}
              />
            </label>
            <label>
              <span>{t('knowledge.entities.memoryTags', '标签')}</span>
              <Select
                mode='tags'
                value={memoryDraft.keywords}
                options={memoryTags.map(tag => ({ label: tag, value: tag }))}
                onChange={keywords =>
                  setMemoryDraft(current => ({
                    ...current,
                    keywords: Array.isArray(keywords) ? keywords.map(String) : []
                  }))}
              />
            </label>
            <label className='knowledge-entity-detail__switch-field'>
              <span>{t('knowledge.entities.pinMemory', '置顶')}</span>
              <Switch
                checked={memoryDraft.pinned}
                onChange={pinned => setMemoryDraft(current => ({ ...current, pinned }))}
              />
            </label>
          </div>
        </Modal>
      </div>
    )
  }

  const renderRuntimePage = () => {
    if (runtimeLoading) return <Spin className='knowledge-entity-detail__runtime-state' />
    if (runtimeError != null || runtime == null) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.loadFailed', '加载失败')} />
    }
    if (activePage === 'channels') return renderChannels(runtime)
    if (activePage === 'rooms') return renderRooms(runtime)
    if (activePage === 'models') return renderModels(runtime)
    return renderMemory(runtime)
  }

  const visibleDocuments = runtime == null ? [] : filterEntityDocuments(runtime)
  const selectedDocument = visibleDocuments.find(document => document.kind === selectedDocumentKind) ??
    visibleDocuments[0]
  const memoryPolicyDocument = runtime?.documents.find(document => document.kind === 'memoryPolicy')
  const entityConfigDirty = runtime != null &&
    JSON.stringify(entityConfigDraft) !== JSON.stringify(runtime.entityConfig.overrides)
  const editorTabActions = (
    <>
      <Button
        disabled={editorActions?.isSaving}
        size='small'
        onClick={() => {
          editorActions?.discard()
          setEditingPath(undefined)
        }}
      >
        {t('common.cancel', '取消')}
      </Button>
      <Button
        disabled={editorActions == null || !editorActions.isDirty}
        loading={editorActions?.isSaving}
        size='small'
        type='primary'
        onClick={async () => {
          if (await editorActions?.save()) {
            setEditingPath(undefined)
            setEditorActions(undefined)
            await mutateRuntime()
          }
        }}
      >
        {t('common.save', '保存')}
      </Button>
    </>
  )
  const tabActions = editingPath != null
    ? editorTabActions
    : activePage === 'role'
    ? (
      <>
        <Button
          icon={<span className='material-symbols-rounded' aria-hidden='true'>data_object</span>}
          size='small'
          title={t('knowledge.entities.effectiveContext', '有效实体上下文')}
          type='text'
          onClick={() => setEffectiveContextOpen(true)}
        />
        <Button
          disabled={selectedDocument?.editable !== true}
          icon={<span className='material-symbols-rounded' aria-hidden='true'>edit</span>}
          size='small'
          title={t('knowledge.entities.editDocument', '编辑当前文档')}
          type='text'
          onClick={() => {
            if (selectedDocument == null) return
            if (selectedDocument.exists) {
              openDocumentEditor(selectedDocument)
              return
            }
            void createDocument(selectedDocument)
          }}
        />
      </>
    )
    : activePage === 'memory'
    ? (
      <Button
        disabled={memoryPolicyDocument?.editable !== true}
        icon={<span className='material-symbols-rounded' aria-hidden='true'>policy</span>}
        size='small'
        title={t('knowledge.entities.memoryPolicy', '记忆策略')}
        type='text'
        onClick={() => {
          if (memoryPolicyDocument == null) return
          setSelectedDocumentKind('memoryPolicy')
          if (memoryPolicyDocument.exists) {
            openDocumentEditor(memoryPolicyDocument)
            return
          }
          void createDocument(memoryPolicyDocument)
        }}
      />
    )
    : activePage === 'models'
    ? (
      <Button
        disabled={!runtime?.entityConfig.editable || entityConfigUiSchema == null || !entityConfigDirty}
        loading={entityConfigSaving}
        size='small'
        type='primary'
        onClick={() => void saveEntityConfig()}
      >
        {t('common.save', '保存')}
      </Button>
    )
    : undefined

  return (
    <div className='knowledge-entity-detail'>
      <EntitySummary
        avatar={entity.avatar}
        description={entity.description}
        entityId={entity.id}
        name={entity.name}
        variant='detail'
      />
      <div className='knowledge-entity-detail__meta'>
        {entity.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}
        {entity.skills.map(skill => <Tag key={`skill:${skill}`}>{skill}</Tag>)}
        {entity.rules.map(rule => <Tag key={`rule:${rule}`}>{rule}</Tag>)}
      </div>
      <NativeTabs
        activeKey={activePage}
        actions={tabActions}
        ariaLabel={t('knowledge.entities.management', '实体管理')}
        items={tabs}
        onChange={onNavigatePage}
      />
      {editingPath == null
        ? activePage === 'role'
          ? runtimeLoading
            ? <Spin className='knowledge-entity-detail__runtime-state' />
            : runtimeError != null || runtime == null
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.loadFailed', '加载失败')} />
            : renderRole(runtime)
          : renderRuntimePage()
        : renderEditor()}
    </div>
  )
}
