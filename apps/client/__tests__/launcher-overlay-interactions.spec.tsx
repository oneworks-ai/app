// @vitest-environment happy-dom
import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LauncherOverlay } from '#~/routes/LauncherOverlay'

vi.mock('#~/plugins/PluginProvider', () => ({
  PluginProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('#~/routes/LauncherRoute', () => ({
  LauncherRoute: ({ onClose }: { onClose?: () => void }) => (
    <button
      data-testid='dialog-control'
      type='button'
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose?.()
      }}
    >
      Inside
    </button>
  )
}))

type ActivationKind = 'mouse' | 'touch'

const dispatch = (target: Element, type: string) => {
  const event = type === 'click' || type.startsWith('mouse')
    ? new MouseEvent(type, { bubbles: true, button: 0, cancelable: true })
    : new Event(type, { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
}

const activateBackdrop = async (kind: ActivationKind) => {
  const eventTypes = kind === 'mouse'
    ? ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
    : ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'click']

  await act(async () => {
    for (const type of eventTypes) {
      const target = document.querySelector('.launcher-web-overlay.is-open') ??
        document.querySelector('[data-testid="underlying"]')
      if (target == null) throw new Error(`Missing activation target for ${type}`)
      dispatch(target, type)
    }
  })
}

describe('launcher overlay activation boundary', () => {
  let closeCount: number
  let container: HTMLDivElement
  let root: Root
  let underlyingCount: number

  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button
          data-testid='underlying'
          type='button'
          onClick={() => {
            underlyingCount += 1
          }}
        >
          Underlying
        </button>
        <LauncherOverlay
          open={open}
          onClose={() => {
            closeCount += 1
            setOpen(false)
          }}
        />
      </>
    )
  }

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    closeCount = 0
    underlyingCount = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each<ActivationKind>(['mouse', 'touch'])(
    'consumes the complete %s backdrop activation and closes on final activation once',
    async (kind) => {
      await activateBackdrop(kind)

      expect(closeCount).toBe(1)
      expect(underlyingCount).toBe(0)
      expect(document.querySelector('.launcher-web-overlay.is-open')).toBeNull()
    }
  )

  it('keeps dialog-internal pointer sequences inside the open dialog', async () => {
    const control = document.querySelector('[data-testid="dialog-control"]')
    if (control == null) throw new Error('Missing dialog control')

    await act(async () => {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        dispatch(control, type)
      }
    })

    expect(closeCount).toBe(0)
    expect(underlyingCount).toBe(0)
    expect(document.querySelector('.launcher-web-overlay.is-open')).not.toBeNull()
  })

  it('closes once on Escape from an internal control', async () => {
    const control = document.querySelector('[data-testid="dialog-control"]')
    if (control == null) throw new Error('Missing dialog control')

    await act(async () => {
      control.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Escape'
        })
      )
    })

    expect(closeCount).toBe(1)
    expect(underlyingCount).toBe(0)
  })
})
