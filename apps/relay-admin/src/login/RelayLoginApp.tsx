import { Form } from 'antd'
import type { InputRef } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { RelayCredentialForm } from './RelayCredentialForm'
import type { LoginFormValues } from './RelayCredentialForm'
import { ProviderButtonsSection, RememberedAccountsSection } from './RelayLoginSections'
import { RelayPasskeyPanel } from './RelayPasskeyPanel'
import { isRecord, readAccounts, readStringField, writeAccounts } from './accountStorage'
import type { RelayLoginConfig, RelayLoginProviderConfig, RelayRememberedAccount } from './types'

export const RelayLoginApp = ({ config }: { config: RelayLoginConfig }) => {
  const [form] = Form.useForm<LoginFormValues>()
  const passwordRef = useRef<InputRef>(null)
  const [accounts, setAccounts] = useState<RelayRememberedAccount[]>(() => readAccounts())
  const [passkeyEmailHint, setPasskeyEmailHint] = useState('')
  const providerById = useMemo(
    () => new Map(config.providers.map(provider => [provider.id, provider])),
    [config.providers]
  )

  const rememberAccount = Form.useWatch('rememberAccount', form) !== false

  const storeAccount = useCallback((account: RelayRememberedAccount) => {
    setAccounts(current => {
      const next = [
        account,
        ...current.filter(item => (
          item.provider !== account.provider || item.email !== account.email
        ))
      ]
      writeAccounts(next)
      return next.slice(0, 12)
    })
  }, [])

  useEffect(() => {
    window.__relayLoginRedirectUri = config.redirectUri
    window.__relayLoginStoreAccount = storeAccount
    return () => {
      if (window.__relayLoginStoreAccount === storeAccount) {
        delete window.__relayLoginStoreAccount
      }
    }
  }, [config.redirectUri, storeAccount])

  const finishWithToken = useCallback((token: string, user: unknown, authProvider = 'password') => {
    if (isRecord(user) && rememberAccount) {
      const email = readStringField(user, 'email')
      const name = readStringField(user, 'name') || email
      storeAccount({
        avatarUrl: readStringField(user, 'avatarUrl'),
        email,
        name,
        provider: authProvider,
        updatedAt: new Date().toISOString()
      })
    }
    const target = new URL(config.redirectUri, window.location.origin)
    target.hash = new URLSearchParams({ relay_token: token }).toString()
    window.location.replace(target.toString())
  }, [config.redirectUri, rememberAccount, storeAccount])

  const startProviderLogin = useCallback((provider: RelayLoginProviderConfig, email: string) => {
    const url = new URL(provider.startUrl, window.location.origin)
    const completeUrl = new URL(url.searchParams.get('redirect_uri') ?? '', window.location.origin)
    completeUrl.searchParams.set('remember_account', rememberAccount ? '1' : '0')
    url.searchParams.set('redirect_uri', completeUrl.toString())
    if (email !== '') {
      url.searchParams.set('login_hint', email)
    } else {
      url.searchParams.set('prompt', 'select_account')
    }
    window.location.href = url.toString()
  }, [rememberAccount])

  const startAccountLogin = useCallback((account: RelayRememberedAccount) => {
    if (account.provider === 'passkey') {
      setPasskeyEmailHint(account.email)
      return
    }
    if (account.provider === 'invite' || account.provider === 'password') {
      form.setFieldsValue({ email: account.email })
      passwordRef.current?.focus()
      return
    }
    const provider = providerById.get(account.provider)
    if (provider != null) startProviderLogin(provider, account.email)
  }, [form, providerById, startProviderLogin])

  return (
    <main className='relay-login relay-login-app' data-login-page>
      <section className='relay-login__layout relay-login-app__layout' aria-label='OneWorks Relay'>
        {accounts.length > 0
          ? (
            <RememberedAccountsSection
              accounts={accounts}
              title={config.messages.recentAccounts}
              onSelect={startAccountLogin}
            />
          )
          : null}

        <RelayPasskeyPanel
          config={config}
          emailHint={passkeyEmailHint}
          finishWithToken={finishWithToken}
        />

        <RelayCredentialForm
          config={config}
          finishWithToken={finishWithToken}
          form={form}
          passwordRef={passwordRef}
        />

        {config.providers.length > 0
          ? (
            <ProviderButtonsSection
              providers={config.providers}
              title={config.messages.signInWithSso}
              onSelect={provider => startProviderLogin(provider, '')}
            />
          )
          : null}
      </section>
    </main>
  )
}
