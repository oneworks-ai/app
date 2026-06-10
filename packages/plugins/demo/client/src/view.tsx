/* @jsx h */
/* eslint-disable max-lines -- Demo view intentionally exercises host UI surfaces in one inspectable example. */

export function PluginDemoView({
  ctx,
  react,
  variant,
  view,
  createTranslator,
  eventName,
  getDemoTabs,
  getInitialResult,
  pretty
}) {
  const h = react.createElement
  const { useEffect, useMemo, useRef, useState } = react
  const {
    Icon,
    Input,
    OverlaySearchMenu,
    OverlayTree,
    ProjectFileTree,
    Segmented,
    Sender,
    Switch
  } = view.ui
  const t = useMemo(() => createTranslator(view.i18n), [view.i18n])
  const demoTabs = useMemo(() => getDemoTabs(t), [t])
  const defaultSenderPlaceholder = t('senderPlaceholder')
  const extensionActions = view.extensions.getContributions('quick-actions')

  const [activeDemoTab, setActiveDemoTab] = useState(null)
  const [activeHostComponent, setActiveHostComponent] = useState(null)
  const [activeOverlayTab, setActiveOverlayTab] = useState('commands')
  const [lastResult, setLastResult] = useState(() => getInitialResult(ctx, view, variant, t))
  const [overlayMode, setOverlayMode] = useState('menu')
  const [overlaySearchValue, setOverlaySearchValue] = useState('')
  const [senderDefaultAdapter, setSenderDefaultAdapter] = useState('')
  const [senderDefaultModel, setSenderDefaultModel] = useState('')
  const [senderDensity, setSenderDensity] = useState('default')
  const [senderInitialContent, setSenderInitialContent] = useState('')
  const [senderPlaceholder, setSenderPlaceholder] = useState(defaultSenderPlaceholder)
  const [senderShowHeader, setSenderShowHeader] = useState(true)
  const [senderShowStatusBar, setSenderShowStatusBar] = useState(true)
  const [senderSurface, setSenderSurface] = useState('chat')
  const defaultSenderPlaceholderRef = useRef(defaultSenderPlaceholder)
  const readyMessageRef = useRef(t('resultReady'))

  const senderConfig = {
    defaultAdapter: senderDefaultAdapter.trim() || undefined,
    defaultModel: senderDefaultModel.trim() || undefined,
    density: senderDensity,
    initialContent: senderInitialContent,
    placeholder: senderPlaceholder.trim() || undefined,
    showHeader: senderShowHeader,
    showStatusBar: senderShowStatusBar,
    surface: senderSurface
  }

  useEffect(() => {
    setSenderPlaceholder(current =>
      current === defaultSenderPlaceholderRef.current ? defaultSenderPlaceholder : current
    )
    defaultSenderPlaceholderRef.current = defaultSenderPlaceholder
  }, [defaultSenderPlaceholder])

  useEffect(() => {
    const nextReadyMessage = t('resultReady')
    setLastResult(current => ({
      ...current,
      host: view.host,
      message: current.message === readyMessageRef.current ? nextReadyMessage : current.message,
      routeId: view.routeId,
      scope: ctx.scope
    }))
    readyMessageRef.current = nextReadyMessage
  }, [ctx.scope, t, view.host, view.routeId])

  useEffect(() => {
    const handleExternalEvent = event => {
      setLastResult({
        at: new Date().toISOString(),
        detail: event.detail,
        message: t('resultPluginEventReceived')
      })
    }
    window.addEventListener(eventName, handleExternalEvent)
    return () => window.removeEventListener(eventName, handleExternalEvent)
  }, [eventName, t])

  const updateSenderConfig = (message, patch = {}) => {
    setLastResult({
      at: new Date().toISOString(),
      host: view.host,
      message,
      senderConfig: { ...senderConfig, ...patch }
    })
  }

  const menuItems = useMemo(() => [
    { key: 'open', label: t('menuOpenCommand'), icon: 'terminal', shortcut: 'O' },
    {
      key: 'view',
      label: t('menuViewMode'),
      icon: 'visibility',
      children: [
        { key: 'view-list', label: t('treeList'), icon: 'view_list', selected: overlayMode === 'menu' },
        { key: 'view-tree', label: t('treeTree'), icon: 'account_tree', selected: overlayMode === 'tree' }
      ]
    },
    { key: 'section-actions', type: 'section', label: t('menuActions') },
    {
      key: 'danger',
      label: t('menuDangerAction'),
      icon: 'delete',
      confirmLabel: t('menuConfirmDelete'),
      tone: 'danger'
    }
  ], [overlayMode, t])

  const treeNodes = useMemo(() => [
    {
      key: 'workspace',
      label: t('treeWorkspace'),
      meta: t('treeRoot'),
      collapsedIcon: 'folder',
      expandedIcon: 'folder_open',
      children: [
        { key: 'workspace-plugin', label: 'plugin.json', icon: 'description', meta: t('treeManifest') },
        { key: 'workspace-client-entry', label: 'client/src/index.tsx', icon: 'code', selected: true },
        { key: 'workspace-client-view', label: 'client/src/view.tsx', icon: 'view_quilt' },
        { key: 'workspace-client-i18n', label: 'client/src/i18n.ts', icon: 'translate' }
      ]
    },
    { key: 'docs', label: t('treeDocs'), icon: 'article', meta: t('treeReadme') }
  ], [t])

  const handleAction = async (action) => {
    try {
      if (action === 'server') {
        setActiveDemoTab(action)
        setActiveHostComponent(null)
        setActiveOverlayTab('commands')
        const result = await ctx.commands.execute('server-ping', {
          at: new Date().toISOString(),
          from: variant
        })
        setLastResult(result)
        ctx.notifications.show({
          actions: [
            {
              closeOnClick: false,
              icon: 'data_object',
              id: 'keep-result',
              title: t('notificationActionKeepResult'),
              onClick: () => setActiveDemoTab('server')
            }
          ],
          description: t('toastServerReturnedDescription'),
          level: 'success',
          title: t('toastServerReturned')
        })
        return
      }

      if (action === 'api') {
        setActiveDemoTab(action)
        setActiveHostComponent(null)
        setActiveOverlayTab('commands')
        const response = await ctx.api.fetch(`echo/${encodeURIComponent(variant)}?source=client`)
        setLastResult(await response.json())
        ctx.notifications.show({
          actions: [
            {
              closeOnClick: false,
              icon: 'data_object',
              id: 'keep-result',
              title: t('notificationActionKeepResult'),
              onClick: () => setActiveDemoTab('api')
            }
          ],
          description: t('toastApiReturnedDescription'),
          level: 'success',
          title: t('toastApiReturned')
        })
        return
      }

      if (action === 'toast') {
        setActiveDemoTab(action)
        setActiveHostComponent(null)
        setActiveOverlayTab('commands')
        await ctx.commands.execute('say-hi', { from: variant })
        setLastResult({ at: new Date().toISOString(), from: variant, message: t('actionLocalExecuted') })
        return
      }

      if (action === 'reload') {
        setActiveDemoTab(action)
        setActiveHostComponent(null)
        setActiveOverlayTab('commands')
        await ctx.hot.reload()
        setLastResult({ at: new Date().toISOString(), from: variant, message: t('actionPluginReloadRequested') })
        return
      }

      if (action === 'sender' || action === 'projectFileTree' || action === 'overlay') {
        setActiveDemoTab(action)
        setActiveHostComponent(action)
        if (action !== 'overlay') {
          setActiveOverlayTab('commands')
        }
        setLastResult({
          at: new Date().toISOString(),
          component: action,
          host: view.host,
          message: t('actionRenderHostComponent', { component: action }),
          senderConfig: action === 'sender' ? senderConfig : undefined
        })
      }
    } catch (error) {
      setLastResult({
        action,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const resolveContributionText = (item, field, fallback) =>
    view.i18n.resolveText(item[`${field}I18n`], view.i18n.resolveText(item[field], fallback))

  const handleExtensionAction = async (item) => {
    try {
      const command = typeof item.command === 'string' ? item.command : null
      setActiveDemoTab(null)
      setActiveHostComponent(null)
      setActiveOverlayTab('commands')
      if (command == null) {
        setLastResult({
          at: new Date().toISOString(),
          contribution: item.id,
          message: t('extensionActionMissingCommand')
        })
        return
      }
      const result = await ctx.commands.execute(command, {
        contribution: item.id,
        extensionPoint: 'quick-actions',
        from: ctx.scope,
        host: view.host
      })
      setLastResult({
        at: new Date().toISOString(),
        contribution: item.id,
        extensionPoint: 'quick-actions',
        message: t('extensionActionExecuted'),
        result
      })
    } catch (error) {
      setLastResult({
        contribution: item.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const renderTab = ({ action, icon, label }) => (
    <button
      aria-controls='plugin-demo-tab-panel'
      aria-selected={activeDemoTab === action ? 'true' : 'false'}
      className={`plugin-demo__tab ${activeDemoTab === action ? 'is-active' : ''}`}
      data-action={action}
      key={action}
      onClick={() => void handleAction(action)}
      role='tab'
      title={label}
      type='button'
    >
      <Icon name={icon} />
      <span className='plugin-demo__tab-label'>{label}</span>
    </button>
  )

  const renderExtensionAction = item => {
    const title = resolveContributionText(item, 'title', item.id)
    const description = resolveContributionText(item, 'description', '')
    return (
      <button
        className='plugin-demo__extension-action'
        key={`${item.pluginScope}/${item.id}`}
        onClick={() => void handleExtensionAction(item)}
        title={description || title}
        type='button'
      >
        <Icon name={typeof item.icon === 'string' ? item.icon : 'extension'} />
        <span className='plugin-demo__tab-label'>{title}</span>
      </button>
    )
  }

  const renderConfigTitle = (icon, label) => (
    <div className='plugin-demo__config-title'>
      <span className='plugin-demo__config-icon'>
        <Icon name={icon} size='small' tone='muted' />
      </span>
      <span>{label}</span>
    </div>
  )

  const renderControlField = (icon, label, control) => (
    <label className='plugin-demo__field'>
      <span className='plugin-demo__field-icon' title={label}>
        <Icon name={icon} size='small' title={label} tone='muted' />
      </span>
      <span className='plugin-demo__control-mount'>{control}</span>
    </label>
  )

  const senderConfigPanel = (
    <aside aria-label={t('configSenderStyleOptions')} className='plugin-demo__config-panel'>
      <div className='plugin-demo__config-group'>
        {renderConfigTitle('layers', t('configSurface'))}
        <Segmented
          ariaLabel={t('configSurface')}
          iconOnly
          onChange={(value) => {
            const nextSurface = value === 'plain' ? 'plain' : 'chat'
            setSenderSurface(nextSurface)
            updateSenderConfig(t('senderStyleUpdated'), { surface: nextSurface })
          }}
          options={[
            { icon: 'forum', label: t('senderSurfaceChat'), value: 'chat' },
            { icon: 'crop_square', label: t('senderSurfacePlain'), value: 'plain' }
          ]}
          size='small'
          value={senderSurface}
        />
      </div>
      <div className='plugin-demo__config-group'>
        {renderConfigTitle('density_medium', t('configDensity'))}
        <Segmented
          ariaLabel={t('configDensity')}
          iconOnly
          onChange={(value) => {
            const nextDensity = value === 'compact' ? 'compact' : 'default'
            setSenderDensity(nextDensity)
            updateSenderConfig(t('senderStyleUpdated'), { density: nextDensity })
          }}
          options={[
            { icon: 'view_agenda', label: t('densityDefault'), value: 'default' },
            { icon: 'density_small', label: t('densityCompact'), value: 'compact' }
          ]}
          size='small'
          value={senderDensity}
        />
      </div>
      <div className='plugin-demo__config-group plugin-demo__config-group--wide'>
        {renderConfigTitle('visibility', t('configVisibility'))}
        <div className='plugin-demo__field-list'>
          {renderControlField(
            'vertical_align_top',
            t('senderShowHeader'),
            <Switch
              checked={senderShowHeader}
              onChange={(checked) => {
                setSenderShowHeader(checked)
                updateSenderConfig(t('senderVisibilityUpdated'), { showHeader: checked })
              }}
              size='small'
            />
          )}
          {renderControlField(
            'horizontal_rule',
            t('senderShowStatusBar'),
            <Switch
              checked={senderShowStatusBar}
              onChange={(checked) => {
                setSenderShowStatusBar(checked)
                updateSenderConfig(t('senderVisibilityUpdated'), { showStatusBar: checked })
              }}
              size='small'
            />
          )}
        </div>
      </div>
      <div className='plugin-demo__config-group plugin-demo__config-group--wide'>
        {renderConfigTitle('tune', t('configDefaults'))}
        <div className='plugin-demo__field-list'>
          {renderControlField(
            'subtitles',
            t('senderDefaultPlaceholder'),
            <Input
              ariaLabel={t('senderDefaultPlaceholder')}
              onChange={setSenderPlaceholder}
              onCommit={(value) => {
                setSenderPlaceholder(value)
                updateSenderConfig(t('senderDefaultsUpdated'), { placeholder: value.trim() || undefined })
              }}
              placeholder={t('senderFieldPlaceholder')}
              size='small'
              value={senderPlaceholder}
            />
          )}
          {renderControlField(
            'edit_note',
            t('senderDefaultText'),
            <Input
              ariaLabel={t('senderDefaultText')}
              onChange={setSenderInitialContent}
              onCommit={(value) => {
                setSenderInitialContent(value)
                updateSenderConfig(t('senderDefaultsUpdated'), { initialContent: value })
              }}
              placeholder={t('senderDefaultText')}
              size='small'
              value={senderInitialContent}
            />
          )}
          {renderControlField(
            'deployed_code',
            t('senderDefaultAdapter'),
            <Input
              ariaLabel={t('senderDefaultAdapter')}
              onChange={setSenderDefaultAdapter}
              onCommit={(value) => {
                setSenderDefaultAdapter(value)
                updateSenderConfig(t('senderDefaultsUpdated'), { defaultAdapter: value.trim() || undefined })
              }}
              placeholder={t('senderFieldAdapterPlaceholder')}
              size='small'
              value={senderDefaultAdapter}
            />
          )}
          {renderControlField(
            'model_training',
            t('senderDefaultModel'),
            <Input
              ariaLabel={t('senderDefaultModel')}
              onChange={setSenderDefaultModel}
              onCommit={(value) => {
                setSenderDefaultModel(value)
                updateSenderConfig(t('senderDefaultsUpdated'), { defaultModel: value.trim() || undefined })
              }}
              placeholder={t('senderFieldModelPlaceholder')}
              size='small'
              value={senderDefaultModel}
            />
          )}
        </div>
      </div>
    </aside>
  )

  const renderOverlayTab = (tab, icon, label) => (
    <button
      aria-controls='plugin-demo-overlay-panel'
      aria-selected={activeOverlayTab === tab ? 'true' : 'false'}
      className={`plugin-demo__overlay-tab ${activeOverlayTab === tab ? 'is-active' : ''}`}
      data-overlay-tab={tab}
      onClick={() => {
        setActiveDemoTab('overlay')
        setActiveHostComponent('overlay')
        setActiveOverlayTab(tab)
        setLastResult({
          at: new Date().toISOString(),
          host: view.host,
          message: t('overlayTabSelected'),
          overlayTab: tab
        })
      }}
      role='tab'
      title={label}
      type='button'
    >
      <Icon name={icon} />
      <span className='plugin-demo__tab-label'>{label}</span>
    </button>
  )

  const activeHostNode = (() => {
    if (activeHostComponent === 'sender') {
      return (
        <Sender
          {...senderConfig}
          autoFocus
          initialContent={senderInitialContent}
          onSend={(text) => {
            setLastResult({
              at: new Date().toISOString(),
              host: view.host,
              message: t('senderSubmitted'),
              text
            })
          }}
          submitLabel={t('senderSubmitLabel')}
        />
      )
    }

    if (activeHostComponent === 'projectFileTree') {
      return (
        <ProjectFileTree
          onOpenFile={(path) => {
            setLastResult({
              at: new Date().toISOString(),
              host: view.host,
              message: t('treeFileOpened'),
              path
            })
          }}
          showContextMenu
          showLoadingState
        />
      )
    }

    if (activeHostComponent === 'overlay') {
      const overlayContent = activeOverlayTab === 'tree'
        ? (
          <OverlayTree
            defaultCollapsedKeys={[]}
            nodes={treeNodes}
            onNodeActivate={(node) => {
              setLastResult({
                at: new Date().toISOString(),
                host: view.host,
                message: t('overlayTreeActivated'),
                node: node.key,
                overlayTab: activeOverlayTab
              })
            }}
            surface
          />
        )
        : (
          <OverlaySearchMenu
            emptyLabel={t('overlayNoCommands')}
            items={menuItems}
            onItemClick={(item) => {
              const nextOverlayMode = item.key === 'view-tree'
                ? 'tree'
                : item.key === 'view-list'
                ? 'menu'
                : overlayMode
              if (nextOverlayMode !== overlayMode) {
                setOverlayMode(nextOverlayMode)
              }
              setLastResult({
                at: new Date().toISOString(),
                host: view.host,
                item: item.key,
                message: t('overlayCommandSelected'),
                overlayMode: nextOverlayMode,
                overlayTab: activeOverlayTab
              })
            }}
            onSearchChange={setOverlaySearchValue}
            placeholder={t('overlaySearchPlaceholder')}
            searchValue={overlaySearchValue}
          />
        )

      return (
        <div className='plugin-demo__overlay-demo'>
          <div aria-orientation='vertical' className='plugin-demo__overlay-tabs' role='tablist'>
            {renderOverlayTab('commands', 'terminal', t('overlayCommands'))}
            {renderOverlayTab('tree', 'account_tree', t('overlayWorkspaceTree'))}
          </div>
          <div className='plugin-demo__overlay-content' id='plugin-demo-overlay-panel' role='tabpanel'>
            {overlayContent}
          </div>
        </div>
      )
    }

    return null
  })()

  const hostComponentClassName = [
    'plugin-demo__host-component',
    activeHostComponent != null ? 'is-active' : '',
    activeHostComponent === 'sender' ? 'plugin-demo__host-component--sender' : '',
    activeHostComponent === 'overlay' ? 'plugin-demo__host-component--overlay' : '',
    activeHostComponent === 'projectFileTree' ? 'plugin-demo__host-component--tree' : ''
  ].filter(Boolean).join(' ')

  const preview = (
    <div className='plugin-demo__preview'>
      <pre className='plugin-demo__pre'>{pretty(lastResult)}</pre>
      <section className={hostComponentClassName}>{activeHostNode}</section>
    </div>
  )

  return (
    <main className='plugin-demo'>
      <section className='plugin-demo__surface'>
        <div className='plugin-demo__shell'>
          <aside className='plugin-demo__rail'>
            <nav aria-orientation='vertical' className='plugin-demo__tabs' role='tablist'>
              {demoTabs.map(renderTab)}
            </nav>
            <section className='plugin-demo__extensions'>
              <div className='plugin-demo__extensions-title'>
                <Icon name='extension' size='small' tone='muted' />
                <span>{t('extensionActionsTitle')}</span>
              </div>
              {extensionActions.length > 0
                ? extensionActions.map(renderExtensionAction)
                : <p className='plugin-demo__extensions-empty'>{t('extensionActionsEmpty')}</p>}
            </section>
          </aside>
          <div className='plugin-demo__content' id='plugin-demo-tab-panel' role='tabpanel'>
            {activeHostComponent === 'sender'
              ? (
                <div className='plugin-demo__workbench plugin-demo__workbench--split'>
                  {senderConfigPanel}
                  {preview}
                </div>
              )
              : <div className='plugin-demo__workbench'>{preview}</div>}
          </div>
        </div>
      </section>
    </main>
  )
}
