import { createInstance } from 'i18next'
import type { TOptions } from 'i18next'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
  language: 'en',
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  translate: (key: string, options?: TOptions) => key,
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

vi.mock('../src/api', () => ({
  ApiError: class ApiError extends Error {},
  deleteSession: vi.fn(),
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  updateSession: mocks.updateSession
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: mocks.language, resolvedLanguage: mocks.language },
    t: mocks.translate
  })
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

const chatHeaderModule = import('#~/components/chat/ChatHeader')

const renderArchiveAction = async ({
  isArchived,
  language
}: {
  isArchived: boolean
  language: 'en' | 'zh'
}) => {
  const i18n = createInstance()
  await i18n.init({
    fallbackLng: false,
    lng: language,
    resources: buildTranslationResources({
      './resources/locales/en.json': { default: en },
      './resources/locales/zh.json': { default: zh }
    })
  })
  mocks.language = language
  mocks.translate = (key, options) => i18n.t(key, options)
  const { ChatHeader } = await chatHeaderModule

  renderToStaticMarkup(
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
  beforeEach(async () => {
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
