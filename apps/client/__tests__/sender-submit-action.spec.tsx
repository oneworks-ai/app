import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { SenderSubmitAction } from '#~/components/chat/sender/@components/sender-submit-action/SenderSubmitAction'

vi.mock('antd', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
  Tooltip: ({ children, title }: React.PropsWithChildren<{ title?: React.ReactNode }>) => (
    <div data-tooltip={typeof title === 'string' ? title : undefined}>
      {title}
      {children}
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('#~/components/ShortcutDisplay', () => ({
  ShortcutDisplay: ({ shortcut }: { shortcut?: string }) => <span>{shortcut}</span>
}))

vi.mock('#~/components/ShortcutTooltip', () => ({
  ShortcutTooltip: ({ children }: React.PropsWithChildren<Record<string, unknown>>) => <>{children}</>
}))

const baseProps = {
  isInlineEdit: false,
  submitLoading: false,
  hasComposerContent: false,
  modelUnavailable: false,
  sendBlocked: false,
  showConfirmInteractionAction: false,
  isThinking: false,
  stopLoading: false,
  resolvedSendShortcut: 'mod+enter',
  isMac: true,
  onSend: vi.fn()
} satisfies React.ComponentProps<typeof SenderSubmitAction>

describe('sender submit action', () => {
  it('marks the stop action as disabled while a stop request is pending', () => {
    const html = renderToStaticMarkup(
      <SenderSubmitAction
        {...baseProps}
        isThinking
        stopLoading
        onStop={vi.fn()}
      />
    )

    expect(html).toContain('role="button"')
    expect(html).toContain('data-tooltip="chat.sessionStoppingMessage"')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('aria-label="chat.sessionStoppingMessage"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('progress_activity')
    expect(html).not.toContain('chat.queue.stopShortcutTooltip')
    expect(html).not.toContain('stop_circle')
  })

  it('exposes the idle stop action as a button', () => {
    const html = renderToStaticMarkup(
      <SenderSubmitAction
        {...baseProps}
        isThinking
        onStop={vi.fn()}
      />
    )

    expect(html).toContain('role="button"')
    expect(html).toContain('aria-label="chat.stop"')
    expect(html).toContain('tabindex="0"')
    expect(html).not.toContain('aria-disabled')
    expect(html).toContain('stop_circle')
  })
})
