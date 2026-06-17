import type { RefSelectProps } from 'antd'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelSelectOption } from '#~/hooks/chat/use-chat-model-adapter-selection'

vi.mock('@oneworks/components/route-layout', () => ({
  ShortcutTooltip: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('#~/components/chat/sender/@hooks/use-model-select-browser', () => ({
  useModelSelectBrowser: () => ({
    renderModelPopup: (node: React.ReactNode) => node
  })
}))

let responsiveLayout = {
  isCompactLayout: false,
  isTouchInteraction: false
}

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => responsiveLayout
}))

vi.mock('#~/components/mobile-aware-select/MobileAwareSelect', () => ({
  MobileAwareSelect: React.forwardRef<HTMLDivElement, Record<string, unknown>>((
    {
      className,
      labelRender,
      placeholder,
      suffixIcon
    },
    ref
  ) => {
    const renderLabel = typeof labelRender === 'function'
      ? labelRender
      : () => placeholder

    return (
      <div ref={ref} className={`${className ?? ''} ant-select ant-select-single`}>
        <div className='ant-select-selector'>
          <span className='ant-select-selection-item'>{renderLabel({})}</span>
        </div>
        {suffixIcon as React.ReactNode}
      </div>
    )
  })
}))

vi.mock('#~/components/chat/sender/@components/model-select/ModelMobileSelectDrawer', () => ({
  ModelMobileSelectDrawer: () => null
}))

const kimiOption = {
  value: 'kimi-code,kimi-for-coding',
  title: 'kimi-for-coding',
  displayLabel: 'kimi-for-coding',
  description: undefined,
  aliases: [],
  modelName: 'kimi-for-coding',
  tooltipLines: [],
  serviceKey: 'kimi-code',
  serviceTitle: 'Kimi Code',
  serviceIcon: { kind: 'builtin', id: 'moonshot' },
  modelIcon: undefined,
  searchText: 'Kimi Code kimi-for-coding',
  canToggleRecommendation: false,
  isRecommended: false,
  isUserRecommended: false,
  label: <span>Kimi Code/kimi-for-coding</span>
} satisfies ModelSelectOption

const createProps = () => ({
  state: {
    isThinking: false,
    modelUnavailable: false,
    showModelSelect: false,
    selectedModel: kimiOption.value,
    modelSearchValue: '',
    isMac: true
  },
  data: {
    modelMenuGroups: [],
    modelSearchOptions: [kimiOption],
    builtinPreviewModelOptions: [],
    recommendedModelOptions: [],
    servicePreviewModelOptions: [kimiOption],
    composerControlShortcuts: {
      switchModel: 'mod+/',
      switchEffort: '',
      switchPermissionMode: '',
      queueSteer: '',
      queueNext: ''
    },
    updatingRecommendedModelValue: undefined
  },
  refs: {
    modelSelectRef: React.createRef<RefSelectProps>()
  },
  handlers: {
    onShowModelSelectChange: vi.fn(),
    onShowEffortSelectChange: vi.fn(),
    onModelSearchValueChange: vi.fn(),
    onOpenModelSelector: vi.fn(),
    onQueueTextareaFocusRestore: vi.fn(),
    onCloseReferenceActions: vi.fn(),
    onModelChange: vi.fn(),
    onToggleRecommendedModel: vi.fn(),
    onConnectMoreModelServices: vi.fn(),
    onOpenModelServicesConfig: vi.fn()
  }
})

describe('model select control trigger icon', () => {
  beforeEach(() => {
    responsiveLayout = {
      isCompactLayout: false,
      isTouchInteraction: false
    }
  })

  it('uses the selected model service icon in the desktop select trigger', async () => {
    const { ModelSelectControl } = await import(
      '#~/components/chat/sender/@components/model-select/ModelSelectControl'
    )

    const html = renderToStaticMarkup(<ModelSelectControl {...createProps()} />)

    expect(html).toContain('model-select-trigger-label')
    expect(html).toContain('data-icon-id="moonshot"')
    expect(html).toContain('kimi-for-coding')
    expect(html).not.toContain('model_training')
  })

  it('uses the selected model service icon in the compact trigger', async () => {
    responsiveLayout = {
      isCompactLayout: true,
      isTouchInteraction: false
    }
    const { ModelSelectControl } = await import(
      '#~/components/chat/sender/@components/model-select/ModelSelectControl'
    )

    const html = renderToStaticMarkup(<ModelSelectControl {...createProps()} />)

    expect(html).toContain('sender-responsive-select-button--model')
    expect(html).toContain('data-icon-id="moonshot"')
    expect(html).toContain('kimi-for-coding')
    expect(html).not.toContain('model_training')
  })
})
