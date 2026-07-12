import type { BrowserControlPageCommandCompletion, BrowserControlPageCommandRequest } from '@oneworks/types'

export interface BrowserControlPageNavigationController {
  clearNavigationHistory: () => Promise<{ history: string[]; historyIndex: number }>
  state: { history: string[]; historyIndex: number; url: string }
  syncNavigationHistory: (input: {
    activeIndex: number
    currentUrl: string
    entries: Array<{ title?: string; url: string }>
  }) => Promise<{ history: string[]; historyIndex: number }>
}

export const handleBrowserControlPageNavigationCommand = ({
  complete,
  controller,
  request
}: {
  complete: (completion: Omit<BrowserControlPageCommandCompletion, 'requestId'>) => void
  controller: BrowserControlPageNavigationController
  request: BrowserControlPageCommandRequest
}) => {
  const command = request.command
  const current = controller.state
  if (command.type === 'get_navigation_state') {
    complete({
      ok: true,
      result: {
        can_go_back: current.historyIndex > 0,
        can_go_forward: current.historyIndex >= 0 && current.historyIndex < current.history.length - 1,
        current_index: current.historyIndex,
        current_url: current.url,
        page_id: request.pageId,
        total_entries: current.history.length
      }
    })
    return true
  }

  if (command.type === 'get_navigation_entries') {
    const entries = current.history
      .slice(command.offset, command.offset + command.limit)
      .map((url, index) => ({
        index: command.offset + index,
        is_current: command.offset + index === current.historyIndex,
        url
      }))
    complete({
      ok: true,
      result: {
        current_index: current.historyIndex,
        entries,
        limit: command.limit,
        offset: command.offset,
        page_id: request.pageId,
        total_entries: current.history.length
      }
    })
    return true
  }

  if (command.type === 'clear_navigation_history') {
    void controller.clearNavigationHistory()
      .then(applied =>
        complete({
          ok: true,
          result: {
            current_index: applied.historyIndex,
            current_url: applied.history[applied.historyIndex] ?? current.url,
            page_id: request.pageId,
            total_entries: applied.history.length
          }
        })
      )
      .catch(error =>
        complete({
          ok: false,
          error: {
            code: 'NAVIGATION_HISTORY_CLEAR_FAILED',
            message: error instanceof Error ? error.message : String(error)
          }
        })
      )
    return true
  }

  if (command.type === 'sync_navigation_history') {
    void controller.syncNavigationHistory({
      activeIndex: command.active_index,
      currentUrl: command.current_url,
      entries: command.entries
    }).then(applied =>
      complete({
        ok: true,
        result: {
          current_index: applied.historyIndex,
          current_url: applied.history[applied.historyIndex] ?? command.current_url,
          page_id: request.pageId,
          total_entries: applied.history.length
        }
      })
    ).catch(error =>
      complete({
        ok: false,
        error: {
          code: 'NAVIGATION_HISTORY_SYNC_FAILED',
          message: error instanceof Error ? error.message : String(error)
        }
      })
    )
    return true
  }

  return false
}
