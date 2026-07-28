import process from 'node:process'

import { ChromeExtensionBridge } from './bridge.js'
import type { AdvancedAccessKey } from './bridge.js'
import type { WebsitePermissionMode } from './site-permissions.js'
import type { ChromePluginContext } from './types.js'

const emptyObjectSchema = { type: 'object', additionalProperties: false }
const statusOutputSchema = {
  type: 'object',
  required: ['protocol_version', 'connected', 'pending_confirmations', 'recent_audit'],
  properties: {
    protocol_version: { type: 'number' },
    connected: { type: 'boolean' },
    connection: { type: ['object', 'null'] },
    pending_confirmations: { type: 'array' },
    recent_audit: { type: 'array' }
  },
  additionalProperties: true
}

export async function activatePlugin(ctx: ChromePluginContext) {
  const bridge = new ChromeExtensionBridge({
    logger: ctx.logger,
    projectHome: ctx.projectHome,
    runtimeRole: process.env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager' ? 'manager' : 'workspace',
    workspaceFolder: ctx.workspaceFolder
  })

  ctx.registerLocalService('chrome-extension-bridge', () =>
    bridge.start().then(() => ({
      dispose: () => bridge.dispose()
    })))

  ctx.registerCommand('status', () => bridge.status())
  ctx.registerCommand('create-pairing-offer', (payload: unknown) => {
    const value = payload as Record<string, unknown> | undefined
    const origin = value != null && typeof value.origin === 'string' ? value.origin : ''
    const extensionId = value != null && typeof value.extension_id === 'string' ? value.extension_id : ''
    const pairingNonce = value != null && typeof value.pairing_nonce === 'string' ? value.pairing_nonce : ''
    if (origin === '') throw new Error('The current OneWorks origin is required for Chrome pairing.')
    return bridge.createPairingOffer(origin, extensionId, pairingNonce)
  })
  ctx.registerCommand('approve-confirmation', (payload: unknown) => {
    const value = payload as Record<string, unknown> | undefined
    const confirmationId = value != null && typeof value.confirmation_id === 'string'
      ? value.confirmation_id
      : ''
    return bridge.approveConfirmation(confirmationId)
  })
  ctx.registerCommand('deny-confirmation', (payload: unknown) => {
    const value = payload as Record<string, unknown> | undefined
    const confirmationId = value != null && typeof value.confirmation_id === 'string'
      ? value.confirmation_id
      : ''
    return bridge.denyConfirmation(confirmationId)
  })
  ctx.registerCommand('list-web-frames', (payload: unknown) => {
    const value = payload as Record<string, unknown> | undefined
    const tabId = value != null && Number.isInteger(value.tab_id) ? Number(value.tab_id) : undefined
    if (tabId == null) throw new Error('A paired OneWorks Chrome tab id is required.')
    return bridge.executeFromUi('frames.list', { tab_id: tabId }, `tab:${tabId}`)
  })
  ctx.registerCommand('get-advanced-access', () => bridge.getConfiguredAdvancedAccess())
  ctx.registerCommand('set-advanced-access', (payload: unknown) => {
    const value = payload as Record<string, unknown> | undefined
    const key = value != null && typeof value.key === 'string' ? value.key : ''
    const enabled = value?.enabled
    if (!['raw_debugger', 'cookie_values', 'sensitive_fields'].includes(key) || typeof enabled !== 'boolean') {
      throw new Error('A known advanced access key and boolean enabled value are required.')
    }
    return bridge.setConfiguredAdvancedAccess(key as AdvancedAccessKey, enabled)
  })
  ctx.registerCommand('get-site-permissions', () => bridge.getWebsitePermissions())
  ctx.registerCommand('add-site-permission', (payload: unknown) => {
    const value = payload as Record<string, unknown> | undefined
    const pattern = value != null && typeof value.pattern === 'string' ? value.pattern : ''
    const mode = value != null && typeof value.mode === 'string' ? value.mode : ''
    return bridge.addWebsitePermission(pattern, mode as WebsitePermissionMode)
  })
  ctx.registerCommand('set-site-permission', (payload: unknown) => {
    const value = payload as Record<string, unknown> | undefined
    const ruleId = value != null && typeof value.rule_id === 'string' ? value.rule_id : ''
    const mode = value != null && typeof value.mode === 'string' ? value.mode : ''
    return bridge.setWebsitePermission(ruleId, mode as WebsitePermissionMode)
  })
  ctx.registerCommand('remove-site-permission', (payload: unknown) => {
    const value = payload as Record<string, unknown> | undefined
    const ruleId = value != null && typeof value.rule_id === 'string' ? value.rule_id : ''
    return bridge.removeWebsitePermission(ruleId)
  })

  ctx.registerApi('status', {
    title: { en: 'Chrome bridge status', 'zh-Hans': 'Chrome 桥接状态' },
    description: {
      en: 'Returns redacted connection, permission, confirmation, and audit status.',
      'zh-Hans': '返回脱敏后的连接、权限、确认和审计状态。'
    },
    inputSchema: emptyObjectSchema,
    outputSchema: statusOutputSchema,
    headerSchema: emptyObjectSchema,
    handler: () => ({
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: bridge.status()
    })
  })
}
