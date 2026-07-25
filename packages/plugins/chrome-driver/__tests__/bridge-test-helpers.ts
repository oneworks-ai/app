import { createHash } from 'node:crypto'

import type { ChromeExtensionBridge } from '../server/src/bridge.js'
import { CHROME_EXTENSION_ID, EXECUTION_TARGET_GUARD_CAPABILITY } from '../server/src/bridge.js'

export type AdvancedAccessInput = Partial<
  Record<'cookie_values' | 'raw_debugger' | 'sensitive_fields', boolean>
>

const extensionOrigin = `chrome-extension://${CHROME_EXTENSION_ID}`

export const guardedExtensionCapabilities = (capabilities: Record<string, unknown> = {}) => ({
  ...capabilities,
  execution_target_guard: EXECUTION_TARGET_GUARD_CAPABILITY
})

export const extensionPost = (bridge: ChromeExtensionBridge, token: string, path: string, body = {}) =>
  fetch(new URL(path, bridge.url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: extensionOrigin },
    body: JSON.stringify(
      path === '/v1/extensions/ack' &&
        typeof (body as { result?: { url?: unknown } }).result?.url === 'string' &&
        (body as { result?: { url_sha256?: unknown } }).result?.url_sha256 == null
        ? {
          ...body,
          result: {
            ...(body as { result: Record<string, unknown> }).result,
            url_sha256: createHash('sha256')
              .update(new URL((body as { result: { url: string } }).result.url).toString())
              .digest('hex')
          }
        }
        : body
    )
  }).then(response => response.json()) as Promise<any>

export const drainAdvancedAccessSync = async (
  bridge: ChromeExtensionBridge,
  token: string,
  configured: AdvancedAccessInput = {}
) => {
  const raw = configured.raw_debugger === true
  const policy = {
    cookie_values: raw || configured.cookie_values === true,
    raw_debugger: raw,
    sensitive_fields: raw || configured.sensitive_fields === true
  }
  for (let index = 0; index < 3; index += 1) {
    const poll = await extensionPost(bridge, token, '/v1/extensions/poll')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: poll.result.command.command_id,
      ok: true,
      result: policy
    })
  }
}
