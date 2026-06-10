import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

import type { ChatHistoryTimelineNodeMarks } from './types'

export function TimelineMarks({ marks }: { marks?: ChatHistoryTimelineNodeMarks }) {
  if (marks?.pinned !== true && marks?.starred !== true) return null

  return (
    <span className='chat-history-timeline-marks' aria-hidden='true'>
      {marks.pinned === true && (
        <MaterialSymbol
          name='push_pin'
          className='chat-history-timeline-marks__icon'
        />
      )}
      {marks.starred === true && (
        <MaterialSymbol
          filled
          name='star'
          className='chat-history-timeline-marks__icon'
        />
      )}
    </span>
  )
}
