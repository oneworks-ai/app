const operationTimeoutMs = 30_000

export const normalizeBrowserControlText = (value: unknown) => (
  typeof value === 'string' ? value.trim() : ''
)

export const readBrowserControlHttpUrl = (value: unknown) => {
  const target = new URL(normalizeBrowserControlText(value))
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw Object.assign(new Error('Only HTTP and HTTPS navigation is allowed.'), { code: 'URL_NOT_ALLOWED' })
  }
  return target
}

export const withBrowserControlTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs = operationTimeoutMs
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() =>
          reject(Object.assign(new Error('Browser operation timed out.'), {
            code: 'BROWSER_CONTROL_TIMEOUT',
            statusCode: 408
          })), timeoutMs)
      })
    ])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}
