import { readFile } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { activatePlugin } from '../src/client/index.js'
import { RelayHomeView, readJsonResponse, renderAvatar } from '../src/client/react-view.js'
import { relayClientCss } from '../src/client/styles.js'
import type { PluginClientContext, PluginReactHost, PluginViewRegistration } from '../src/client/types.js'

const createReactHost = (): PluginReactHost & { createElement: ReturnType<typeof vi.fn> } => ({
  Fragment: Symbol.for('test.fragment'),
  createElement: vi.fn((type, props, ...children) => ({
    children,
    props,
    type
  })),
  useEffect: vi.fn(),
  useMemo: vi.fn(factory => factory()),
  useRef: vi.fn(initialValue => ({ current: initialValue })),
  useState: (initialValue => [
    typeof initialValue === 'function' ? (initialValue as () => unknown)() : initialValue,
    vi.fn()
  ]) as PluginReactHost['useState']
})

const installBrowser = (desktop = false) => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: {
      hash: '',
      href: 'http://127.0.0.1:5173/ui/plugins/relay/home/accounts',
      pathname: '/ui/plugins/relay/home/accounts',
      search: ''
    },
    open: vi.fn(),
    ...(desktop ? { oneworksDesktop: {} } : {})
  })
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    createElement: vi.fn(() => ({
      remove: vi.fn(),
      textContent: ''
    })),
    head: {
      appendChild: vi.fn()
    },
    removeEventListener: vi.fn()
  })
}

const createContext = (status: Record<string, unknown> = { accounts: [], servers: [] }) => {
  const react = createReactHost()
  let homeRegistration: PluginViewRegistration | undefined
  const registerSlot = vi.fn(() => ({ dispose: vi.fn() }))
  const ctx: PluginClientContext = {
    api: {
      fetch: vi.fn(async () =>
        new Response(JSON.stringify(status), {
          headers: { 'content-type': 'application/json' }
        })
      )
    },
    commands: {
      register: vi.fn(() => ({ dispose: vi.fn() }))
    },
    react,
    scope: 'relay',
    slots: {
      register: registerSlot
    },
    views: {
      register: vi.fn((viewId, registration) => {
        if (viewId === 'home') {
          homeRegistration = registration as PluginViewRegistration
        }
        return { dispose: vi.fn() }
      })
    }
  }
  return {
    ctx,
    getHomeRegistration: () => homeRegistration,
    react,
    registerSlot
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay plugin client view registration', () => {
  it('registers the home view as a React-only renderer', async () => {
    installBrowser()
    const { ctx, getHomeRegistration, react } = createContext()

    const cleanup = await activatePlugin(ctx)
    const homeRegistration = getHomeRegistration()

    expect(homeRegistration).toBeDefined()
    expect(homeRegistration).not.toHaveProperty('render')
    expect(homeRegistration?.renderNode).toEqual(expect.any(Function))

    const view = { route: { setActions: vi.fn(), setBreadcrumb: vi.fn(), setTitle: vi.fn() } }
    const node = homeRegistration?.renderNode?.(view)

    expect(react.createElement).toHaveBeenCalledWith(RelayHomeView, {
      ctx,
      onAccountChanged: expect.any(Function),
      view
    })
    expect(node).toMatchObject({
      props: { ctx, view },
      type: RelayHomeView
    })

    cleanup.dispose()
  })

  it('registers a direct login footer action when no account is signed in', async () => {
    installBrowser()
    const { ctx, registerSlot } = createContext()

    const cleanup = await activatePlugin(ctx)

    await vi.waitFor(() => {
      expect(registerSlot).toHaveBeenCalledWith('nav.footer.before', {
        icon: 'login',
        id: 'account-login',
        route: '/plugins/relay/home/accounts/login',
        title: 'Log in'
      })
    })

    cleanup.dispose()
  })

  it('keeps the account popover when a signed-in account exists', async () => {
    installBrowser()
    const { ctx, registerSlot } = createContext({
      accounts: [{ accountKey: 'local:owner', name: 'Owner', sessionAuthenticated: true }],
      servers: [{ id: 'local', name: 'Local', remoteBaseUrl: 'http://127.0.0.1:48890' }]
    })

    const cleanup = await activatePlugin(ctx)

    await vi.waitFor(() => {
      expect(registerSlot).toHaveBeenCalledWith(
        'nav.footer.before',
        expect.objectContaining({
          accountPopover: expect.objectContaining({
            actions: expect.arrayContaining([
              expect.objectContaining({
                id: 'login',
                route: '/plugins/relay/home/accounts/login'
              })
            ])
          }),
          id: 'account-popover'
        })
      )
    })

    cleanup.dispose()
  })

  it('opens the native login route in Electron', async () => {
    installBrowser(true)
    const { ctx, registerSlot } = createContext()

    const cleanup = await activatePlugin(ctx)

    await vi.waitFor(() => {
      expect(registerSlot).toHaveBeenCalledWith('nav.footer.before', {
        icon: 'login',
        id: 'account-login',
        route: '/plugins/relay/home/accounts/login',
        title: 'Log in'
      })
    })

    cleanup.dispose()
  })

  it('keeps the latest account footer when status requests resolve out of order', async () => {
    installBrowser()
    let resolveInitialStatus: ((response: Response) => void) | undefined
    let resolveLatestStatus: ((response: Response) => void) | undefined
    const initialStatus = new Promise<Response>((resolve) => {
      resolveInitialStatus = resolve
    })
    const latestStatus = new Promise<Response>((resolve) => {
      resolveLatestStatus = resolve
    })
    const { ctx, getHomeRegistration, registerSlot } = createContext()
    ctx.api.fetch = vi.fn()
      .mockReturnValueOnce(initialStatus)
      .mockReturnValueOnce(latestStatus)

    const cleanup = await activatePlugin(ctx)
    await vi.waitFor(() => expect(ctx.api.fetch).toHaveBeenCalledTimes(1))
    const node = getHomeRegistration()?.renderNode?.() as {
      props?: { onAccountChanged?: () => Promise<void> }
    }
    const latestRefresh = node.props?.onAccountChanged?.()
    await vi.waitFor(() => expect(ctx.api.fetch).toHaveBeenCalledTimes(2))

    resolveLatestStatus?.(
      new Response(
        JSON.stringify({
          accounts: [{ accountKey: 'local:owner', name: 'Owner', sessionAuthenticated: true }],
          servers: [{ id: 'local', name: 'Local', remoteBaseUrl: 'http://127.0.0.1:48890' }]
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    )
    await latestRefresh
    await vi.waitFor(() => {
      expect(registerSlot).toHaveBeenLastCalledWith(
        'nav.footer.before',
        expect.objectContaining({
          accountPopover: expect.any(Object),
          id: 'account-popover'
        })
      )
    })

    resolveInitialStatus?.(
      new Response(JSON.stringify({ accounts: [], servers: [] }), {
        headers: { 'content-type': 'application/json' }
      })
    )
    await initialStatus
    await Promise.resolve()

    expect(registerSlot).toHaveBeenCalledTimes(1)
    expect(registerSlot).not.toHaveBeenCalledWith(
      'nav.footer.before',
      expect.objectContaining({ id: 'account-login' })
    )

    cleanup.dispose()
  })

  it('uses JSON error fields instead of displaying the raw JSON body', async () => {
    await expect(readJsonResponse(
      new Response(JSON.stringify({ error: 'fetch failed' }), { status: 500 }),
      'profile'
    )).rejects.toThrow('fetch failed')
    await expect(readJsonResponse(
      new Response(JSON.stringify({ message: 'Profile service unavailable' }), { status: 503 }),
      'profile'
    )).rejects.toThrow('Profile service unavailable')
  })
})

describe('relay plugin client view styles', () => {
  it('keeps avatar initials visible when a configured image fails to load', () => {
    const react = createReactHost()
    const avatar = renderAvatar(react, {
      avatarUrl: 'https://cdn.example.com/missing.png',
      name: 'Official Dev',
      presence: 'offline',
      presenceLabel: '服务不可用',
      state: 'server'
    }) as {
      children: Array<{
        children: unknown[]
        props: Record<string, unknown>
        type: string
      }>
    }
    const image = avatar.children[0]
    const fallback = avatar.children[1]
    const presence = avatar.children[2]
    const target = {
      hidden: false,
      parentElement: { removeAttribute: vi.fn(), setAttribute: vi.fn() }
    }

    expect(fallback.props.className).toBe('oneworks-relay__account-avatar-fallback')
    expect(fallback.children).toEqual(['OD'])
    expect(image.type).toBe('img')
    expect(image.props.src).toBe('https://cdn.example.com/missing.png')
    ;(image.props.onError as (event: { currentTarget: typeof target }) => void)({ currentTarget: target })
    expect(target.hidden).toBe(true)
    expect(target.parentElement.removeAttribute).toHaveBeenCalledWith('data-has-image')
    ;(image.props.onLoad as (event: { currentTarget: typeof target }) => void)({ currentTarget: target })
    expect(target.hidden).toBe(false)
    expect(target.parentElement.setAttribute).toHaveBeenCalledWith('data-has-image', 'true')
    expect(presence.props).toMatchObject({
      className: 'oneworks-relay__account-avatar-presence',
      'data-state': 'offline',
      title: '服务不可用'
    })
  })

  it('renders Relay login as a native client page instead of an iframe', async () => {
    const source = await readFile(new URL('../src/client/react-view.ts', import.meta.url), 'utf8')
    const serversPageSource = source.slice(
      source.indexOf('const ServersPage'),
      source.indexOf('const tokenEditorInitialState')
    )

    expect(source).toContain('createRelayLoginOptions(ctx, {')
    expect(source).toContain("className: 'oneworks-relay__login-native'")
    expect(source).toContain("className: 'oneworks-relay__login-method-switcher'")
    expect(source).toMatch(/renderLoginField\(\s*'person'/u)
    expect(source).toMatch(/renderLoginField\(\s*'password'/u)
    expect(source).toMatch(/renderLoginField\(\s*'key'/u)
    expect(source).toMatch(/renderLoginField\(\s*'pin'/u)
    expect(source).not.toContain("className: 'oneworks-relay__login-field-label'")
    expect(source).toContain('readRelayRememberedLogins')
    expect(source).toContain("label: '登录到其他服务器'")
    expect(source).toContain('`无法读取 ${serverName} 登录能力`')
    expect(source).toContain('`打开 ${serverName} 兼容登录页`')
    expect(source).toContain('serverName: selectedServerDisplayName(status, route.serverId)')
    expect(source).not.toContain("'cloud_off'")
    expect(source).toContain('openLoginDestination(provider.startUrl)')
    expect(source).toContain('desktopApi?.openExternalUrl')
    expect(source).not.toContain("className: 'oneworks-relay__login-header'")
    expect(source).not.toContain("react.createElement('iframe'")
    expect(source).toContain('serviceInfo == null ? server.avatarUrl : serviceInfo.avatarUrl')
    expect(serversPageSource).toContain("role: editing ? undefined : 'link'")
    expect(serversPageSource).toContain('onClick: editing ? undefined : openServerLogin')
    expect(serversPageSource).toContain('`登录到 ${title}，${presenceAccessibleLabel}`')
    expect(serversPageSource).not.toContain("icon: 'login'")
    expect(relayClientCss).toContain('.oneworks-relay--login-route .oneworks-relay__shell { background-image: none; }')
    expect(relayClientCss).toContain('background: transparent; box-shadow: none;')
    expect(relayClientCss).toContain(
      'font-size: var(--oneworks-relay-account-avatar-font-size); line-height: 1;'
    )
    expect(relayClientCss).toContain('.oneworks-relay__account-avatar-fallback')
    expect(relayClientCss).toContain('.oneworks-relay__account-avatar[data-has-image="true"]')
    expect(relayClientCss).toContain('.oneworks-relay__account-avatar-presence[data-state="online"]')
    expect(relayClientCss).toContain(
      '.oneworks-relay__server-editor .plugin-host-control-input.ant-input-affix-wrapper .ant-input'
    )
    expect(relayClientCss).toContain(
      '.oneworks-relay__account-avatar-image:not([hidden]) + .oneworks-relay__account-avatar-fallback'
    )
    expect(relayClientCss).toContain('--oneworks-relay-login-gap: 10px;')
    expect(relayClientCss).toContain(
      '.oneworks-relay--launcher-login .oneworks-relay__surface { min-height: 0; height: 100%; align-content: center; }'
    )
    expect(relayClientCss).toContain('.plugin-view-host--launcher .oneworks-relay,')
    expect(relayClientCss).toContain(
      '.plugin-view-host--launcher .oneworks-relay__project-rule-tab-panel { background: transparent; }'
    )
    expect(relayClientCss).toContain(
      '.plugin-view-host--launcher .oneworks-relay__shell { background-image: none; }'
    )
    expect(relayClientCss).toContain('background: var(--oneworks-relay-surface-background);')
    expect(source).toContain("launcherSurface ? ' oneworks-relay--launcher-login' : ''")
    expect(source).toContain("label: launcherSurface ? '登录' : '登录账号'")
    expect(source).toMatch(/const accountActions:[\s\S]*?launcherSurface\s*\? \[loginAction\]/u)
    expect(relayClientCss).toContain(
      'oneworks-relay__login-footer { min-width: 0; display: grid; gap: var(--oneworks-relay-login-gap); padding-top: 0; }'
    )
    expect(relayClientCss).not.toContain(
      '.oneworks-relay--login-route .oneworks-relay__surface { min-height: calc(100dvh - var(--route-container-header-overlay-height, 39px) - 24px); align-content: center; justify-items: center; padding: 20px; background: radial-gradient'
    )
  })

  it('does not stack native tab margin on the host route spacing', () => {
    expect(relayClientCss).toContain('.oneworks-relay__project-rule-detail { gap: 0; }')
    expect(relayClientCss).toContain(
      '.oneworks-relay__project-rule-detail > .oneworks-relay__project-rule-tabs { margin-block-start: 0; }'
    )
    expect(relayClientCss).not.toContain(
      '.oneworks-relay__project-rule-detail > .oneworks-relay__project-rule-tabs { margin-block-start: 0; padding-block-start:'
    )
    expect(relayClientCss).not.toContain(
      '.oneworks-relay__project-rule-detail { gap: 0; padding-block-start:'
    )
    expect(relayClientCss).not.toContain(
      '.oneworks-relay__project-rule-tabs + .oneworks-relay__project-rule-tab-panel'
    )
    expect(relayClientCss).toContain(
      '.oneworks-relay__shell { width: 100%; min-width: 0; min-height: 100%;'
    )
    expect(relayClientCss).toContain(
      '.oneworks-relay--project-rule-route .oneworks-relay__surface { align-content: stretch; }'
    )
    expect(relayClientCss).toContain(
      'background-image: linear-gradient(var(--oneworks-relay-surface-background), var(--oneworks-relay-surface-background));'
    )
    expect(relayClientCss).toContain(
      '.oneworks-relay__personal-docs-list .interaction-list__items { background-image:'
    )
    expect(relayClientCss).toContain(
      '.oneworks-relay__surface { width: 100%; min-width: 0; display: grid; align-content: start;'
    )
  })
})

describe('relay project rule detail interaction', () => {
  it('auto-saves settings and omits the duplicate team hero', async () => {
    const source = await readFile(new URL('../src/client/react-view.ts', import.meta.url), 'utf8')

    expect(source).toContain('const updateAndSaveAssignment = (')
    expect(source.match(/updateAndSaveAssignment\(assignment, index,/g)).toHaveLength(3)
    expect(source).not.toContain('queueAssignmentSave(assignment, index, nextDraft)')
    expect(source).toContain('const commitRepository = async (')
    expect(source).toContain('if (result.saved && result.current) setRepositoryEdit(null)')
    expect(source).toContain('const projectRuleAssignmentSaveQueue = createSerializedSaveQueue()')
    expect(source).toContain('projectRuleAssignmentSaveQueue.waitForIdleByPrefix(')
    expect(source).toContain('projectRuleProfileSaveKeyPrefix(accountKey, teamId, profileId)')
    expect(source).toContain('projectRuleAssignmentSaveQueue.enqueue(saveQueueKey')
    expect(source).toContain('if (!result.saved && result.latest && result.current)')
    expect(source).toContain('detailRequestRef.current === requestId')
    expect(source).toContain('}, [accountKey, profileId, routeStateKey, teamId])')
    expect(source).toContain('setRepositoryEdit(null)')
    expect(source).toContain('loadedDetail?.routeStateKey === routeStateKey')
    expect(source).toContain("const projectRuleStateId = cleanText(rule.source?.assignmentId ?? rule.ruleId) ?? ''")
    expect(source).toContain('routeStateRef.current.generation === saveRouteGeneration')
    expect(source).toContain('const [savingIds, setSavingIds] = react.useState<Set<string>>(new Set())')
    expect(source).not.toContain('setSavingId(')
    expect(source).toContain("label: '确认仓库'")
    expect(source).toContain("label: '取消编辑'")
    expect(source).toContain("'Git 仓库地址无效'")
    expect(source).toMatch(
      /key: `\$\{projectAssignmentDraftKey\(assignment, assignmentIndex\)\}:repository:\$\{repositoryIndex\}`/u
    )
    expect(source).not.toMatch(/key: `\$\{rowIndex\}:\$\{repository\}`/u)
    expect(source).toContain("placeholder: '搜索 Git 仓库、组织或仓库地址'")
    expect(source).toContain("ariaLabel: '搜索 Git 仓库规则'")
    expect(source).toContain('repositoryEdit?.key === item.key')
    const rulesPanelSource = source.slice(source.indexOf('const rulesPanel ='), source.indexOf('const settingsPanel ='))
    expect(rulesPanelSource).not.toContain('onCommit:')
    expect(source).toContain(
      "contextRef.current.notifications?.show?.({ description, level: 'error', title })"
    )
    expect(source).not.toContain("label: saving ? '保存中' : '保存设置'")
    expect(source).toContain('launcherSurface || routeDetailActive ? null')
  })

  it('renders project-rule documents from their independent assignment scope', async () => {
    const source = await readFile(new URL('../src/client/react-view.ts', import.meta.url), 'utf8')

    expect(source).toContain("{ icon: 'description', key: 'documents', label: '文档' }")
    expect(source).toContain("scope: 'projectRule'")
    expect(source).toContain('status?.projectRuleDocumentSync?.[projectRule.assignmentId]')
    expect(source).toContain('projectRule: {')
    expect(source).toContain('key: `document:' + '$' + '{documentItemScopeKey}:' + '$' + '{entry.relativePath}`')
    expect(source).not.toContain(
      'key: `document:' + '$' + "{projectRuleScope ? 'projectRule' : teamScope ? 'team' : 'account'}:" + '$' +
        '{entry.path}`'
    )
    expect(source).toContain("readDocumentPanelQueryValue('doc') === '' ? 'rules' : 'documents'")
    expect(source).toContain('react.useState<RelayProjectRuleDetailTab>(initialProjectRuleDetailTab)')
    expect(source).toContain("if (projectRuleDocumentQuery !== '')")
    expect(source).toContain('const CodeEditor = view?.ui?.CodeEditor')
    expect(source).toContain("className: 'oneworks-relay__document-preview-editor'")
    expect(source).toContain("language: 'markdown'")
    expect(source).toContain("if (nextTab !== 'documents')")
    expect(source).toContain("writeDocumentPanelQuery({ documentPath: null, search: '' })")
    expect(source).not.toContain('关联文件')
    expect(source).not.toContain('renderProjectRuleFiles')
  })

  it('uses server-provided SSO icon identities without a redundant section title', async () => {
    const source = await readFile(new URL('../src/client/react-view.ts', import.meta.url), 'utf8')

    expect(source).toContain("provider.icon === 'google'")
    expect(source).toContain("provider.icon === 'github'")
    expect(source).toContain('iconNode: renderProviderIcon(provider)')
    const ssoSection = source.slice(
      source.indexOf("{ className: 'oneworks-relay__login-sso oneworks-relay__login-section' }"),
      source.indexOf("{ className: 'oneworks-relay__login-provider-grid' }")
    )
    expect(ssoSection).not.toContain('options.messages.signInWithSso')
  })
})
