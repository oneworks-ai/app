;(() => {
  if (globalThis.__oneWorksExternalBrowserCursorRuntimeInstalled === true) return
  globalThis.__oneWorksExternalBrowserCursorRuntimeInstalled = true
  const inactiveCursorSessions = globalThis.__oneWorksExternalBrowserInactiveCursorSessions ??= new Map()

  const discardInactiveCursor = element => {
    element.dataset.oneworksCursorClosing = 'true'
    element.style.opacity = '0'
    try {
      element.hidePopover?.()
    } catch {}
    element.remove()
    const cursor = globalThis.__oneWorksExternalBrowserCursor
    if (cursor?.element === element) cursor.element = undefined
  }
  const keepCursorVisible = () => {
    const element = document.getElementById('oneworks-external-browser-agent-cursor')
    if (!(element instanceof HTMLElement)) return
    const cursorSessionId = element.dataset.oneworksCursorSessionId
    if (cursorSessionId == null || element.dataset.oneworksCursorClosing === 'true') return
    const cursor = globalThis.__oneWorksExternalBrowserCursor
    if (inactiveCursorSessions.has(cursorSessionId) || cursor?.closedSessionIds?.has(cursorSessionId)) {
      discardInactiveCursor(element)
      return
    }
    element.style.visibility = 'visible'
    element.style.opacity = '1'
    try {
      if (element.matches?.(':popover-open') !== true) element.showPopover?.()
    } catch {}
  }

  const keepAlive = message =>
    message?.type === 'oneworks:external-browser:cursor-runtime-ping'
      ? Promise.resolve({ ready: true })
      : undefined

  let timer
  let lifecycleGeneration = 0
  const validateCachedCursor = async () => {
    const element = document.getElementById('oneworks-external-browser-agent-cursor')
    const cursorSessionId = element?.dataset.oneworksCursorSessionId
    if (!(element instanceof HTMLElement) || typeof cursorSessionId !== 'string' || cursorSessionId === '') return
    let response
    try {
      response = await chrome.runtime.sendMessage({
        type: 'oneworks:external-browser:cursor-session-active',
        cursor_session_id: cursorSessionId
      })
    } catch {}
    if (response?.ok === true && response.result?.active === true) return
    inactiveCursorSessions.set(cursorSessionId, (inactiveCursorSessions.get(cursorSessionId) ?? 0) + 1)
    if (element.dataset.oneworksCursorSessionId === cursorSessionId) discardInactiveCursor(element)
    const currentElement = document.getElementById('oneworks-external-browser-agent-cursor')
    if (
      currentElement instanceof HTMLElement && currentElement !== element &&
      currentElement.dataset.oneworksCursorSessionId === cursorSessionId
    ) discardInactiveCursor(currentElement)
  }
  const start = async validateCachedSession => {
    if (timer != null) return
    const generation = ++lifecycleGeneration
    if (validateCachedSession) await validateCachedCursor()
    if (generation !== lifecycleGeneration || timer != null) return
    chrome.runtime.onMessage.addListener(keepAlive)
    timer = setInterval(keepCursorVisible, 100)
    keepCursorVisible()
  }
  const stop = () => {
    lifecycleGeneration += 1
    if (timer == null) return
    clearInterval(timer)
    timer = undefined
    chrome.runtime.onMessage.removeListener(keepAlive)
    const element = document.getElementById('oneworks-external-browser-agent-cursor')
    if (element instanceof HTMLElement) element.style.visibility = 'hidden'
  }

  void start(false)
  addEventListener('pagehide', stop)
  addEventListener('pageshow', () => void start(true))
})()
