import { safeJson } from './login-page-script-utils.js'

export const completePageScript = (
  redirectUri: string,
  messages: {
    inviteRequired: string
    loginFailedTitle: string
    tokenMissing: string
  }
) => `
(() => {
  const title = document.querySelector('[data-complete-title]')
  const status = document.querySelector('[data-complete-status]')
  const storageKey = 'oneWorks.relayLogin.accounts:' + location.origin
  const setStatus = value => {
    if (status) status.textContent = value
  }
  const setFailure = value => {
    if (title) title.textContent = ${safeJson(messages.loginFailedTitle)}
    setStatus(value === 'Invite required.' ? ${safeJson(messages.inviteRequired)} : value)
  }
  const storeAccount = account => {
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) || '[]')
      const accounts = Array.isArray(current) ? current : []
      const next = [account, ...accounts.filter(item => (
        item.provider !== account.provider || item.email !== account.email
      ))]
      localStorage.setItem(storageKey, JSON.stringify(next.slice(0, 12)))
    } catch {
      // Browser storage can be disabled; the login callback still continues.
    }
    if (window.opener && !window.opener.closed && typeof window.opener.__relayLoginStoreAccount === 'function') {
      window.opener.__relayLoginStoreAccount(account)
    }
  }
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''))
  const search = new URLSearchParams(location.search)
  const shouldRememberAccount = search.get('remember_account') !== '0'
  const error = fragment.get('relay_error') || search.get('relay_error') || ''
  const token = fragment.get('relay_token') || search.get('relay_token') || ''
  if (error) {
    setFailure(error)
    return
  }
  if (!token) {
    setFailure(${safeJson(messages.tokenMissing)})
    return
  }
  const target = new URL(${safeJson(redirectUri)}, location.origin)
  target.hash = new URLSearchParams({ relay_token: token }).toString()
  fetch('/api/auth/me', {
    headers: { authorization: 'Bearer ' + token }
  })
    .then(response => response.ok ? response.json() : null)
    .then(body => {
      const user = body && body.user
      if (user && shouldRememberAccount) {
        storeAccount({
          avatarUrl: user.avatarUrl || '',
          email: user.email || '',
          name: user.name || user.email || '',
          provider: user.provider || '',
          updatedAt: new Date().toISOString()
        })
      }
      location.replace(target.toString())
    })
    .catch(() => {
      location.replace(target.toString())
    })
})()`
