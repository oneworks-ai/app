// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ModelServiceNativeTabs } from '#~/components/config/ModelServiceNativeTabs'

describe('model service native tabs', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList.contains('native-tabs__items') ? 436 : 0
      }
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
      configurable: true,
      get() {
        return this.getAttribute('aria-selected') === 'true' ? 464 : 0
      }
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return this.classList.contains('native-tabs__tab') ? 80 : 0
      }
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('scrolls a route-selected tab into the horizontal viewport on mount', async () => {
    await act(async () => {
      root.render(
        <ModelServiceNativeTabs
          activeKey='advanced'
          items={[
            { key: 'service', label: 'Service' },
            { key: 'access', label: 'Access' },
            { key: 'models', label: 'Models' },
            { key: 'display', label: 'Display' },
            { key: 'plan', label: 'Plan' },
            { key: 'advanced', label: 'Advanced' }
          ]}
        />
      )
    })

    const items = container.querySelector<HTMLElement>('.native-tabs__items')
    const activeTab = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')

    expect(activeTab?.textContent).toBe('Advanced')
    expect(items?.scrollLeft).toBe(108)
    expect(document.activeElement).toBe(document.body)
  })
})
