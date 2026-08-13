import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InteractionOption } from '@oneworks/types'

import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'

const createI18n = async (language: 'en' | 'zh') => {
  const i18n = createInstance()
  await i18n
    .use(initReactI18next)
    .init({
      lng: language,
      resources: {
        en: { translation: en },
        zh: { translation: zh }
      }
    })

  return i18n
}

const renderPanel = async ({
  includePermissionContext = true,
  language = 'zh',
  options,
  onInteractionResponse,
  showAllOptions = false
}: {
  includePermissionContext?: boolean
  language?: 'en' | 'zh'
  onInteractionResponse?: (id: string, data: string | string[]) => void
  options?: InteractionOption[]
  showAllOptions?: boolean
} = {}) => {
  vi.resetModules()

  if (showAllOptions) {
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react')
      let stateCall = 0
      return {
        ...actual,
        useState: <T,>(initial: T | (() => T)) => {
          stateCall += 1
          return stateCall === 1 ? [true, vi.fn()] : actual.useState(initial)
        }
      }
    })
  } else {
    vi.doUnmock('react')
  }

  const [{ SenderInteractionPanel }, i18n] = await Promise.all([
    import('#~/components/chat/sender/@components/sender-interaction-panel/SenderInteractionPanel'),
    createI18n(language)
  ])

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <SenderInteractionPanel
        interactionRequest={{
          id: 'interaction-1',
          payload: {
            sessionId: 'sess-1',
            kind: 'permission',
            question: '当前任务需要使用 Write 才能继续，请选择处理方式。',
            options: options ?? [
              { label: '同意本次', value: 'allow_once', description: '仅继续这次被拦截的操作。' },
              {
                label: '同意并在当前会话忽略类似调用',
                value: 'allow_session',
                description: '本会话内同类工具不再重复询问。'
              },
              {
                label: '同意并在当前项目忽略类似调用',
                value: 'allow_project',
                description: '写入 .oo.config.json，后续新会话仍生效。'
              },
              { label: '拒绝本次', value: 'deny_once', description: '拒绝当前这次操作。' },
              {
                label: '拒绝并在当前会话阻止类似调用',
                value: 'deny_session',
                description: '本会话内同类工具直接拒绝。'
              },
              {
                label: '拒绝并在当前项目阻止类似调用',
                value: 'deny_project',
                description: '写入 .oo.config.json，后续新会话仍生效。'
              }
            ],
            ...(includePermissionContext
              ? {
                permissionContext: {
                  adapter: 'claude-code',
                  subjectKey: 'Write',
                  subjectLabel: 'Write',
                  scope: 'tool',
                  projectConfigPath: '.oo.config.json',
                  currentMode: 'default'
                }
              }
              : {})
          }
        }}
        activeOptionIndex={0}
        permissionContext={includePermissionContext
          ? {
            adapter: 'claude-code',
            subjectKey: 'Write',
            subjectLabel: 'Write',
            scope: 'tool',
            projectConfigPath: '.oo.config.json',
            currentMode: 'default'
          }
          : undefined}
        deniedTools={includePermissionContext ? ['Write'] : []}
        reasons={['Permission required to continue']}
        onActiveOptionIndexChange={vi.fn()}
        onInteractionResponse={onInteractionResponse}
        onMoveActiveOption={vi.fn()}
      />
    </I18nextProvider>
  )
}

afterEach(() => {
  vi.doUnmock('react')
  vi.resetModules()
})

describe('sender interaction panel', () => {
  it('renders the primary permission actions by default', async () => {
    const html = await renderPanel()

    expect(html).toContain('正在请求使用【Write】的调用权限，请选择通过')
    expect(html).toContain('仅允许本次')
    expect(html).toContain('当前会话内允许')
    expect(html).toContain('仅拒绝本次')
    expect(html).toContain('展开更多选项')
    expect(html).toContain('选项快速切换')
    expect(html).not.toContain('当前项目内允许')
    expect(html).not.toContain('当前会话内拒绝')
    expect(html).not.toContain('当前项目内拒绝')
    expect(html.match(/interaction-panel__option-label/g)?.length).toBe(3)
  })

  it('keeps permission option layout for legacy permission requests without context', async () => {
    const html = await renderPanel({ includePermissionContext: false })

    expect(html).toContain('当前任务需要使用 Write 才能继续，请选择处理方式。')
    expect(html).toContain('仅允许本次')
    expect(html).toContain('当前会话内允许')
    expect(html).toContain('仅拒绝本次')
    expect(html).toContain('展开更多选项')
    expect(html).not.toContain('当前项目内允许')
    expect(html).not.toContain('当前会话内拒绝')
    expect(html).not.toContain('当前项目内拒绝')
    expect(html.match(/interaction-panel__option-label/g)?.length).toBe(3)
  })

  it('renders secondary permission actions after expanding', async () => {
    const html = await renderPanel({ showAllOptions: true })

    expect(html).toContain('收起更多选项')
    expect(html).toContain('当前项目内允许')
    expect(html).toContain('当前会话内拒绝')
    expect(html).toContain('当前项目内拒绝')
    expect(html.match(/interaction-panel__option-label/g)?.length).toBe(6)
  })

  it.each(
    [
      ['en', 'Always allow in Kiro (persistent)', 'Changes Kiro permission state beyond the current request.'],
      ['zh', '在 Kiro 中始终允许（持久）', '会修改 Kiro 的权限状态，并在当前请求结束后继续生效。']
    ] as const
  )('localizes Kiro native scope completely for %s with an accessible action label', async (
    language,
    expectedLabel,
    expectedDescription
  ) => {
    const html = await renderPanel({
      language,
      options: [{
        label: 'Always allow',
        value: 'native-allow-always',
        permission: { adapterLabel: 'Kiro', semantic: 'allow_persistent' }
      }]
    })

    expect(html).toContain(expectedLabel)
    expect(html).toContain(expectedDescription)
    expect(html).toContain(`aria-label="${expectedLabel}. ${expectedDescription}"`)
    expect(html).not.toContain('Always allow</span>')
  })

  it.each(
    [
      ['en', 'Kiro option: Ask Kiro', 'The native adapter did not advertise this option&#x27;s scope.'],
      ['zh', 'Kiro 原生选项：Ask Kiro', '原生适配器未说明此选项的权限范围。']
    ] as const
  )('preserves an unknown native option in the %s localized frame', async (
    language,
    expectedLabel,
    expectedDescription
  ) => {
    const html = await renderPanel({
      language,
      options: [{
        label: 'Ask Kiro',
        value: 'native-future-option',
        permission: { adapterLabel: 'Kiro', nativeLabel: 'Ask Kiro', semantic: 'native_unknown' }
      }]
    })

    expect(html).toContain(expectedLabel)
    expect(html).toContain(expectedDescription)
  })

  it.each(['en', 'zh'] as const)(
    'uses structured Kiro semantics before opaque/native-looking values for %s visual and a11y meta',
    async (language) => {
      const html = await renderPanel({
        language,
        showAllOptions: true,
        options: [
          {
            label: 'One request',
            value: 'opaque-allow-request',
            permission: { adapterLabel: 'Kiro', semantic: 'allow_once' }
          },
          {
            label: 'Persist allow',
            value: 'opaque-allow-persistent',
            permission: { adapterLabel: 'Kiro', semantic: 'allow_persistent' }
          },
          {
            label: 'One rejection',
            value: 'opaque-deny-request',
            permission: { adapterLabel: 'Kiro', semantic: 'deny_once' }
          },
          {
            label: 'Persist deny',
            value: 'opaque-deny-persistent',
            permission: { adapterLabel: 'Kiro', semantic: 'deny_persistent' }
          },
          {
            label: 'Unknown scope',
            value: 'allow_session',
            permission: {
              adapterLabel: 'Kiro',
              nativeLabel: 'Unknown scope',
              semantic: 'native_unknown'
            }
          }
        ]
      })

      expect(html).toContain('data-permission-semantic="allow_once"')
      expect(html).toContain('data-permission-semantic="allow_persistent"')
      expect(html).toContain('data-permission-semantic="deny_once"')
      expect(html).toContain('data-permission-semantic="deny_persistent"')
      expect(html).toContain('data-permission-semantic="native_unknown"')
      expect(html).toContain('interaction-panel__option--allow')
      expect(html).toContain('interaction-panel__option--deny')
      expect(html).toContain('interaction-panel__option--neutral')
      expect(html).toContain('>task_alt</span>')
      expect(html).toContain('>verified_user</span>')
      expect(html).toContain('>cancel</span>')
      expect(html).toContain('>gpp_bad</span>')
      expect(html).toContain('>help</span>')
      expect(html).toContain('tabindex="0"')
      expect(html).toContain('tabindex="-1"')
      expect(html).toContain('aria-label=')
      expect(html).not.toContain('data-permission-semantic="allow_session"')
    }
  )

  it('keeps a legacy-looking unknown native ID out of the primary action group', async () => {
    const html = await renderPanel({
      options: [
        {
          label: 'Allow native request',
          value: 'native-once',
          permission: { adapterLabel: 'Kiro', semantic: 'allow_once' }
        },
        {
          label: 'Unknown native scope',
          value: 'allow_session',
          permission: {
            adapterLabel: 'Kiro',
            nativeLabel: 'Unknown native scope',
            semantic: 'native_unknown'
          }
        }
      ]
    })

    expect(html).toContain('仅允许本次')
    expect(html).toContain('展开更多选项')
    expect(html).not.toContain('Kiro 原生选项：Unknown native scope')
  })
})
