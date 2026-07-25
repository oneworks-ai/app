import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'

import { transformWithEsbuild } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../client/src/view.tsx', import.meta.url), 'utf8')
const stylesSource = readFileSync(new URL('../client/src/styles.ts', import.meta.url), 'utf8')
const transformed = await transformWithEsbuild(source, 'view.tsx', {
  format: 'esm',
  jsxFactory: 'h',
  loader: 'tsx',
  target: 'es2022'
})
const viewModule = await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`) as {
  ChromeDriverView: (props: Record<string, unknown>) => unknown
}

afterEach(() => vi.unstubAllGlobals())

const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

const renderRefreshScheduler = () => {
  const effects: Array<() => undefined | (() => void)> = []
  const timers: Array<() => Promise<void>> = []
  const listeners = new Map<string, () => void>()
  const requests: Array<{
    command: string
    reject: (reason: unknown) => void
    resolve: (value: unknown) => void
  }> = []
  const state: unknown[] = [0, null, null, [], '', null, 'connection', null, '', 'always_ask']
  let stateIndex = 0
  const execute = vi.fn((command: string) =>
    new Promise((resolve, reject) => {
      requests.push({ command, reject, resolve })
    })
  )
  const testWindow = {
    addEventListener: vi.fn(),
    clearTimeout: vi.fn(),
    postMessage: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: vi.fn((callback: () => Promise<void>) => {
      timers.push(callback)
      return timers.length
    })
  }
  const testDocument = {
    addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
    removeEventListener: vi.fn(),
    visibilityState: 'visible'
  }
  vi.stubGlobal('window', testWindow)
  vi.stubGlobal('document', testDocument)
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:5207' })

  const react = {
    createElement: () => null,
    Fragment: 'fragment',
    useCallback: <T>(value: T) => value,
    useEffect: (callback: () => undefined | (() => void)) => effects.push(callback),
    useMemo: <T>(factory: () => T) => factory(),
    useRef: <T>(initial: T) => ({ current: initial }),
    useState: <T>(initial: T) => {
      const index = stateIndex++
      if (state[index] === undefined) state[index] = initial
      return [state[index], (update: T | ((current: T) => T)) => {
        state[index] = typeof update === 'function'
          ? (update as (current: T) => T)(state[index] as T)
          : update
      }] as const
    }
  }

  viewModule.ChromeDriverView({
    ctx: { commands: { execute } },
    react,
    view: {
      i18n: { resolveText: (value: Record<string, string>, fallback: string) => value.en ?? fallback },
      ui: {
        Button: 'button',
        Icon: 'icon',
        Input: 'input',
        NativeTabs: 'tabs',
        Select: 'select',
        SettingsRow: 'row',
        SettingsSection: 'section',
        Switch: 'switch'
      }
    }
  })

  const settleRequest = (command: string, value: unknown, rejection = false) => {
    const index = requests.findIndex(request => request.command === command)
    expect(index).toBeGreaterThanOrEqual(0)
    const [request] = requests.splice(index, 1)
    if (rejection) request?.reject(value)
    else request?.resolve(value)
  }

  return {
    effects,
    listeners,
    requests,
    settleRequest,
    state,
    testDocument,
    timers
  }
}

const renderConnectionLifecycle = (status: Record<string, unknown>) => {
  const effects: Array<{ callback: () => void; dependencies: unknown[] }> = []
  const frameSetter = vi.fn()
  const stateValues = [
    0,
    status,
    null,
    [{ document_id: 'old-document', frame_id: 0, url: 'https://old.example/' }],
    '',
    null,
    'web-frames'
  ]
  let stateIndex = 0
  const react = {
    createElement: () => null,
    Fragment: 'fragment',
    useCallback: <T>(value: T) => value,
    useEffect: (callback: () => void, dependencies: unknown[]) => effects.push({ callback, dependencies }),
    useMemo: <T>(factory: () => T) => factory(),
    useRef: <T>(initial: T) => ({ current: initial }),
    useState: <T>(initial: T) => {
      const index = stateIndex++
      return [stateValues[index] ?? initial, index === 3 ? frameSetter : vi.fn()] as const
    }
  }

  viewModule.ChromeDriverView({
    ctx: { commands: { execute: vi.fn().mockResolvedValue({}) } },
    react,
    view: {
      i18n: { resolveText: (value: Record<string, string>, fallback: string) => value.en ?? fallback },
      ui: {
        Button: 'button',
        Icon: 'icon',
        NativeTabs: 'tabs',
        SettingsRow: 'row',
        SettingsSection: 'section',
        Switch: 'switch'
      }
    }
  })

  const connection = status.connection as Record<string, unknown> | undefined
  const expectedTarget = status.connected === true
    ? JSON.stringify([connection?.connection_id, connection?.oneworks_tab_id])
    : null
  const lifecycleEffect = effects.find(effect =>
    effect.dependencies.length === 1 &&
    effect.dependencies[0] === expectedTarget
  )
  expect(lifecycleEffect).toBeDefined()
  lifecycleEffect?.callback()
  return { dependencies: lifecycleEffect?.dependencies, frameSetter }
}

const renderStaleFrameRequest = (framesResponse: Promise<unknown>) => {
  const buttons: Array<Record<string, unknown>> = []
  const frameSetter = vi.fn()
  const activeFrameTargetRef = { current: JSON.stringify(['connection-a', 101]) }
  const stateValues = [
    0,
    {
      connected: true,
      connection: { connection_id: 'connection-a', oneworks_tab_id: 101 }
    },
    null,
    [],
    '',
    null,
    'web-frames'
  ]
  let stateIndex = 0
  let refIndex = 0
  const execute = vi.fn((command: string) => command === 'list-web-frames' ? framesResponse : Promise.resolve({}))
  const react = {
    createElement: (type: unknown, props: Record<string, unknown> | null) => {
      if (type === 'button' && props != null) buttons.push(props)
      return null
    },
    Fragment: 'fragment',
    useCallback: <T>(value: T) => value,
    useEffect: () => undefined,
    useMemo: <T>(factory: () => T) => factory(),
    useRef: <T>(initial: T) => refIndex++ === 0 ? activeFrameTargetRef : { current: initial },
    useState: <T>(initial: T) => {
      const index = stateIndex++
      return [stateValues[index] ?? initial, index === 3 ? frameSetter : vi.fn()] as const
    }
  }

  viewModule.ChromeDriverView({
    ctx: { commands: { execute } },
    react,
    view: {
      i18n: { resolveText: (value: Record<string, string>, fallback: string) => value.en ?? fallback },
      ui: {
        Button: 'button',
        Icon: 'icon',
        NativeTabs: 'tabs',
        SettingsRow: 'row',
        SettingsSection: 'section',
        Switch: 'switch'
      }
    }
  })

  const discover = buttons.find(button => button.label === 'Discover frames')
  expect(discover?.onClick).toBeTypeOf('function')
  return {
    activeFrameTargetRef,
    frameSetter,
    request: (discover?.onClick as () => Promise<void>)()
  }
}

describe('external browser settings tabs', () => {
  it('uses the host-native tabs in the intended information order', () => {
    expect(source).toContain(
      'const { Button, Icon, Input, NativeTabs, Select, SettingsRow, SettingsSection, Switch } = view.ui'
    )
    expect(source).toContain("const [activeTab, setActiveTab] = useState('connection')")
    expect(source).toContain("ariaLabel={t('External browser settings', '外部浏览器设置')}")
    expect(source).toContain("className='native-tabs-panel'")
    expect(stylesSource.match(/\.chrome-driver \{([^}]*)\}/)?.[1]).not.toContain('gap:')
    expect(stylesSource).toContain('margin-block-end: var(--subpage-secondary-gap')
    expect(stylesSource).toContain('.chrome-driver__site-rule-form .plugin-host-control-select.ant-select')
    expect(stylesSource).toContain('height: 40px;')

    const labels = [
      "label: t('Connection', '连接')",
      "label: t('Advanced access', '高级访问')",
      "label: t('Website permissions', '网站权限')",
      "label: t('Web Frames', 'Web Frame')",
      "label: t('Review & audit', '确认与审计')"
    ]
    const positions = labels.map(label => source.indexOf(label))

    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('isolates connection, advanced access, and Web Frame operations by active tab', () => {
    expect(source).toContain("{activeTab === 'connection' && <SettingsSection")
    expect(source).toContain("{activeTab === 'advanced-access' && <SettingsSection")
    expect(source).toContain("{activeTab === 'site-permissions' && <SettingsSection")
    expect(source).toContain("{activeTab === 'web-frames' && <SettingsSection")
  })

  it('edits persistent website permission rules without requiring a browser connection', () => {
    expect(source).toContain("ctx.commands.execute('get-site-permissions', {})")
    expect(source).toContain("ctx.commands.execute('add-site-permission', { mode: siteMode, pattern })")
    expect(source).toContain("ctx.commands.execute('set-site-permission', { mode, rule_id: ruleId })")
    expect(source).toContain("ctx.commands.execute('remove-site-permission', { rule_id: ruleId })")
    expect(source).toContain('Rules are saved in OneWorks and work without a browser connection')
    expect(source).toContain('New rules are added first, and the first match wins')
    expect(source).toContain('advanced access still asks every time')
    expect(source).not.toContain('disabled={!status?.connected || sitePermissions')
  })

  it('keeps the Chrome Web Store install entry visible in the connection tab', () => {
    expect(source).toContain(
      'https://chromewebstore.google.com/detail/oneworks-external-browser/eiikbhfmjohfcldcmgjikafpmpbfipbi'
    )
    expect(source).toContain("label={t('Install extension', '安装扩展')}")
    expect(source).toContain('onClick={openExtensionStore}')
  })

  it('polls only live state without repainting for heartbeat-only changes', () => {
    expect(source).toContain("const loadStatus = useCallback(() => ctx.commands.execute('status', {})")
    expect(source).toContain('await pollLiveState()')
    expect(source).toContain("document.addEventListener('visibilitychange', refreshVisiblePage)")
    expect(source).toContain('browserStatusViewSnapshot(current) === browserStatusViewSnapshot(nextStatus)')
    expect(source).toContain('const { last_seen_at: _lastSeenAt, ...stableConnection } = status.connection')
    expect(source).not.toContain('setInterval(() => void refresh(), 2500)')

    const pollingBody = source.slice(
      source.indexOf('const pollLiveStateNow'),
      source.indexOf('useEffect(() => {', source.indexOf('const pollLiveStateNow'))
    )
    expect(pollingBody).toContain('loadStatus()')
    expect(pollingBody).toContain('loadAdvancedAccess()')
    expect(pollingBody).not.toContain('get-site-permissions')
    expect(source).toContain('requestStateRef.current.tail.then')
    expect(source).toContain("current?.source === 'configuration'")
  })

  it('keeps connection guidance without repeating internal diagnostics', () => {
    expect(source).toContain('status?.connected !== true &&')
    expect(source).toContain("className='chrome-driver__hint chrome-driver__hint--connection'")
    expect(source).not.toContain("title={t('Connection details', '连接详情')}")
    expect(source).not.toContain("t('Protocol', '协议')")
    expect(source).not.toContain("t('Activity', '活动')")
    expect(source).not.toContain("className='chrome-driver__facts'")
    expect(stylesSource).not.toContain('.chrome-driver__facts')
  })

  it('serializes a live poll behind an in-flight full refresh', async () => {
    const runtime = renderRefreshScheduler()
    const cleanup = runtime.effects[1]?.()
    await flushMicrotasks()

    expect(runtime.requests.map(request => request.command)).toEqual([
      'status',
      'get-advanced-access',
      'get-site-permissions'
    ])
    const polling = runtime.timers[0]?.()
    await flushMicrotasks()
    expect(runtime.requests).toHaveLength(3)

    runtime.settleRequest('status', { connected: false, protocol_version: 1 })
    runtime.settleRequest('get-advanced-access', { result: { sync_state: 'pending_connection' } })
    runtime.settleRequest('get-site-permissions', { result: { rules: [] } })
    await flushMicrotasks()
    expect(runtime.requests.map(request => request.command)).toEqual(['status', 'get-advanced-access'])

    runtime.settleRequest('status', {
      connected: true,
      connection: { connection_id: 'new-connection', last_seen_at: '2026-07-20T09:00:00.000Z' },
      protocol_version: 1
    })
    runtime.settleRequest('get-advanced-access', { result: { sync_state: 'synced' } })
    await polling

    expect(runtime.state[1]).toMatchObject({
      connected: true,
      connection: { connection_id: 'new-connection' }
    })
    expect(runtime.state[2]).toEqual({ sync_state: 'synced' })
    cleanup?.()
  })

  it('keeps a configuration failure visible until a full refresh succeeds', async () => {
    const runtime = renderRefreshScheduler()
    const cleanup = runtime.effects[1]?.()
    await flushMicrotasks()

    runtime.settleRequest('status', { connected: false, protocol_version: 1 })
    runtime.settleRequest('get-advanced-access', { result: { sync_state: 'pending_connection' } })
    runtime.settleRequest('get-site-permissions', new Error('site rules unavailable'), true)
    await flushMicrotasks()
    expect(runtime.state[5]).toMatchObject({ source: 'configuration' })

    const polling = runtime.timers[0]?.()
    await flushMicrotasks()
    runtime.settleRequest('status', { connected: false, protocol_version: 1 })
    runtime.settleRequest('get-advanced-access', { result: { sync_state: 'pending_connection' } })
    await polling
    expect(runtime.state[5]).toMatchObject({ source: 'configuration' })

    runtime.listeners.get('visibilitychange')?.()
    await flushMicrotasks()
    runtime.settleRequest('status', { connected: false, protocol_version: 1 })
    runtime.settleRequest('get-advanced-access', { result: { sync_state: 'pending_connection' } })
    runtime.settleRequest('get-site-permissions', { result: { rules: [] } })
    await flushMicrotasks()
    expect(runtime.state[5]).toBeNull()
    cleanup?.()
  })

  it('keeps a configuration failure after simultaneous live-state failures recover', async () => {
    const runtime = renderRefreshScheduler()
    const cleanup = runtime.effects[1]?.()
    await flushMicrotasks()

    runtime.settleRequest('status', new Error('status unavailable'), true)
    runtime.settleRequest('get-advanced-access', new Error('advanced access unavailable'), true)
    runtime.settleRequest('get-site-permissions', new Error('site rules unavailable'), true)
    await flushMicrotasks()
    expect(runtime.state[5]).toMatchObject({ source: 'configuration' })

    const polling = runtime.timers[0]?.()
    await flushMicrotasks()
    runtime.settleRequest('status', { connected: false, protocol_version: 1 })
    runtime.settleRequest('get-advanced-access', { result: { sync_state: 'pending_connection' } })
    await polling

    expect(runtime.state[1]).toMatchObject({ connected: false })
    expect(runtime.state[2]).toEqual({ sync_state: 'pending_connection' })
    expect(runtime.state[5]).toMatchObject({ source: 'configuration' })
    cleanup?.()
  })

  it('drops in-flight results after the settings view unmounts', async () => {
    const runtime = renderRefreshScheduler()
    const cleanup = runtime.effects[1]?.()
    await flushMicrotasks()
    cleanup?.()

    runtime.settleRequest('status', {
      connected: true,
      connection: { connection_id: 'stale-connection' },
      protocol_version: 1
    })
    runtime.settleRequest('get-advanced-access', { result: { raw_debugger: true } })
    runtime.settleRequest('get-site-permissions', { result: { rules: [{ id: 'stale-rule' }] } })
    await flushMicrotasks()

    expect(runtime.state[1]).toBeNull()
    expect(runtime.state[2]).toBeNull()
    expect(runtime.state[7]).toBeNull()
  })

  it('does not repeat the selected tab label as a section heading', () => {
    expect(source).not.toContain("title={t('Connection', '连接')}")
    expect(source).not.toContain("title={t('Advanced session access', '高级会话访问')}")
    expect(source).not.toContain("title={t('Web frame isolation', 'Web Frame 隔离')}")
    expect(source).not.toContain("title={t('Pending confirmations', '待确认操作')}")
    expect(source).not.toContain("title={t('Recent audit', '最近审计')}")
  })

  it('explains advanced access without exposing internal risk-tier jargon', () => {
    expect(source).not.toContain('exact R4 confirmation')
    expect(source).toContain('These settings are saved in OneWorks independently of the connection')
    expect(source).toContain('这些设置与浏览器连接无关，会保存在 OneWorks 中')
    expect(source).toContain('synchronization with the connected browser failed')
    expect(source).toContain("advancedAccess?.sync_state === 'sync_failed'")
    expect(source).toContain('This preference is saved now. Raw access requires the privileged extension')
    expect(source).toContain("className='chrome-driver__advanced-warning-copy'")
    expect(source).not.toContain("label={t('Go to Connection', '去连接')}")
    expect(source.match(/disabled=\{advancedAccess == null \|\| busy !== ''\}/gu)).toHaveLength(3)
    expect(source.match(/disabled=\{!status\?\.connected/gu)).toHaveLength(1)
  })

  it('keeps confirmation and audit details in their cards without nested section headings', () => {
    expect(source).toContain("{activeTab === 'review-audit' && <SettingsSection>")
    expect(source).toContain("title={t('Sensitive actions', '敏感操作')}")
    expect(source).toContain("title={t('Audited operations', '已审计操作')}")
    expect(source).toContain('exact-operation approvals expire after five minutes')
    expect(source).toContain('URLs omit credentials, query strings, and fragments')
  })

  it('states that URL permission patterns reject query strings and fragments', () => {
    expect(source).toContain('Query strings and fragments are not allowed.')
    expect(source).toContain('不允许包含查询参数或片段')
    expect(source).not.toContain('Query strings and fragments are ignored.')
  })

  it('clears stale Frame inventory when the connection or paired tab identity changes', () => {
    const disconnected = renderConnectionLifecycle({
      connected: false,
      connection: { connection_id: 'connection-a', oneworks_tab_id: 101 }
    })
    expect(disconnected.dependencies).toEqual([null])
    expect(disconnected.frameSetter).toHaveBeenCalledWith([])

    const switched = renderConnectionLifecycle({
      connected: true,
      connection: { connection_id: 'connection-b', oneworks_tab_id: 202 }
    })
    expect(switched.dependencies).toEqual([JSON.stringify(['connection-b', 202])])
    expect(switched.frameSetter).toHaveBeenCalledWith([])

    const pairedTabChanged = renderConnectionLifecycle({
      connected: true,
      connection: { connection_id: 'connection-b', oneworks_tab_id: 203 }
    })
    expect(pairedTabChanged.dependencies).toEqual([JSON.stringify(['connection-b', 203])])
    expect(pairedTabChanged.frameSetter).toHaveBeenCalledWith([])
  })

  it('drops a late Frame response from a previous paired tab', async () => {
    let resolveFrames: (value: unknown) => void = () => undefined
    const framesResponse = new Promise<unknown>(resolve => {
      resolveFrames = resolve
    })
    const request = renderStaleFrameRequest(framesResponse)

    request.activeFrameTargetRef.current = JSON.stringify(['connection-a', 102])
    resolveFrames({
      result: [{ document_id: 'old-document', frame_id: 0, url: 'https://old.example/' }]
    })
    await request.request

    expect(request.frameSetter).not.toHaveBeenCalled()
  })
})
