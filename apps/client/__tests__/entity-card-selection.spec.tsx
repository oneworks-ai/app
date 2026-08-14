// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EntityCard } from '#~/components/entity-card/EntityCard'

describe('entity card selection semantics', () => {
  let container: HTMLDivElement
  let root: Root

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

  it('renders a radio leader card with a compact related-entity avatar list', async () => {
    const onOpenDetails = vi.fn()
    const onKeyDown = vi.fn()
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <EntityCard
          description='Routes the team'
          entityId='leader'
          name='Team leader'
          relatedEntities={Array.from({ length: 5 }, (_, index) => ({
            key: `member-${index + 1}`,
            label: `Member ${index + 1}`
          }))}
          relatedEntitiesLabel='Related entities'
          selected
          selectionMode='radio'
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onOpenDetails={onOpenDetails}
          onSelect={onSelect}
        />
      )
    })

    const card = container.querySelector<HTMLElement>('.entity-card')!
    const selector = container.querySelector<HTMLButtonElement>('.entity-card__selector')!
    const details = container.querySelector<HTMLButtonElement>('.entity-card__name')!
    expect(card.getAttribute('role')).toBeNull()
    expect(selector.getAttribute('role')).toBe('radio')
    expect(selector.getAttribute('aria-checked')).toBe('true')
    expect(selector.getAttribute('aria-label')).toBe('Team leader Routes the team')
    expect(selector.tabIndex).toBe(-1)
    expect(details.tabIndex).toBe(0)
    expect(selector.parentElement).toBe(details.parentElement?.parentElement)
    expect(container.querySelectorAll('.entity-card__related-entities .group-avatar')).toHaveLength(4)
    expect(container.querySelector('.entity-card__related-count')?.textContent).toBe('+1')
    expect(container.querySelector('.entity-card__related-entities')?.getAttribute('aria-label')).toBe(
      'Related entities'
    )

    selector.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onKeyDown).toHaveBeenCalledTimes(1)

    selector.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    expect(onKeyDown).toHaveBeenCalledTimes(2)

    details.focus()
    details.click()
    expect(document.activeElement).toBe(details)
    expect(onOpenDetails).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not expose an inert details button when a card has no details route', async () => {
    await act(async () => {
      root.render(
        <EntityCard
          description='Coordinates the selected team'
          entityId='oneworks:auto-leader'
          name='Auto Leader'
          selectionMode='radio'
        />
      )
    })

    expect(container.querySelector('.entity-card__name.is-static')?.textContent).toBe('Auto Leader')
    expect(container.querySelector('button.entity-card__name')).toBeNull()
  })
})
