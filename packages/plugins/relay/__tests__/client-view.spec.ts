import { readFile } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { activatePlugin } from '../src/client/index.js'
import { RelayHomeView, readJsonResponse } from '../src/client/react-view.js'
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

const installBrowser = () => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: {
      hash: '',
      href: 'http://127.0.0.1:5173/ui/plugins/relay/home/accounts',
      pathname: '/ui/plugins/relay/home/accounts',
      search: ''
    },
    open: vi.fn()
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

const createContext = () => {
  const react = createReactHost()
  let homeRegistration: PluginViewRegistration | undefined
  const ctx: PluginClientContext = {
    api: {
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ accounts: [], servers: [] }), {
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
      register: vi.fn(() => ({ dispose: vi.fn() }))
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
    react
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

    expect(react.createElement).toHaveBeenCalledWith(RelayHomeView, { ctx, view })
    expect(node).toMatchObject({
      props: { ctx, view },
      type: RelayHomeView
    })

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
})
