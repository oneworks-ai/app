import type { ElectronWebviewElement } from './use-interaction-panel-webview'

const chiiTargetScriptId = 'oneworks-chii-target-script'
const chiiTargetDatasetKey = 'oneworksChiiTarget'
const chiiTargetIdDatasetKey = 'oneworksChiiTargetId'
const chiiTargetLoadTimeoutMs = 8_000
const chiiSessionTargetIdKey = 'chii-id'

export type ChiiInjectionResult = 'already-injected' | 'injected'

export interface ChiiInjectionOptions {
  force?: boolean
  targetId?: string
}

const isScriptElement = (element: Element | null): element is HTMLScriptElement => (
  element?.tagName.toLowerCase() === 'script'
)

const getMatchingChiiTargetScript = (scripts: HTMLScriptElement[], targetUrl: string, targetId?: string) => (
  scripts.find(script =>
    (script.src === targetUrl || script.dataset[chiiTargetDatasetKey] === targetUrl) &&
    (targetId == null || script.dataset[chiiTargetIdDatasetKey] === targetId)
  )
)

const resolveUrl = (value: string) => {
  try {
    return new URL(value, window.location.href)
  } catch {
    return null
  }
}

export const buildChiiScriptSnippet = (targetUrl: string) => (
  `<script src="${targetUrl}"></script>`
)

export const isSameOriginFrameUrl = (frameUrl: string) => {
  if (typeof window === 'undefined' || frameUrl.trim() === '') return false
  const url = resolveUrl(frameUrl)
  return url != null && url.origin === window.location.origin
}

export const injectChiiTargetScript = async (
  iframe: HTMLIFrameElement | null,
  targetUrl: string,
  options: ChiiInjectionOptions = {}
): Promise<ChiiInjectionResult> => {
  if (iframe == null) {
    throw new Error('iframe_unavailable')
  }

  let frameDocument: Document | null = null
  try {
    frameDocument = iframe.contentDocument
  } catch {
    throw new Error('iframe_cross_origin')
  }

  if (frameDocument == null) {
    throw new Error('iframe_document_unavailable')
  }

  const parent = frameDocument.head ?? frameDocument.documentElement
  if (parent == null) {
    throw new Error('iframe_document_unavailable')
  }

  const existingScripts = [...frameDocument.querySelectorAll(`#${chiiTargetScriptId}`)].filter(isScriptElement)
  const matchingScript = getMatchingChiiTargetScript(existingScripts, targetUrl, options.targetId)
  if (matchingScript != null && options.force !== true) {
    existingScripts.forEach(script => {
      if (script !== matchingScript) script.remove()
    })
    return 'already-injected'
  }
  existingScripts.forEach(script => script.remove())

  if (options.targetId != null && iframe.contentWindow != null) {
    try {
      iframe.contentWindow.sessionStorage.setItem(chiiSessionTargetIdKey, options.targetId)
    } catch {
      throw new Error('iframe_session_storage_unavailable')
    }
  }

  const script = frameDocument.createElement('script')
  script.id = chiiTargetScriptId
  script.async = true
  script.dataset[chiiTargetDatasetKey] = targetUrl
  if (options.targetId != null) {
    script.dataset[chiiTargetIdDatasetKey] = options.targetId
  }
  script.src = targetUrl

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('chii_target_load_timeout'))
    }, chiiTargetLoadTimeoutMs)
    const cleanup = () => {
      window.clearTimeout(timeout)
      script.removeEventListener('load', handleLoad)
      script.removeEventListener('error', handleError)
    }
    const handleLoad = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      script.remove()
      reject(new Error('chii_target_load_failed'))
    }

    script.addEventListener('load', handleLoad)
    script.addEventListener('error', handleError)
    parent.appendChild(script)
  })

  return 'injected'
}

const buildWebviewInjectionScript = (targetUrl: string, options: ChiiInjectionOptions = {}) => `
(() => {
  const scriptId = ${JSON.stringify(chiiTargetScriptId)};
  const datasetKey = ${JSON.stringify(chiiTargetDatasetKey)};
  const targetIdDatasetKey = ${JSON.stringify(chiiTargetIdDatasetKey)};
  const sessionTargetIdKey = ${JSON.stringify(chiiSessionTargetIdKey)};
  const targetUrl = ${JSON.stringify(targetUrl)};
  const force = ${JSON.stringify(options.force === true)};
  const targetId = ${JSON.stringify(options.targetId ?? null)};
  const parent = document.head || document.documentElement;
  if (!parent) return 'document-unavailable';

  const existingScripts = Array.from(document.querySelectorAll('script')).filter(script => script.id === scriptId);
  const matchingScript = existingScripts.find(script =>
    (script.src === targetUrl || script.dataset[datasetKey] === targetUrl) &&
    (targetId == null || script.dataset[targetIdDatasetKey] === targetId)
  );
  if (matchingScript && !force) {
    existingScripts.forEach(script => {
      if (script !== matchingScript) script.remove();
    });
    return 'already-injected';
  }
  existingScripts.forEach(script => script.remove());

  if (targetId != null) {
    window.sessionStorage.setItem(sessionTargetIdKey, targetId);
  }

  const script = document.createElement('script');
  script.id = scriptId;
  script.async = true;
  script.dataset[datasetKey] = targetUrl;
  if (targetId != null) script.dataset[targetIdDatasetKey] = targetId;
  script.src = targetUrl;
  parent.appendChild(script);
  return 'injected';
})()
`

export const injectChiiTargetScriptIntoWebview = async (
  webview: ElectronWebviewElement | null,
  targetUrl: string,
  options: ChiiInjectionOptions = {}
): Promise<ChiiInjectionResult> => {
  if (webview == null) {
    throw new Error('webview_unavailable')
  }

  const result = await webview.executeJavaScript(buildWebviewInjectionScript(targetUrl, options), false)
  if (result === 'already-injected' || result === 'injected') {
    return result
  }

  throw new Error(typeof result === 'string' ? result : 'webview_injection_failed')
}
