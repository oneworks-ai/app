import type { RelayLoginMethod } from './types'

const loginMethodStorageKey = 'oneworks.relay.login.method'

const loginMethods = new Set<RelayLoginMethod>(['passkey', 'password', 'verification_code'])

export const readLoginMethod = (): RelayLoginMethod | undefined => {
  try {
    const value = window.localStorage.getItem(loginMethodStorageKey)
    return loginMethods.has(value as RelayLoginMethod) ? value as RelayLoginMethod : undefined
  } catch {
    return undefined
  }
}

export const writeLoginMethod = (method: RelayLoginMethod) => {
  try {
    window.localStorage.setItem(loginMethodStorageKey, method)
  } catch {
    // Browser storage can be disabled; the selected login method still works for this visit.
  }
}
