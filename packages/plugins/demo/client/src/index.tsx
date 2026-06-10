const readPluginVersion = () => {
  try {
    return new URL(import.meta.url).searchParams.get('pluginVersion') ?? String(Date.now())
  } catch {
    return String(Date.now())
  }
}

const importWithPluginVersion = (modulePath, pluginVersion) =>
  import(`${modulePath}?pluginVersion=${encodeURIComponent(pluginVersion)}`)

const isSourceEntry = () => {
  try {
    return new URL(import.meta.url).pathname.includes('/client/src/')
  } catch {
    return false
  }
}

const resolvePeerModule = (name, sourceExtension = 'ts') =>
  isSourceEntry() ? `./${name}.${sourceExtension}` : `./${name}.js`

const loadDemoModules = async () => {
  const pluginVersion = readPluginVersion()
  const [
    { pluginDemoCss },
    { createTranslator, getLocalizedMessage },
    demoModel,
    { PluginDemoView }
  ] = await Promise.all([
    importWithPluginVersion(resolvePeerModule('styles'), pluginVersion),
    importWithPluginVersion(resolvePeerModule('i18n'), pluginVersion),
    importWithPluginVersion(resolvePeerModule('demo-model'), pluginVersion),
    importWithPluginVersion(resolvePeerModule('view', 'tsx'), pluginVersion)
  ])

  return {
    pluginDemoViewDeps: {
      createTranslator,
      eventName: demoModel.eventName,
      getDemoTabs: demoModel.getDemoTabs,
      getInitialResult: demoModel.getInitialResult,
      pretty: demoModel.pretty
    },
    PluginDemoView,
    createTranslator,
    emitDemoEvent: demoModel.emitDemoEvent,
    getLocalizedMessage,
    pluginDemoCss
  }
}

const registerDemoView = (ctx, viewId, variant, PluginDemoView, pluginDemoViewDeps) =>
  ctx.views.register(viewId, {
    renderNode: view =>
      ctx.react.createElement(PluginDemoView, {
        ...pluginDemoViewDeps,
        ctx,
        react: ctx.react,
        variant,
        view
      })
  })

export async function activatePlugin(ctx) {
  const {
    PluginDemoView,
    createTranslator,
    emitDemoEvent,
    getLocalizedMessage,
    pluginDemoViewDeps,
    pluginDemoCss
  } = await loadDemoModules()
  const style = document.createElement('style')
  style.textContent = pluginDemoCss
  document.head.appendChild(style)
  const t = createTranslator(ctx.i18n)

  const disposables = [
    registerDemoView(ctx, 'overview', 'route', PluginDemoView, pluginDemoViewDeps),
    registerDemoView(ctx, 'panel', 'bottom tab', PluginDemoView, pluginDemoViewDeps),
    registerDemoView(ctx, 'drawer', 'right drawer', PluginDemoView, pluginDemoViewDeps),
    ctx.commands.register('say-hi', (payload) => {
      ctx.notifications.show({
        actions: [
          {
            closeOnClick: false,
            icon: 'send',
            id: 'emit-event',
            title: t('notificationActionEmitEvent'),
            onClick: () => {
              emitDemoEvent({
                at: new Date().toISOString(),
                command: 'say-hi',
                payload
              })
            }
          }
        ],
        description: t('commandSayHiDescription', { from: payload?.from ?? t('commandChatHeader') }),
        level: 'info',
        title: t('commandSayHiTitle')
      })
      emitDemoEvent({
        at: new Date().toISOString(),
        command: 'say-hi',
        payload
      })
      return { ok: true }
    }),
    ctx.commands.register('call-server', async (payload) => {
      const result = await ctx.commands.execute('server-ping', {
        at: new Date().toISOString(),
        from: 'client-command',
        payload
      })
      ctx.notifications.show({
        description: t('commandServerRepliedDescription', { scope: ctx.scope }),
        level: 'success',
        title: t('commandServerRepliedTitle')
      })
      emitDemoEvent({
        at: new Date().toISOString(),
        command: 'call-server',
        result
      })
      return result
    }),
    ctx.pluginApis.register({
      id: 'describe-extension-point',
      title: {
        en: 'Describe extension point',
        'zh-Hans': '描述扩展点'
      },
      description: {
        en: 'Returns host-side metadata for extension plugins that contribute to Plugin Demo.',
        'zh-Hans': '向扩展插件返回 Plugin Demo 的宿主侧扩展点元数据。'
      },
      inputSchema: {
        type: 'object',
        properties: {
          extensionPoint: { type: 'string' },
          contribution: { type: 'string' }
        },
        additionalProperties: true
      },
      outputSchema: {
        type: 'object',
        required: ['scope', 'extensionPoint', 'ready'],
        properties: {
          scope: { type: 'string' },
          extensionPoint: { type: 'string' },
          ready: { type: 'boolean' },
          received: { type: 'object' }
        },
        additionalProperties: true
      },
      handler: input => ({
        at: new Date().toISOString(),
        extensionPoint: 'demo/quick-actions',
        ready: true,
        received: input,
        scope: ctx.scope
      })
    }),
    ctx.launcher.registerSearchProvider({
      command: 'say-hi',
      id: 'client-local',
      search: (query) => {
        const searchLabel = query || t('launcherEmptyQuery')
        return [{
          icon: 'layers',
          id: `client-local-${query || 'empty'}`,
          title: t('commandLocalResultTitle', { query: searchLabel })
        }]
      },
      title: t('commandLocalSearchTitle'),
      titleI18n: getLocalizedMessage('commandLocalSearchTitle')
    }),
    ctx.hot.accept(() => {})
  ]

  return {
    dispose() {
      disposables.forEach(disposable => disposable.dispose())
      style.remove()
    }
  }
}
