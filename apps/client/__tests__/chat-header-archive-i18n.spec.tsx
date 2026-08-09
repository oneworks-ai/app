import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTranslationResources } from '#~/i18n-resources'
import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'

interface CapturedMenuItem {
  key?: string
  label?: ReactNode
  onClick?: () => void
}

const mocks = vi.hoisted(() => ({
  dropdownMenus: [] as unknown[][],
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  updateSession: vi.fn()
}))

vi.mock('antd', async (importOriginal) => {
  const antd = await importOriginal<typeof import('antd')>()
  return {
    ...antd,
    App: {
      useApp: () => ({
        message: {
          error: mocks.messageError,
          success: mocks.messageSuccess
        },
        modal: { confirm: vi.fn() }
      })
    },
    Dropdown: ({ children, menu }: {
      children?: ReactNode
      menu: { items?: unknown[] }
    }) => {
      mocks.dropdownMenus.push(menu.items ?? [])
      return children ?? null
    }
  }
})

vi.mock('#~/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/api')>(),
  updateSession: mocks.updateSession
}))

vi.mock('@oneworks/components/route-layout', () => ({
  RouteContainerHeaderActionButton: () => null,
  RouteHeaderActionButton: () => null,
  RouteHeaderActionGroup: ({ children }: { children?: ReactNode }) => children ?? null
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn()
}))

vi.mock('#~/components/layout/RouteContainerHeader', () => ({
  RouteContainerHeader: ({ actions }: { actions?: ReactNode }) => actions ?? null
}))

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({ isCompactLayout: false, isTouchInteraction: false })
}))

vi.mock('#~/hooks/useQueryParams', () => ({
  useQueryParams: () => ({ searchParams: new URLSearchParams(), update: vi.fn() })
}))

vi.mock('#~/plugins/plugin-slots', () => ({
  usePluginCommandExecutor: () => undefined,
  usePluginSlot: () => []
}))

vi.mock('#~/plugins/route-plugin-chrome', () => ({
  useRoutePluginHeaderActions: () => []
}))

vi.mock('#~/components/chat/interaction-panel/interaction-panel-workspace-action-menu-items', () => ({
  useInteractionPanelWorkspaceActionMenuItems: () => []
}))

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  loader: { config: () => undefined }
}))

vi.mock('monaco-editor', () => ({
  editor: { defineTheme: vi.fn() }
}))

const renderArchiveAction = async ({
  isArchived,
  language
}: {
  isArchived: boolean
  language: 'en' | 'zh'
}) => {
  const { ChatHeader } = await import('#~/components/chat/ChatHeader')
  const i18n = createInstance()
  await i18n.init({
    fallbackLng: false,
    lng: language,
    resources: buildTranslationResources({
      './resources/locales/en.json': { default: en },
      './resources/locales/zh.json': { default: zh }
    })
  })

  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ChatHeader
        activeView='history'
        isArchived={isArchived}
        isBottomPanelOpen={false}
        isWorkspaceDrawerOpen={false}
        sessionId='session-183'
        sessionInfo={null}
        onToggleBottomPanel={() => undefined}
        onToggleWorkspaceDrawer={() => undefined}
        onViewChange={() => undefined}
      />
    </I18nextProvider>
  )

  const archiveAction = mocks.dropdownMenus
    .flat()
    .find((item): item is CapturedMenuItem => (
      typeof item === 'object' && item != null && 'key' in item && item.key === 'archive'
    ))
  if (archiveAction == null) throw new Error('Expected the real ChatHeader archive action')
  return archiveAction
}

describe('chat header archive i18n', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dropdownMenus.length = 0
    mocks.updateSession.mockResolvedValue(undefined)
    vi.stubGlobal('localStorage', {
      clear: () => undefined,
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => undefined
    })
    vi.stubGlobal('navigator', { platform: 'Linux' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    {
      isArchived: false,
      language: 'en' as const,
      label: 'Archive',
      nextArchived: true,
      toast: 'Archived successfully'
    },
    { isArchived: false, language: 'zh' as const, label: '归档', nextArchived: true, toast: '归档成功' },
    {
      isArchived: true,
      language: 'en' as const,
      label: 'Restore',
      nextArchived: false,
      toast: 'Restored successfully'
    },
    { isArchived: true, language: 'zh' as const, label: '还原', nextArchived: false, toast: '还原成功' }
  ])(
    'keeps the $language archive lifecycle localized when isArchived=$isArchived',
    async ({ isArchived, label, language, nextArchived, toast }) => {
      const archiveAction = await renderArchiveAction({ isArchived, language })

      expect(archiveAction.label).toBe(label)
      archiveAction.onClick?.()
      await vi.waitFor(() => {
        expect(mocks.updateSession).toHaveBeenCalledWith('session-183', { isArchived: nextArchived })
        expect(mocks.messageSuccess).toHaveBeenCalledWith(toast)
      })
      expect(mocks.messageSuccess).not.toHaveBeenCalledWith(expect.stringMatching(/^common\./))
    }
  )
})
