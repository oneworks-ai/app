// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@oneworks/route-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oneworks/route-layout')>()
  return {
    ...actual,
    useResponsiveLayout: () => ({ isTouchInteraction: true })
  }
})

vi.mock('antd', () => ({
  Button: ({
    icon,
    loading: _loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: React.ReactNode
    loading?: boolean
  }) => <button {...props}>{icon}</button>,
  Tooltip: ({ children }: { children: React.ReactNode }) => children
}))

describe('route container header action button accessibility', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('preserves the accessible name and description in the production touch path', async () => {
    const { RouteContainerHeaderActionButton } = await import('@oneworks/components/route-layout')
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <div>
          <span id='oversize-policy'>Automatic import skips this item; manual Import remains available.</span>
          <RouteContainerHeaderActionButton
            item={{
              ariaDescribedBy: 'oversize-policy',
              icon: 'download',
              key: 'import',
              label: 'Import',
              onSelect
            }}
          />
        </div>
      )
    })

    const button = container.querySelector<HTMLButtonElement>('button')
    expect(button?.getAttribute('aria-label')).toBe('Import')
    expect(button?.getAttribute('aria-describedby')).toBe('oversize-policy')
    expect(document.getElementById(button!.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Automatic import skips this item; manual Import remains available.'
    )

    button?.focus()
    expect(document.activeElement).toBe(button)
    button?.click()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
