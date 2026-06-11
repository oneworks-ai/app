import { Avatar, Button, List, Typography } from 'antd'

import { providerIcon } from './LoginProviderIcon'
import { accountFallback } from './accountStorage'
import type { RelayLoginProviderConfig, RelayRememberedAccount } from './types'

export const RememberedAccountsSection = ({
  accounts,
  onSelect,
  title
}: {
  accounts: RelayRememberedAccount[]
  onSelect: (account: RelayRememberedAccount) => void
  title: string
}) => (
  <section className='relay-login-app__section relay-login-app__section--accounts'>
    <Typography.Text className='relay-login-app__section-title'>{title}</Typography.Text>
    <List
      className='relay-login-app__account-list'
      dataSource={accounts}
      renderItem={account => (
        <List.Item>
          <Button
            block
            className='relay-login-app__account-button'
            type='text'
            onClick={() => onSelect(account)}
          >
            <Avatar src={account.avatarUrl || undefined}>{accountFallback(account)}</Avatar>
            <span className='relay-login-app__account-copy'>
              <strong>{account.name || account.email}</strong>
              <small>{account.provider} · {account.email}</small>
            </span>
          </Button>
        </List.Item>
      )}
    />
  </section>
)

export const ProviderButtonsSection = ({
  onSelect,
  providers,
  title
}: {
  onSelect: (provider: RelayLoginProviderConfig) => void
  providers: RelayLoginProviderConfig[]
  title: string
}) => (
  <section className='relay-login-app__section'>
    <Typography.Text className='relay-login-app__section-title'>{title}</Typography.Text>
    <div className='relay-login-app__provider-list'>
      {providers.map(provider => (
        <Button
          key={provider.id}
          block
          className='relay-login-app__provider-button'
          data-provider-icon={provider.icon}
          data-provider-id={provider.id}
          icon={providerIcon(provider)}
          size='large'
          type='default'
          onClick={() => onSelect(provider)}
        >
          {provider.label}
        </Button>
      ))}
    </div>
  </section>
)
