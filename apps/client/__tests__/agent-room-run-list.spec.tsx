import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { AgentRoomRunView } from '#~/components/agent-room'
import { AgentRoomRunList, toAgentRoomRunSessionCard } from '#~/components/agent-room/@components/AgentRoomRunList'
import { SessionCard } from '#~/components/sidebar/SessionCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => {
      if (key === 'agentRoom.actions.openRun') {
        return 'Open run'
      }
      if (key === 'agentRoom.roster.noRuns') {
        return 'No runs yet'
      }
      if (key === 'agentRoom.roster.pendingCount') {
        return `${values?.count ?? 0} pending`
      }
      if (key.startsWith('agentRoom.status.run.')) {
        return key.split('.').at(-1) ?? key
      }
      return key
    }
  })
}))

interface TestElementProps {
  children?: ReactNode
  className?: string
  dataSessionCardSource?: string
  onClick?: () => void
  title?: ReactNode
  'aria-label'?: string
}

const run: AgentRoomRunView = {
  runKey: 'schema-plan',
  memberKey: 'architect',
  sessionId: 'session-schema-plan',
  title: 'schema-plan',
  status: 'waiting',
  latestSummary: 'Waiting for confirmation.',
  pendingCount: 1
}

const getProps = (element: ReactElement): TestElementProps => element.props as TestElementProps

const collectElements = (node: ReactNode) => {
  const elements: ReactElement[] = []

  const visit = (value: ReactNode) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isValidElement(value)) {
      return
    }

    elements.push(value)
    visit(getProps(value).children)
  }

  visit(node)
  return elements
}

const hasClass = (element: ReactElement, className: string) =>
  getProps(element).className?.split(/\s+/).includes(className) === true

describe('agent room run list', () => {
  it('adapts room runs to the session-card view model', () => {
    expect(toAgentRoomRunSessionCard(run)).toMatchObject({
      id: 'session-schema-plan',
      status: 'waiting_input',
      summary: 'Waiting for confirmation.',
      title: 'schema-plan'
    })
  })

  it('opens the run from the title button when run navigation is available', () => {
    const onOpenRun = vi.fn()
    const element = AgentRoomRunList({ runs: [run], onOpenRun })
    const elements = collectElements(element)
    const sessionCardElement = elements.find(element => element.type === SessionCard)
    const sessionCardProps = sessionCardElement == null ? undefined : getProps(sessionCardElement)
    const titleElements = collectElements(sessionCardProps?.title)
    const titleButton = titleElements.find(element =>
      element.type === 'button' && hasClass(element, 'agent-room-run-list__title-button')
    )
    const html = renderToStaticMarkup(element)

    expect(sessionCardElement).toBeDefined()
    expect(sessionCardProps?.className).toContain('session-item')
    expect(sessionCardProps?.dataSessionCardSource).toBe('agent-room-run')
    expect(html).toContain('session-item-content')
    expect(html).toContain('session-title-text')
    expect(titleButton).toBeDefined()
    expect(getProps(titleButton!)['aria-label']).toBe('Open run: schema-plan')
    expect(html).not.toContain('agent-room-run-list__action')

    getProps(titleButton!).onClick?.()

    expect(onOpenRun).toHaveBeenCalledTimes(1)
    expect(onOpenRun).toHaveBeenCalledWith(run)
  })

  it('keeps the run title as non-clickable text without run navigation', () => {
    const element = AgentRoomRunList({ runs: [run] })
    const elements = collectElements(element)
    const sessionCardElement = elements.find(element => element.type === SessionCard)
    const sessionCardProps = sessionCardElement == null ? undefined : getProps(sessionCardElement)
    const titleElements = collectElements(sessionCardProps?.title)
    const titleText = titleElements.find(element => element.type === 'span' && hasClass(element, 'session-title-text'))
    const html = renderToStaticMarkup(element)

    expect(titleText).toBeDefined()
    expect(html).not.toContain('agent-room-run-list__title-button')
    expect(html).not.toContain('agent-room-run-list__action')
  })
})
