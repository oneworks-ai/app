// @vitest-environment happy-dom
import { App, ConfigProvider, Form, theme } from 'antd'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '#~/api/base'
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

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

vi.mock('#~/components/layout/RouteContainerHeader', () => ({ RouteContainerHeader: () => null }))
vi.mock('#~/components/layout/RouteContainerLayout', () => ({
  RouteContainerLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>
}))
vi.mock('#~/components/layout/route-sidebar-context', () => ({
  useRouteSidebar: () => ({ clearRouteSidebar: vi.fn(), hasRouteSidebarProvider: false, setRouteSidebar: vi.fn() })
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
      skillInstall: 'all',
      skillMarketSearch: '',
      skillProjectSearch: '',
      skillRegistry: 'all',
      skillRegistrySettingsSearch: '',
      skillSort: 'default',
      skillSource: 'all'
    }
  })
}))
vi.mock('#~/plugins/route-plugin-chrome', () => ({
  useRoutePluginChrome: () => ({ headerActions: [], sidebarContextMenuItems: [] })
}))
vi.mock('#~/components/knowledge-base/components/RulesTab.js', () => ({
  RulesTab: ({ onCreate }: { onCreate: () => void }) => (
    <button aria-label='open-rule-create' onClick={onCreate}>create</button>
  )
}))
vi.mock('#~/components/knowledge-base/components/EntitiesTab.js', () => ({
  EntitiesTab: ({ leading }: { leading?: ReactNode }) => <section>{leading}</section>
}))
vi.mock('#~/components/knowledge-base/components/FlowsTab.js', () => ({ FlowsTab: () => null }))
vi.mock('#~/components/knowledge-base/components/SkillsTab.js', () => ({ SkillsTab: () => null }))

const flush = async () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
const settleMotion = async () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 500))
  })
const setInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('mounted Ant asset create flow', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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

  it('uses real Form Enter, dynamic accessible names, compact theme, and pending close policy', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    function Harness({ saving = false }: { saving?: boolean }) {
      const [form] = Form.useForm<CreateAssetFormValues>()
      return (
        <div className='knowledge-base-view--compact'>
          <ConfigProvider componentSize='small' theme={{ algorithm: theme.darkAlgorithm }}>
            <CreateAssetModal form={form} kind='spec' open saving={saving} onClose={onClose} onSave={onSave} />
          </ConfigProvider>
        </div>
      )
    }
    await act(async () => root.render(<Harness />))
    await flush()
    await settleMotion()
    const name = document.querySelector<HTMLInputElement>('#name')!
    expect(focus.mock.contexts).toContain(name)
    expect(name.className).toContain('ant-input-sm')
    setInput(name, 'Release')
    document.querySelector<HTMLButtonElement>('[aria-label="knowledge.assets.addParam"]')!.click()
    await flush()
    const paramName = document.querySelector<HTMLInputElement>('[aria-label="Parameter 1 name"]')!
    expect(document.querySelector('[aria-label="Parameter 1 description"]')).not.toBeNull()
    setInput(paramName, 'version')
    await flush()
    expect(document.querySelector('[aria-label="Remove parameter version"]')).not.toBeNull()
    const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })
    name.dispatchEvent(enter)
    await flush()
    expect(enter.defaultPrevented).toBe(true)
    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<Harness saving />))
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    expect(document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-default')?.disabled).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the create entry visible in expanded desktop mode', async () => {
    await act(async () =>
      root.render(
        <App>
          <KnowledgeBaseView
            sectionKey='entities'
            skillPage='project'
            onBack={vi.fn()}
            onNavigateEntity={vi.fn()}
            onNavigateEntityPage={vi.fn()}
            onNavigateSection={vi.fn()}
            onNavigateSkillPage={vi.fn()}
          />
        </App>
      )
    )
    expect(document.querySelector('[aria-label="knowledge.actions.new"]')).not.toBeNull()
  })

  it('retries refresh without repeating a committed production POST', async () => {
    mocks.createAsset.mockResolvedValue({ asset: { kind: 'rule', path: '.oo/rules/release.md' } })
    mocks.mutateRules.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    await act(async () =>
      root.render(
        <App>
          <KnowledgeBaseView
            sectionKey='rules'
            skillPage='project'
            onBack={vi.fn()}
            onNavigateEntity={vi.fn()}
            onNavigateEntityPage={vi.fn()}
            onNavigateSection={vi.fn()}
            onNavigateSkillPage={vi.fn()}
          />
        </App>
      )
    )
    document.querySelector<HTMLButtonElement>('[aria-label="open-rule-create"]')!.click()
    await flush()
    const name = document.querySelector<HTMLInputElement>('#name')!
    setInput(name, 'Release')
    name.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))
    name.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))
    await flush()
    await flush()
    await settleMotion()
    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(mocks.mutateRules).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ant-modal')?.classList).toContain('ant-zoom-leave')
    document.querySelector<HTMLButtonElement>('.knowledge-base-view__asset-refresh-alert button')!.click()
    await flush()
    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(mocks.mutateRules).toHaveBeenCalledTimes(2)
  })

  it('keeps a semantic conflict open and reports the localized actionable error', async () => {
    mocks.createAsset.mockRejectedValue(
      new ApiError(409, {
        code: 'asset_name_exists',
        message: 'server detail',
        details: { committed: false }
      })
    )
    await act(async () =>
      root.render(
        <App>
          <KnowledgeBaseView
            sectionKey='rules'
            skillPage='project'
            onBack={vi.fn()}
            onNavigateEntity={vi.fn()}
            onNavigateEntityPage={vi.fn()}
            onNavigateSection={vi.fn()}
            onNavigateSkillPage={vi.fn()}
          />
        </App>
      )
    )
    document.querySelector<HTMLButtonElement>('[aria-label="open-rule-create"]')!.click()
    await flush()
    const name = document.querySelector<HTMLInputElement>('#name')!
    setInput(name, 'Existing Rule')
    name.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))
    await flush()
    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('knowledge.assets.nameExists')
    expect(document.querySelector('.ant-modal')).not.toBeNull()
  })
})
