import type { WebDebugTarget } from '#~/api/web-debug'

const normalizeUrlForCompare = (value: string | null | undefined, options: { ignoreHash?: boolean } = {}) => {
  if (value == null || value.trim() === '') return ''
  try {
    const url = new URL(value)
    if (options.ignoreHash === true) url.hash = ''
    return url.toString()
  } catch {
    return value.trim()
  }
}

const getTargetScore = (target: WebDebugTarget, frameUrl: string) => {
  const targetUrl = normalizeUrlForCompare(target.url)
  const comparableTargetUrl = normalizeUrlForCompare(target.url, { ignoreHash: true })
  const comparableFrameUrl = normalizeUrlForCompare(frameUrl, { ignoreHash: true })
  const exactFrameUrl = normalizeUrlForCompare(frameUrl)

  if (targetUrl !== '' && targetUrl === exactFrameUrl) return 4
  if (comparableTargetUrl !== '' && comparableTargetUrl === comparableFrameUrl) return 3

  try {
    const targetUrlObject = new URL(targetUrl)
    const frameUrlObject = new URL(exactFrameUrl)
    if (targetUrlObject.origin === frameUrlObject.origin && targetUrlObject.pathname === frameUrlObject.pathname) {
      return 2
    }
    if (targetUrlObject.origin === frameUrlObject.origin) return 1
  } catch {
    return 0
  }

  return 0
}

export const findWebDebugTargetForUrl = (targets: WebDebugTarget[], frameUrl: string) => {
  const scoredTargets = targets
    .map(target => ({ score: getTargetScore(target, frameUrl), target }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score)

  return scoredTargets[0]?.target
}

export const getWebDebugTargetTitle = (target: WebDebugTarget, fallback: string) => {
  const title = target.title?.trim()
  if (title != null && title !== '') return title

  const url = target.url?.trim()
  if (url == null || url === '') return fallback

  try {
    return new URL(url).hostname || fallback
  } catch {
    return url
  }
}
