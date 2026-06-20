const parseJson = async (response: Response) => {
  const body = await response.json().catch(() => ({})) as unknown
  return body != null && typeof body === 'object' ? body as Record<string, unknown> : {}
}

export class RequestJsonError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(message)
    this.name = 'RequestJsonError'
  }
}

export const requestJson = async <T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers
    }
  })
  const body = await parseJson(response)
  if (!response.ok) {
    const message = typeof body.error === 'string' && body.error.trim() !== ''
      ? body.error.trim()
      : `Request failed with ${response.status}.`
    throw new RequestJsonError(message, response.status, body)
  }
  return body as T
}
