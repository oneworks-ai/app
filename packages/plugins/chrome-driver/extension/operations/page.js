/* eslint-disable max-lines -- Semantic target identity and page actions share one injected state machine. */
import { requireAdvancedAccess } from './security.js'
import { cleanTab, error, requirePermissions, safeFilename } from './shared.js'

const activeCursorTargets = new Map()

async function resolveTarget(args) {
  await requirePermissions(['tabs', 'webNavigation'])
  const tab = await chrome.tabs.get(args.tab_id)
  if (
    tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('devtools://')
  ) {
    throw error('RESTRICTED_PAGE', 'Chrome does not allow page scripting on this protected URL.')
  }
  const frames = await chrome.webNavigation.getAllFrames({ tabId: args.tab_id }) ?? []
  const frameId = args.frame_id ?? 0
  const frame = frames.find(candidate => candidate.frameId === frameId)
  if (frame == null) throw error('FRAME_NOT_FOUND', 'The requested Chrome frame no longer exists.')
  if (args.document_id == null && ['click', 'type', 'select', 'press_key', 'scroll'].includes(args.action)) {
    throw error(
      'DOCUMENT_ID_REQUIRED',
      'Mutating a semantic ref requires the document_id returned by snapshot or frame discovery.'
    )
  }
  if (args.document_id != null && frame.documentId !== args.document_id) {
    throw error('DOCUMENT_CHANGED', 'The requested frame navigated to a different document. Discover frames again.')
  }
  const frameOrigin = new URL(frame.url).origin
  await requirePermissions(['scripting'], [`${frameOrigin}/*`])
  return { tab, frame, frameId }
}

export async function semanticPageOperation(input) {
  const state = globalThis.__oneWorksChromeState ??= { generation: 0, refs: new Map() }
  const visible = element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
  }
  const role = element =>
    element.getAttribute('role') || ({
      A: 'link',
      BUTTON: 'button',
      INPUT: element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio' : 'textbox',
      SELECT: 'combobox',
      TEXTAREA: 'textbox',
      IMG: 'img',
      H1: 'heading',
      H2: 'heading',
      H3: 'heading'
    })[element.tagName] || undefined
  const name = element =>
    (
      element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') ||
      (element.labels?.length ? [...element.labels].map(label => label.innerText).join(' ') : '') ||
      element.innerText || element.getAttribute('placeholder') || ''
    ).replaceAll(/\s+/g, ' ').trim().slice(0, 240)
  const isSensitiveElement = element => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
      return false
    }
    const descriptor = `${element.getAttribute('name') ?? ''} ${element.getAttribute('id') ?? ''} ${
      element.getAttribute('autocomplete') ?? ''
    } ${name(element)}`
    const autocomplete = element.getAttribute('autocomplete')?.trim().toLowerCase() ?? ''
    return element instanceof HTMLInputElement && element.type === 'password' ||
      /^(?:current-password|new-password|one-time-code|cc-(?:name|number|exp|exp-month|exp-year|csc|type))$/u.test(
        autocomplete
      ) ||
      /password|passcode|otp|one.?time|token|api.?key|secret|auth|credit|card|cvv|cvc|cc.?number|security.?code/iu.test(
        descriptor
      )
  }
  const nodeForRef = ref => {
    const node = state.refs.get(ref)
    if (!(node instanceof Element) || !node.isConnected) {
      throw Object.assign(new Error(`Semantic ref is stale or missing: ${ref}`), { code: 'TARGET_NOT_FOUND' })
    }
    return node
  }
  const inputEvent = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true, composed: true }))
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  const cursorTarget = node => {
    if (node instanceof Element) {
      const rect = node.getBoundingClientRect()
      return {
        x: Math.min(innerWidth - 5, Math.max(5, rect.left + (rect.width / 2))),
        y: Math.min(innerHeight - 5, Math.max(5, rect.top + (rect.height / 2)))
      }
    }
    return { x: innerWidth / 2, y: innerHeight / 2 }
  }
  const cursorTransform = (x, y, scale = 1) => `translate3d(${x - 5}px, ${y - 5}px, 0) scale(${scale})`
  const showCursor = async node => {
    if (typeof input.cursor_session_id !== 'string' || input.cursor_session_id === '') return undefined
    const cursor = globalThis.__oneWorksExternalBrowserCursor ??= {}
    cursor.closedSessionIds ??= new Set()
    if (cursor.closedSessionIds.has(input.cursor_session_id)) return undefined
    const inactiveCursorSessions = globalThis.__oneWorksExternalBrowserInactiveCursorSessions ??= new Map()
    const inactiveGeneration = inactiveCursorSessions.get(input.cursor_session_id)
    let sessionStatus
    try {
      sessionStatus = await chrome.runtime.sendMessage({
        type: 'oneworks:external-browser:cursor-session-active',
        cursor_session_id: input.cursor_session_id
      })
    } catch {}
    if (sessionStatus?.ok !== true || sessionStatus.result?.active !== true) {
      inactiveCursorSessions.set(input.cursor_session_id, (inactiveGeneration ?? 0) + 1)
      throw Object.assign(new Error('The browser cursor session is no longer active.'), {
        code: 'CURSOR_SESSION_INACTIVE'
      })
    }
    if (
      cursor.closedSessionIds.has(input.cursor_session_id) ||
      inactiveCursorSessions.get(input.cursor_session_id) !== inactiveGeneration
    ) {
      throw Object.assign(new Error('The browser cursor session is no longer active.'), {
        code: 'CURSOR_SESSION_INACTIVE'
      })
    }
    inactiveCursorSessions.delete(input.cursor_session_id)
    if (!(cursor.element instanceof HTMLImageElement) || !cursor.element.isConnected) {
      const image = document.createElement('img')
      image.id = 'oneworks-external-browser-agent-cursor'
      image.alt = ''
      image.setAttribute('aria-hidden', 'true')
      image.setAttribute('popover', 'manual')
      Object.assign(image.style, {
        background: 'transparent',
        border: '0',
        display: 'block',
        filter: 'drop-shadow(0 2px 3px rgba(15, 23, 42, .28))',
        height: '28px',
        inset: '0 auto auto 0',
        left: '0',
        margin: '0',
        opacity: '0',
        padding: '0',
        pointerEvents: 'none',
        position: 'fixed',
        top: '0',
        transform: 'translate3d(0, 0, 0)',
        transformOrigin: '5px 5px',
        transition: 'opacity 240ms ease',
        width: '28px',
        willChange: 'transform, opacity',
        zIndex: '2147483647'
      })
      image.src = input.cursor_url
      ;(document.body ?? document.documentElement).append(image)
      try {
        image.showPopover?.()
      } catch {}
      cursor.element = image
      cursor.x = innerWidth / 2
      cursor.y = innerHeight / 2
      image.style.transform = cursorTransform(cursor.x, cursor.y)
      await delay(16)
    }
    cursor.sessionId = input.cursor_session_id
    cursor.element.dataset.oneworksCursorSessionId = input.cursor_session_id
    delete cursor.element.dataset.oneworksCursorClosing
    try {
      if (cursor.element.matches?.(':popover-open') !== true) cursor.element.showPopover?.()
    } catch {}
    cursor.generation = (cursor.generation ?? 0) + 1
    const point = cursorTarget(node)
    cursor.element.style.opacity = '1'
    if (document.visibilityState !== 'visible') {
      cursor.element.style.transform = cursorTransform(point.x, point.y)
      cursor.x = point.x
      cursor.y = point.y
      return cursor
    }
    const distance = Math.hypot(point.x - cursor.x, point.y - cursor.y)
    const duration = Math.min(900, Math.max(360, Math.round(260 + (distance * 0.75))))
    if (typeof cursor.element.animate === 'function') {
      const movement = cursor.element.animate(
        [{ transform: cursorTransform(cursor.x, cursor.y) }, { transform: cursorTransform(point.x, point.y) }],
        { duration, easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'forwards' }
      )
      await Promise.race([movement.finished.catch(() => undefined), delay(duration + 150)])
      cursor.element.style.transform = cursorTransform(point.x, point.y)
      movement.cancel()
    } else {
      cursor.element.style.transition = `transform ${duration}ms cubic-bezier(.25,.1,.25,1), opacity 240ms ease`
      cursor.element.style.transform = cursorTransform(point.x, point.y)
      await delay(duration)
    }
    if (cursor.closedSessionIds.has(input.cursor_session_id)) return undefined
    cursor.element.style.transform = cursorTransform(point.x, point.y)
    cursor.x = point.x
    cursor.y = point.y
    return cursor
  }
  const completeCursorAction = async (cursor, action) => {
    if (cursor?.element == null || !cursor.element.isConnected) return
    if (document.visibilityState !== 'visible') return
    if (action === 'click' && typeof cursor.element.animate === 'function') {
      const feedback = cursor.element.animate(
        [
          { transform: cursorTransform(cursor.x, cursor.y) },
          { transform: cursorTransform(cursor.x, cursor.y, 0.86) },
          { transform: cursorTransform(cursor.x, cursor.y) }
        ],
        { duration: 320, easing: 'cubic-bezier(.25,.1,.25,1)' }
      )
      await Promise.race([feedback.finished.catch(() => undefined), delay(400)])
      feedback.cancel()
    } else if (action === 'click') {
      cursor.element.style.transform = cursorTransform(cursor.x, cursor.y, 0.86)
      await delay(160)
      cursor.element.style.transform = cursorTransform(cursor.x, cursor.y)
    }
    await delay(125)
  }
  const cursorOutcome = cursor => ({
    cursor_session_id: cursor?.sessionId,
    cursor_visible: cursor?.element?.isConnected === true && cursor.element.style.opacity !== '0'
  })

  if (input.action === 'snapshot') {
    state.generation += 1
    state.refs = new Map()
    const elements = []
    const candidates = [
      ...document.querySelectorAll(
        'a,button,input,textarea,select,summary,[role],[tabindex],h1,h2,h3,[contenteditable="true"]'
      )
    ]
    for (const element of candidates.slice(0, 1000)) {
      if (!visible(element)) continue
      const ref = `r${state.generation}_${elements.length + 1}`
      state.refs.set(ref, element)
      const rect = element.getBoundingClientRect()
      const sensitive = isSensitiveElement(element)
      elements.push({
        ref,
        tag: element.tagName.toLowerCase(),
        role: role(element),
        name: name(element),
        ...(sensitive
          ? {
            sensitive: true,
            value: input.allow_sensitive_fields === true ? String(element.value).slice(0, 240) : '[redacted]'
          }
          : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
              element instanceof HTMLSelectElement
          ? { value: String(element.value).slice(0, 240) }
          : {}),
        disabled: 'disabled' in element ? element.disabled : undefined,
        checked: 'checked' in element ? element.checked : undefined,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })
    }
    return {
      url: location.href,
      title: document.title,
      document_ready_state: document.readyState,
      viewport: { width: innerWidth, height: innerHeight, scroll_x: scrollX, scroll_y: scrollY },
      text: (document.body?.innerText ?? '').replaceAll(/\s+/g, ' ').trim().slice(0, 8000),
      elements
    }
  }
  if (input.action === 'click') {
    const node = nodeForRef(input.ref)
    node.scrollIntoView({ block: 'center', inline: 'center' })
    const cursor = await showCursor(node)
    await completeCursorAction(cursor, input.action)
    node.click()
    return { clicked: input.ref, ...cursorOutcome(cursor) }
  }
  if (input.action === 'type') {
    const node = nodeForRef(input.ref)
    if (isSensitiveElement(node) && input.allow_sensitive_fields !== true) {
      throw Object.assign(
        new Error('Typing into sensitive fields requires the session-only sensitive-fields switch.'),
        { code: 'SENSITIVE_FIELD_BLOCKED' }
      )
    }
    const cursor = await showCursor(node)
    node.focus()
    if (input.clear !== false && 'value' in node) node.value = ''
    if ('value' in node) node.value = `${node.value ?? ''}${input.text}`
    else if (node.isContentEditable) node.textContent = input.text
    else throw Object.assign(new Error('The semantic target is not editable.'), { code: 'TARGET_NOT_EDITABLE' })
    inputEvent(node, 'input')
    inputEvent(node, 'change')
    await completeCursorAction(cursor, input.action)
    return { typed: input.ref, character_count: input.text.length, ...cursorOutcome(cursor) }
  }
  if (input.action === 'select') {
    const node = nodeForRef(input.ref)
    if (!(node instanceof HTMLSelectElement)) {
      throw Object.assign(new Error('The semantic target is not a select element.'), { code: 'TARGET_NOT_SELECT' })
    }
    const cursor = await showCursor(node)
    node.value = input.value
    inputEvent(node, 'input')
    inputEvent(node, 'change')
    await completeCursorAction(cursor, input.action)
    return { selected: input.ref, value: input.value, ...cursorOutcome(cursor) }
  }
  if (input.action === 'press_key') {
    const node = input.ref ? nodeForRef(input.ref) : document.activeElement
    if (!(node instanceof Element)) {
      throw Object.assign(new Error('No semantic key target is active.'), { code: 'TARGET_NOT_FOUND' })
    }
    const cursor = await showCursor(node)
    node.dispatchEvent(new KeyboardEvent('keydown', { key: input.key, bubbles: true, composed: true }))
    node.dispatchEvent(new KeyboardEvent('keyup', { key: input.key, bubbles: true, composed: true }))
    await completeCursorAction(cursor, input.action)
    return { key: input.key, target: input.ref ?? 'active_element', ...cursorOutcome(cursor) }
  }
  if (input.action === 'scroll') {
    const node = input.ref ? nodeForRef(input.ref) : window
    const cursor = await showCursor(node)
    node.scrollBy({ left: input.x, top: input.y, behavior: 'instant' })
    await completeCursorAction(cursor, input.action)
    return { scrolled: true, x: input.x, y: input.y, ...cursorOutcome(cursor) }
  }
  if (input.action === 'check') {
    let matched
    try {
      const node = nodeForRef(input.ref)
      matched = input.state === 'hidden'
        ? !visible(node)
        : input.state === 'visible'
        ? visible(node)
        : input.state === 'exists'
    } catch {
      matched = input.state === 'not_exists' || input.state === 'hidden'
    }
    return { matched }
  }
  if (input.action === 'print') {
    window.print()
    return { print_dialog_opened: true }
  }
  throw Object.assign(new Error(`Unsupported semantic page action: ${input.action}`), { code: 'UNSUPPORTED_ACTION' })
}

export async function semanticCursorLifecycle(input) {
  if (input.action !== 'close_session') {
    throw Object.assign(new Error(`Unsupported cursor lifecycle action: ${input.action}`), {
      code: 'UNSUPPORTED_ACTION'
    })
  }
  const cursor = globalThis.__oneWorksExternalBrowserCursor ??= {}
  cursor.closedSessionIds ??= new Set()
  cursor.closedSessionIds.add(input.cursor_session_id)
  const element = cursor.element instanceof HTMLImageElement && cursor.element.isConnected
    ? cursor.element
    : document.getElementById('oneworks-external-browser-agent-cursor')
  const elementSessionId = cursor.sessionId ?? element?.dataset.oneworksCursorSessionId
  if (!(element instanceof HTMLElement) || elementSessionId !== input.cursor_session_id) {
    return { closed: true, removed: false }
  }
  const generation = cursor.generation = (cursor.generation ?? 0) + 1
  element.dataset.oneworksCursorClosing = 'true'
  element.style.transition = 'opacity 240ms ease'
  element.style.opacity = '0'
  await new Promise(resolve => setTimeout(resolve, 240))
  if (
    cursor.sessionId === input.cursor_session_id && cursor.generation === generation &&
    element.dataset.oneworksCursorSessionId === input.cursor_session_id
  ) {
    try {
      element.hidePopover?.()
    } catch {}
    element.remove()
    cursor.element = undefined
    return { closed: true, removed: true }
  }
  return { closed: true, removed: false }
}

export async function semanticTabActivity(input) {
  const id = 'oneworks-external-browser-agent-favicon'
  const restoreId = 'oneworks-external-browser-restored-favicon'
  const state = globalThis.__oneWorksExternalBrowserFavicon ??= {}
  const host = () => document.head ?? document.documentElement
  const relTokens = value => String(value ?? '').toLowerCase().split(/\s+/u)
  const isFavicon = node =>
    node?.tagName === 'LINK' && relTokens(node.getAttribute?.('rel') ?? node.rel).includes('icon')
  const isManaged = node => node?.id === id || node?.id === restoreId || node?.dataset?.oneworksFaviconManager != null
  const nativeFavicons = () =>
    [...document.querySelectorAll('link[rel]')].filter(node => isFavicon(node) && !isManaged(node))
  const removeRestores = () => {
    for (const link of document.querySelectorAll('link[rel]')) {
      if (link?.dataset?.oneworksFaviconManager === 'restore') link.remove()
    }
  }
  const setAttribute = (link, name, value) => {
    if (typeof link.setAttribute === 'function') link.setAttribute(name, value)
    else link[name] = value
  }
  const suspendNativeFavicons = () => {
    state.suspendedNativeFavicons ??= new Map()
    for (const link of nativeFavicons()) {
      if (state.suspendedNativeFavicons.has(link)) continue
      const restoreRel = link.getAttribute?.('rel') ?? link.rel ?? 'icon'
      const suspendedRel = [
        ...relTokens(restoreRel).filter(token => token !== 'icon'),
        'oneworks-suspended-icon'
      ].join(' ')
      state.suspendedNativeFavicons.set(link, { restoreRel, suspendedRel })
      setAttribute(link, 'rel', suspendedRel)
    }
  }
  const restoreSuspendedNativeFavicons = () => {
    for (const [link, entry] of state.suspendedNativeFavicons ?? []) {
      if (!link?.isConnected) continue
      const currentRel = link.getAttribute?.('rel') ?? link.rel
      if (currentRel === entry.suspendedRel) setAttribute(link, 'rel', entry.restoreRel)
    }
    state.suspendedNativeFavicons = new Map()
  }
  const restoreNative = () => {
    removeRestores()
    const native = nativeFavicons()
    if (native.length === 0) {
      if (typeof state.defaultFaviconUrl !== 'string' || state.defaultFaviconUrl === '') return
      const link = document.createElement('link')
      link.id = restoreId
      link.rel = 'icon'
      link.type = 'image/svg+xml'
      link.href = state.defaultFaviconUrl
      link.dataset.oneworksFaviconManager = 'restore'
      link.dataset.oneworksRestoredFavicon = 'default'
      host().append(link)
      state.restoreSource = 'default'
      return
    }
    const attributes = ['rel', 'href', 'type', 'sizes', 'media', 'crossorigin', 'referrerpolicy']
    for (const [index, source] of native.entries()) {
      const link = document.createElement('link')
      for (const attribute of attributes) {
        const value = source.getAttribute?.(attribute) ?? (attribute === 'href' ? source.href : undefined)
        if (typeof value === 'string' && value !== '') setAttribute(link, attribute, value)
      }
      if (index === native.length - 1) link.id = restoreId
      link.dataset.oneworksFaviconManager = 'restore'
      link.dataset.oneworksRestoredFavicon = 'site'
      host().append(link)
    }
    state.restoreSource = 'site'
  }
  const ensureAgent = () => {
    removeRestores()
    suspendNativeFavicons()
    let link = state.agentLink
    if (link?.tagName !== 'LINK') link = document.createElement('link')
    const existing = document.getElementById(id)
    if (existing != null && existing !== link) existing.remove()
    link.id = id
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    link.href = `${state.cursorUrl}?activity=${encodeURIComponent(state.activityId)}`
    link.dataset.oneworksActivityId = state.activityId
    link.dataset.oneworksFaviconManager = 'agent'
    state.agentLink = link
    host().append(link)
  }
  const nodeContainsNativeLink = node =>
    isFavicon(node) && !isManaged(node) ||
    [...(node?.querySelectorAll?.('link') ?? [])].some(link => isFavicon(link) && !isManaged(link))
  const nodeContainsAgentLink = node => node?.id === id || node?.querySelector?.(`#${id}`) != null
  const mutationTouchesNativeLink = record => {
    if (record.type === 'attributes') {
      return record.target?.tagName === 'LINK' && !isManaged(record.target) &&
        (isFavicon(record.target) || relTokens(record.oldValue).includes('icon'))
    }
    return [...record.addedNodes, ...record.removedNodes].some(nodeContainsNativeLink)
  }
  const scheduleSync = () => {
    if (state.syncScheduled === true) return
    state.syncScheduled = true
    const synchronize = () => {
      state.syncScheduled = false
      if (state.activityId != null) ensureAgent()
      else restoreNative()
    }
    if (typeof queueMicrotask === 'function') queueMicrotask(synchronize)
    else void Promise.resolve().then(synchronize)
  }
  const ensureObserver = () => {
    if (state.observer != null || typeof MutationObserver !== 'function') return
    state.observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type !== 'attributes' || record.attributeName !== 'rel') continue
        const entry = state.suspendedNativeFavicons?.get(record.target)
        if (entry == null || record.oldValue !== entry.suspendedRel) continue
        const restoreRel = record.target.getAttribute?.('rel') ?? record.target.rel ?? ''
        if (!relTokens(restoreRel).includes('icon')) {
          entry.restoreRel = restoreRel
          entry.suspendedRel = undefined
          continue
        }
        const suspendedRel = [
          ...relTokens(restoreRel).filter(token => token !== 'icon'),
          'oneworks-suspended-icon'
        ].join(' ')
        entry.restoreRel = restoreRel
        entry.suspendedRel = suspendedRel
        setAttribute(record.target, 'rel', suspendedRel)
      }
      const agentRemoved = records.some(record =>
        record.type === 'childList' && [...record.removedNodes].some(nodeContainsAgentLink)
      )
      const agentMissing = state.activityId != null && agentRemoved &&
        (!state.agentLink?.isConnected || document.getElementById(id) !== state.agentLink)
      if (agentMissing || records.some(mutationTouchesNativeLink)) scheduleSync()
    })
    state.observer.observe(host(), {
      attributeFilter: ['crossorigin', 'href', 'media', 'referrerpolicy', 'rel', 'sizes', 'type'],
      attributeOldValue: true,
      attributes: true,
      childList: true,
      subtree: true
    })
  }
  if (input.action === 'begin') {
    state.activityId = input.activity_id
    state.cursorUrl = input.cursor_url
    state.defaultFaviconUrl = input.default_favicon_url
    state.restoreSource = undefined
    ensureObserver()
    ensureAgent()
    return { active: true }
  }
  if (input.action === 'end') {
    setTimeout(() => {
      if (state.activityId !== input.activity_id) return
      state.agentLink?.remove()
      document.getElementById(id)?.remove()
      state.agentLink = undefined
      state.activityId = undefined
      restoreSuspendedNativeFavicons()
      restoreNative()
    }, 1_500)
    return { active: false, restore_scheduled: true }
  }
  throw Object.assign(new Error(`Unsupported tab activity action: ${input.action}`), { code: 'UNSUPPORTED_ACTION' })
}

async function executeSemantic(args, action = args.action) {
  const target = await resolveTarget({ ...args, action })
  const visibleAction = ['click', 'type', 'select', 'press_key', 'scroll'].includes(action)
  const cursorUrl = chrome.runtime.getURL('agent-cursor.svg')
  const defaultFaviconUrl = chrome.runtime.getURL('default-tab-favicon.svg')
  const activityId = `${Date.now()}-${crypto.randomUUID()}`
  if (visibleAction) {
    activeCursorTargets.set(`${args.cursor_session_id}:${args.tab_id}:${target.frameId}`, {
      cursorSessionId: args.cursor_session_id,
      documentId: target.frame.documentId,
      frameId: target.frameId,
      tabId: args.tab_id
    })
    await chrome.scripting.executeScript({
      target: { tabId: args.tab_id, frameIds: [target.frameId] },
      files: ['cursor-runtime.js']
    })
    await chrome.scripting.executeScript({
      target: { tabId: args.tab_id, frameIds: [0] },
      func: semanticTabActivity,
      args: [{
        action: 'begin',
        activity_id: activityId,
        cursor_url: cursorUrl,
        default_favicon_url: defaultFaviconUrl
      }]
    }).catch(() => undefined)
  }
  let result
  try {
    ;[result] = await chrome.scripting.executeScript({
      target: { tabId: args.tab_id, frameIds: [target.frameId] },
      func: semanticPageOperation,
      args: [{ ...args, action, cursor_url: cursorUrl }]
    })
  } finally {
    if (visibleAction) {
      await chrome.scripting.executeScript({
        target: { tabId: args.tab_id, frameIds: [0] },
        func: semanticTabActivity,
        args: [{
          action: 'end',
          activity_id: activityId,
          cursor_url: cursorUrl,
          default_favicon_url: defaultFaviconUrl
        }]
      }).catch(() => undefined)
    }
  }
  if (result == null) throw error('PAGE_EXECUTION_FAILED', 'Chrome returned no semantic page result.')
  return { tab: cleanTab(target.tab), frame_id: target.frameId, document_id: target.frame.documentId, ...result.result }
}

export async function cleanupPageCursors(cursorSessionId) {
  if (typeof cursorSessionId !== 'string' || cursorSessionId === '') return
  const targets = [...activeCursorTargets.values()].filter(target => target.cursorSessionId === cursorSessionId)
  await Promise.all(targets.map(target =>
    chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [target.frameId] },
      func: semanticCursorLifecycle,
      args: [{ action: 'close_session', cursor_session_id: cursorSessionId }]
    }).catch(() => undefined)
  ))
  for (const [key, target] of activeCursorTargets) {
    if (target.cursorSessionId === cursorSessionId) activeCursorTargets.delete(key)
  }
  const tabs = await chrome.tabs.query({}).catch(() => [])
  await Promise.all(tabs.flatMap(tab =>
    tab.id == null
      ? []
      : [
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: semanticCursorLifecycle,
          args: [{ action: 'close_session', cursor_session_id: cursorSessionId }]
        }).catch(() => undefined)
      ]
  ))
}

async function wait(args) {
  const deadline = Date.now() + (args.timeout_ms ?? 5000)
  do {
    if (args.url_pattern != null) {
      const tab = await chrome.tabs.get(args.tab_id)
      if (tab.url?.includes(args.url_pattern)) return { matched: true }
    }
    if (args.ref != null) {
      const result = await executeSemantic(args, 'check')
      if (result.matched) return result
    }
    if (args.ref == null && args.url_pattern == null) {
      const tab = await chrome.tabs.get(args.tab_id)
      if (tab.status === 'complete') return { matched: true, status: tab.status, url: tab.url }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() <= deadline)
  throw error('WAIT_TIMEOUT', 'The semantic page wait timed out.')
}

async function visibleScreenshot(args) {
  const target = await resolveTarget(args)
  if (args.full_page === true) {
    throw error(
      'PRIVILEGED_FLAVOR_REQUIRED',
      'Full-page screenshot requires the bounded debugger operation in the privileged flavor.'
    )
  }
  const [previous] = await chrome.tabs.query({ active: true, windowId: target.tab.windowId })
  await chrome.windows.update(target.tab.windowId, { focused: true })
  await chrome.tabs.update(args.tab_id, { active: true })
  const dataUrl = await chrome.tabs.captureVisibleTab(target.tab.windowId, { format: args.format ?? 'png' })
  if (previous?.id != null && previous.id !== args.tab_id) {
    await chrome.tabs.update(previous.id, { active: true }).catch(() => undefined)
  }
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (match == null) throw error('SCREENSHOT_FAILED', 'Chrome returned an invalid screenshot.')
  return { tab_id: args.tab_id, mime_type: match[1], data_base64: match[2] }
}

export async function framesOperation(action, args) {
  await requirePermissions(['webNavigation'])
  if (action === 'list') {
    return (await chrome.webNavigation.getAllFrames({ tabId: args.tab_id }) ?? []).map(frame => ({
      tab_id: args.tab_id,
      frame_id: frame.frameId,
      parent_frame_id: frame.parentFrameId,
      document_id: frame.documentId,
      document_lifecycle: frame.documentLifecycle,
      frame_type: frame.frameType,
      url: frame.url,
      error_occurred: frame.errorOccurred
    }))
  }
  if (action === 'get') {
    const frame = await chrome.webNavigation.getFrame({
      tabId: args.tab_id,
      frameId: args.frame_id,
      documentId: args.document_id
    })
    if (frame == null) throw error('FRAME_NOT_FOUND', 'The requested frame no longer exists.')
    return {
      tab_id: args.tab_id,
      frame_id: frame.frameId,
      parent_frame_id: frame.parentFrameId,
      document_id: frame.documentId,
      url: frame.url
    }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported frames action: ${action}`)
}

export async function pageOperation(action, args, debugOperation) {
  if (action === 'check_url') {
    if (typeof args.url_pattern !== 'string' || args.url_pattern === '') {
      throw error('INVALID_ARGUMENT', 'URL check requires a non-empty pattern.')
    }
    const tab = await chrome.tabs.get(args.tab_id)
    return { matched: typeof tab.url === 'string' && tab.url.includes(args.url_pattern) }
  }
  if (action === 'snapshot_sensitive') {
    await requireAdvancedAccess('sensitive_fields')
    return executeSemantic({ ...args, allow_sensitive_fields: true }, 'snapshot')
  }
  if (action === 'type_sensitive') {
    await requireAdvancedAccess('sensitive_fields')
    return executeSemantic({ ...args, allow_sensitive_fields: true }, 'type')
  }
  if (action === 'snapshot' || ['click', 'type', 'select', 'press_key', 'scroll', 'print'].includes(action)) {
    return executeSemantic({ ...args, allow_sensitive_fields: false }, action)
  }
  if (action === 'wait') return wait(args)
  if (action === 'screenshot') return visibleScreenshot(args)
  if (action === 'save_mhtml') {
    await requirePermissions(['pageCapture', 'downloads'])
    const blob = await chrome.pageCapture.saveAsMHTML({ tabId: args.tab_id })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const dataUrl = `data:multipart/related;base64,${btoa(binary)}`
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: safeFilename(args.filename, `page-${Date.now()}.mhtml`)
    })
    return { download_id: downloadId, filename: safeFilename(args.filename, `page-${Date.now()}.mhtml`) }
  }
  if (action === 'print_to_pdf') return debugOperation('print_to_pdf', args)
  throw error('UNSUPPORTED_ACTION', `Unsupported page action: ${action}`)
}
