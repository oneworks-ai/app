import './ChatHistoryTimelineLab.scss'

import { useState } from 'react'

import type { ChatHistoryTimelineRailRenderMode } from '#~/components/chat/history-timeline'

import { ChatHistoryTimelineScenarioPanel } from './ChatHistoryTimelineScenarioPanel'
import { chatTimelineScenarios } from './chatHistoryTimelineLabModel'

export function ChatHistoryTimelineLab() {
  const [railRenderMode, setRailRenderMode] = useState<ChatHistoryTimelineRailRenderMode>('event-line')

  return (
    <div className='component-lab-timeline'>
      <div
        className='component-lab-timeline__render-mode'
        role='group'
        aria-label='Timeline render mode'
      >
        <button
          type='button'
          className={railRenderMode === 'node' ? 'is-active' : ''}
          aria-pressed={railRenderMode === 'node'}
          onClick={() => setRailRenderMode('node')}
        >
          Nodes
        </button>
        <button
          type='button'
          className={railRenderMode === 'event-line' ? 'is-active' : ''}
          aria-pressed={railRenderMode === 'event-line'}
          onClick={() => setRailRenderMode('event-line')}
        >
          Event lines
        </button>
      </div>
      <section className='component-lab-timeline__scenarios'>
        {chatTimelineScenarios.map(scenario => (
          <ChatHistoryTimelineScenarioPanel
            key={scenario.id}
            hostMessageInserts={scenario.hostMessageInserts}
            initialNodeId={scenario.initialNodeId}
            nodes={scenario.nodes}
            railRenderMode={railRenderMode}
            shellClassName={scenario.shellClassName}
            title={scenario.title}
          />
        ))}
      </section>
    </div>
  )
}
