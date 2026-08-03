// @vitest-environment jsdom
import { App, ConfigProvider, Form, theme } from 'antd'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, AssetCreateCommitIndeterminateError } from '#~/api.js'
import { KnowledgeBaseView } from '#~/components/knowledge-base/KnowledgeBaseView'
import { CreateAssetModal } from '#~/components/knowledge-base/components/CreateAssetModal'
import type { CreateAssetFormValues } from '#~/components/knowledge-base/components/CreateAssetModal'

const mocks = vi.hoisted(() => ({
  createAsset: vi.fn(),
  mutateEntities: vi.fn(),
  mutateRules: vi.fn(),
  mutateSkills: vi.fn(),
  mutateSpecs: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key.endsWith('paramName')) return `Parameter ${params?.index} name`
      if (key.endsWith('paramDescription')) return `Parameter ${params?.index} description`
      if (key.endsWith('removeParam')) return `Remove parameter ${params?.name}`
      return key
    }
  })
}))

vi.mock('swr', () => ({
  default: (key: unknown) => {
    const path = typeof key === 'string' ? key : ''
    if (path.endsWith('/specs')) return { data: { specs: [] }, isLoading: false, mutate: mocks.mutateSpecs }
    if (path.endsWith('/entities')) return { data: { entities: [] }, isLoading: false, mutate: mocks.mutateEntities }
    if (path.endsWith('/rules')) return { data: { rules: [] }, isLoading: false, mutate: mocks.mutateRules }
    if (path.endsWith('/skills')) return { data: { skills: [] }, mutate: mocks.mutateSkills }
    return { data: { asset: { kind: 'rule', path: '.oo/rules/release.md' } } }
  }
}))

vi.mock('#~/api.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAsset: mocks.createAsset,
  getAssetPreview: vi.fn(async () => ({ asset: { kind: 'rule', path: '.oo/rules/release.md' } }))
}))

vi.mock('#~/components/layout/RouteContainerHeader', () => ({
  RouteContainerHeader: () => null
}))
vi.mock('#~/components/layout/RouteContainerLayout', () => ({
  RouteContainerLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>
}))
vi.mock('#~/components/layout/route-sidebar-context', () => ({
  useRouteSidebar: () => ({
    clearRouteSidebar: vi.fn(),
    hasRouteSidebarProvider: false,
    setRouteSidebar: vi.fn()
  })
}))
vi.mock('#~/components/layout/use-route-container-sidebar-opener', () => ({
  useRouteContainerSidebarOpener: () => ({
    closeRouteSidebar: vi.fn(),
    isCompactView: false,
    isSidebarCollapsed: false,
    openRouteSidebar: vi.fn()
  })
}))
vi.mock('#~/hooks/useQueryParams.js', () => ({
  useQueryParams: () => ({
    update: vi.fn(),
    values: {
      kbTab: 'rules',
      skillInstall: 'all',
      skillMarketSearch: '',
      skillProjectSearch: '',
      skillRegistry: 'all',
      skillSort: 'default',
      skillSource: 'all',
      skillView: 'project'
    }
  })
}))
vi.mock('#~/plugins/route-plugin-chrome', () => ({
  useRoutePluginChrome: () => ({ headerActions: [], sidebarContextMenuItems: [] })
}))
vi.mock('#~/components/knowledge-base/components/RulesTab.js', () => ({
  RulesTab: ({ onCreate }: { onCreate: () => void }) => (
    <button aria-label='open-rule-create' onClick={onCreate}>
      create
    </button>
  )
}))
vi.mock('#~/components/knowledge-base/components/EntitiesTab.js', () => ({ EntitiesTab: () => null }))
vi.mock('#~/components/knowledge-base/components/FlowsTab.js', () => ({ FlowsTab: () => null }))
vi.mock('#~/components/knowledge-base/components/SkillsTab.js', () => ({ SkillsTab: () => null }))

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const KnowledgeBaseHarness = () => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <KnowledgeBaseView
      sectionKey='rules'
      skillPage='project'
      onBack={() => {}}
      onNavigateSection={() => {}}
      onNavigateSkillPage={() => {}}
    />
  </ConfigProvider>
)

const setInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('mounted Ant asset create flow', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeAll(() => {
    const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
        removeListener: vi.fn()
      })
    })
    globalThis.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    }
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    mocks.createAsset.mockReset()
    mocks.mutateRules.mockReset()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  it('mounts real Modal/Form controls with focus, dynamic a11y, Enter submit, and pending close policy', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()

    function Harness({ saving = false }: { saving?: boolean }) {
      const [form] = Form.useForm<CreateAssetFormValues>()
      return (
        <div className='knowledge-base-view--compact'>
          <ConfigProvider componentSize='small' theme={{ algorithm: theme.darkAlgorithm, token: { motion: false } }}>
            <CreateAssetModal
              form={form}
              kind='spec'
              open
              saving={saving}
              onClose={onClose}
              onSave={onSave}
            />
          </ConfigProvider>
        </div>
      )
    }

    const nativeFocus = HTMLInputElement.prototype.focus
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus').mockImplementation(function(this: HTMLInputElement) {
      nativeFocus.call(this)
    })
    await act(async () => root.render(<Harness />))
    await flush()
    await flush()
    const name = document.querySelector<HTMLInputElement>('#name')!
    // JSDOM cannot model Ant's portal focus-trap handoff, but React must still
    // request focus for the modal's auto-focused name input.
    expect(focus.mock.instances).toContain(name)
    focus.mockRestore()
    expect(name.className).toContain('ant-input-sm')
    expect(document.querySelector('style[data-css-hash]')).not.toBeNull()

    setInput(name, 'Release')
    document.querySelector<HTMLButtonElement>('[aria-label="knowledge.assets.addParam"]')!.click()
    await flush()
    const paramName = document.querySelector<HTMLInputElement>('[aria-label="Parameter 1 name"]')!
    expect(paramName).not.toBeNull()
    expect(document.querySelector('[aria-label="Parameter 1 description"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Remove parameter 1"]')).not.toBeNull()
    setInput(paramName, 'version')
    await flush()
    const remove = document.querySelector<HTMLButtonElement>('[aria-label="Remove parameter version"]')!
    expect(remove).not.toBeNull()
    remove.click()
    await flush()
    expect(document.querySelector('[aria-label="Parameter 1 name"]')).toBeNull()

    const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })
    name.dispatchEvent(enter)
    await flush()
    expect(enter.defaultPrevented).toBe(true)
    expect(onSave).toHaveBeenCalledTimes(1)

    await act(async () => root.render(<Harness saving />))
    await flush()
    expect(document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-default')?.disabled).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('mounts KnowledgeBaseView and retries refresh without repeating the committed POST', async () => {
    mocks.createAsset.mockResolvedValue({
      asset: { kind: 'rule', path: '.oo/rules/release.md' }
    })
    mocks.mutateRules
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)

    await act(async () =>
      root.render(
        <App>
          <KnowledgeBaseHarness />
        </App>
      )
    )
    document.querySelector<HTMLButtonElement>('[aria-label="open-rule-create"]')!.click()
    await flush()
    const name = document.querySelector<HTMLInputElement>('#name')!
    setInput(name, 'Release')
    name.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      })
    )
    name.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      })
    )
    await flush()
    await flush()

    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(mocks.mutateRules).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ant-modal')).toBeNull()
    document.querySelector<HTMLButtonElement>('.knowledge-base-view__asset-refresh-alert button')!.click()
    await flush()
    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(mocks.mutateRules).toHaveBeenCalledTimes(2)
  })

  it('blocks same-tick close while a claimed production POST is pending', async () => {
    let finishPost!: () => void
    mocks.createAsset.mockImplementation(() =>
      new Promise(resolve => {
        finishPost = () => resolve({ asset: { kind: 'rule', path: '.oo/rules/pending.md' } })
      })
    )

    await act(async () =>
      root.render(
        <App>
          <KnowledgeBaseHarness />
        </App>
      )
    )
    document.querySelector<HTMLButtonElement>('[aria-label="open-rule-create"]')!.click()
    await flush()
    const name = document.querySelector<HTMLInputElement>('#name')!
    await act(async () => {
      setInput(name, 'Pending')
    })
    await act(async () => {
      name.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter'
        })
      )
    })
    await flush()
    expect(mocks.createAsset).toHaveBeenCalledTimes(1)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-default')!.click()
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })
    await flush()

    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ant-modal')).not.toBeNull()
    finishPost()
    await flush()
    await flush()
    expect(document.querySelector('.ant-modal')).toBeNull()
  })

  it('retries only refresh after a returned indeterminate commit', async () => {
    mocks.createAsset.mockResolvedValue({
      asset: {
        commitState: 'committed-indeterminate',
        kind: 'rule',
        path: '.oo/rules/uncertain.md'
      }
    })
    mocks.mutateRules
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)

    await act(async () =>
      root.render(
        <App>
          <KnowledgeBaseHarness />
        </App>
      )
    )
    document.querySelector<HTMLButtonElement>('[aria-label="open-rule-create"]')!.click()
    await flush()
    setInput(document.querySelector<HTMLInputElement>('#name')!, 'Uncertain')
    document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-primary')!.click()
    await flush()
    await flush()

    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(mocks.mutateRules).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ant-modal')).toBeNull()
    document.querySelector<HTMLButtonElement>('.knowledge-base-view__asset-refresh-alert button')!.click()
    await flush()
    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(mocks.mutateRules).toHaveBeenCalledTimes(2)
  })

  it('reconciles a lost POST response and never exposes an automatic destructive retry', async () => {
    mocks.createAsset.mockRejectedValue(
      new AssetCreateCommitIndeterminateError(new TypeError('connection closed'))
    )
    mocks.mutateRules
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)

    await act(async () =>
      root.render(
        <App>
          <KnowledgeBaseHarness />
        </App>
      )
    )
    document.querySelector<HTMLButtonElement>('[aria-label="open-rule-create"]')!.click()
    await flush()
    setInput(document.querySelector<HTMLInputElement>('#name')!, 'Lost Response')
    document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-primary')!.click()
    await flush()
    await flush()

    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ant-modal')).toBeNull()
    document.querySelector<HTMLButtonElement>('.knowledge-base-view__asset-refresh-alert button')!.click()
    await flush()
    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(mocks.mutateRules).toHaveBeenCalledTimes(2)
  })

  it('keeps the modal retryable only for an explicit committed-false response', async () => {
    mocks.createAsset
      .mockRejectedValueOnce(
        new ApiError(500, {
          code: 'asset_publish_failed',
          details: { committed: false },
          message: 'not published'
        })
      )
      .mockResolvedValueOnce({
        asset: { kind: 'rule', path: '.oo/rules/safe-retry.md' }
      })

    await act(async () =>
      root.render(
        <App>
          <KnowledgeBaseHarness />
        </App>
      )
    )
    document.querySelector<HTMLButtonElement>('[aria-label="open-rule-create"]')!.click()
    await flush()
    setInput(document.querySelector<HTMLInputElement>('#name')!, 'Safe Retry')
    const save = document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-primary')!
    save.click()
    await flush()
    expect(document.querySelector('.ant-modal')).not.toBeNull()
    save.click()
    await flush()
    await flush()

    expect(mocks.createAsset).toHaveBeenCalledTimes(2)
    expect(mocks.mutateRules).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ant-modal')).toBeNull()
  })

  it('invalidates an unmounted generation before a late POST settlement can refresh', async () => {
    let finishPost!: () => void
    mocks.createAsset.mockImplementation(() =>
      new Promise(resolve => {
        finishPost = () => resolve({ asset: { kind: 'rule', path: '.oo/rules/late.md' } })
      })
    )

    await act(async () =>
      root.render(
        <App>
          <KnowledgeBaseHarness />
        </App>
      )
    )
    document.querySelector<HTMLButtonElement>('[aria-label="open-rule-create"]')!.click()
    await flush()
    setInput(document.querySelector<HTMLInputElement>('#name')!, 'Late')
    const save = document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-primary')!
    save.click()
    save.click()
    await flush()
    await act(async () => root.unmount())
    finishPost()
    await flush()

    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(mocks.mutateRules).not.toHaveBeenCalled()
    root = createRoot(container)
  })
})
