import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentRoomRunView } from '#~/components/agent-room'
import { AgentRoomRunList, toAgentRoomRunSessionCard } from '#~/components/agent-room/@components/AgentRoomRunList'
import { SessionCard } from '#~/components/sidebar/SessionCard'
import type { SessionCardProps } from '#~/components/sidebar/SessionCard'

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
  'data-session-card-source'?: string
  onClick?: () => void
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
    const renderedSessionCard = sessionCardElement == null
      ? undefined
      : SessionCard(getProps(sessionCardElement) as SessionCardProps)
    const sessionCardElements = renderedSessionCard == null ? [] : collectElements(renderedSessionCard)
    const sessionCard = sessionCardElements.find(element =>
      element.type === 'article' &&
      hasClass(element, 'session-item') &&
      getProps(element)['data-session-card-source'] === 'agent-room-run'
    )
    const titleButton = sessionCardElements.find(element =>
      element.type === 'button' && hasClass(element, 'agent-room-run-list__title-button')
    )

    expect(sessionCardElement).toBeDefined()
    expect(sessionCard).toBeDefined()
    expect(sessionCardElements.some(element => hasClass(element, 'session-item-content'))).toBe(true)
    expect(sessionCardElements.some(element => hasClass(element, 'session-title-text'))).toBe(true)
    expect(titleButton).toBeDefined()
    expect(getProps(titleButton!)['aria-label']).toBe('Open run: schema-plan')
    expect(sessionCardElements.some(element => hasClass(element, 'agent-room-run-list__action'))).toBe(false)

    getProps(titleButton!).onClick?.()

    expect(onOpenRun).toHaveBeenCalledTimes(1)
    expect(onOpenRun).toHaveBeenCalledWith(run)
  })

  it('keeps the run title as non-clickable text without run navigation', () => {
    const element = AgentRoomRunList({ runs: [run] })
    const elements = collectElements(element)
    const sessionCardElement = elements.find(element => element.type === SessionCard)
    const renderedSessionCard = sessionCardElement == null
      ? undefined
      : SessionCard(getProps(sessionCardElement) as SessionCardProps)
    const sessionCardElements = renderedSessionCard == null ? [] : collectElements(renderedSessionCard)
    const titleText = sessionCardElements.find(element =>
      element.type === 'span' && hasClass(element, 'session-title-text')
    )

    expect(titleText).toBeDefined()
    expect(sessionCardElements.some(element => hasClass(element, 'agent-room-run-list__title-button'))).toBe(false)
    expect(sessionCardElements.some(element => hasClass(element, 'agent-room-run-list__action'))).toBe(false)
  })
})
