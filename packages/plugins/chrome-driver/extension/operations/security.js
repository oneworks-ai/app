import { error } from './shared.js'

const storageKey = 'oneWorksExternalBrowserAdvancedAccess'
export const advancedAccessKeys = ['raw_debugger', 'cookie_values', 'sensitive_fields']

const emptyPolicy = () => ({
  raw_debugger: false,
  cookie_values: false,
  sensitive_fields: false,
  scope: 'browser_session'
})

const normalizeStoredPolicy = value => ({
  ...emptyPolicy(),
  ...Object.fromEntries(advancedAccessKeys.map(key => [key, value?.[key] === true])),
  updated_at: typeof value?.updated_at === 'string' ? value.updated_at : undefined
})

const effectivePolicy = stored => ({
  ...stored,
  cookie_values: stored.raw_debugger || stored.cookie_values,
  sensitive_fields: stored.raw_debugger || stored.sensitive_fields,
  raw_includes: ['cookie_values', 'sensitive_fields']
})

async function getStoredPolicy() {
  const stored = (await chrome.storage.session.get(storageKey))[storageKey]
  return normalizeStoredPolicy(stored)
}

export async function getAdvancedAccessPolicy() {
  return effectivePolicy(await getStoredPolicy())
}

export async function setAdvancedAccessPolicy(key, enabled) {
  if (!advancedAccessKeys.includes(key)) throw error('INVALID_ARGUMENT', `Unknown advanced access key: ${key}`)
  if (typeof enabled !== 'boolean') throw error('INVALID_ARGUMENT', 'Advanced access enabled must be a boolean.')
  const current = await getStoredPolicy()
  const next = { ...current, [key]: enabled, updated_at: new Date().toISOString() }
  await chrome.storage.session.set({ [storageKey]: next })
  return effectivePolicy(next)
}

export async function requireAdvancedAccess(key) {
  const policy = await getAdvancedAccessPolicy()
  if (policy[key] === true) return policy
  throw error('ADVANCED_ACCESS_DISABLED', 'This operation requires an explicit session-only advanced access switch.', {
    recoverable: true,
    advanced_access_key: key,
    user_action:
      'Enable the matching Advanced session access switch in oneWorks Settings or the extension popup, then retry.'
  })
}

export async function securityOperation(action, args) {
  if (action === 'get_policy') return getAdvancedAccessPolicy()
  if (action === 'set_policy') return setAdvancedAccessPolicy(args.key, args.enabled)
  throw error('UNSUPPORTED_ACTION', `Unsupported security action: ${action}`)
}
