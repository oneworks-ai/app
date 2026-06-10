import { createApiUrl, fetchApiJson } from './base'

export interface WebpageMetadataResponse {
  faviconUrl?: string
  title?: string
  url: string
}

export async function readWebpageMetadata(
  url: string,
  requestOptions?: Pick<RequestInit, 'signal'>
): Promise<WebpageMetadataResponse> {
  const requestUrl = createApiUrl('/api/webpage/metadata')
  requestUrl.searchParams.set('url', url)
  return fetchApiJson<WebpageMetadataResponse>(requestUrl, requestOptions)
}
