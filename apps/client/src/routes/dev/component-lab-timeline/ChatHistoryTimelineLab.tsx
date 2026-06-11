import './ChatHistoryTimelineLab.scss'

import { ChatHistoryTimelineScenarioPanel } from './ChatHistoryTimelineScenarioPanel'
import { chatTimelineScenarios } from './chatHistoryTimelineLabModel'

export function ChatHistoryTimelineLab() {
  return (
    <div className='component-lab-timeline'>
      <section className='component-lab-timeline__scenarios'>
        {chatTimelineScenarios.map(scenario => (
          <ChatHistoryTimelineScenarioPanel
            key={scenario.id}
            hostMessageInserts={scenario.hostMessageInserts}
            initialNodeId={scenario.initialNodeId}
            nodes={scenario.nodes}
            shellClassName={scenario.shellClassName}
            title={scenario.title}
          />
        ))}
      </section>
    </div>
  )
}
