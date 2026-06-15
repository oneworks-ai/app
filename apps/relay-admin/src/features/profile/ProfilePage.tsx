import './ProfilePage.css'

import { Avatar, Descriptions, Empty } from 'antd'
import type { DescriptionsProps } from 'antd'

import type { RelayAdminCurrentUser } from '../../shared/model/adminTypes'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import type { AdminSessionAccount } from '../auth/adminSessionStorage'

export interface ProfilePageProps {
  accounts: AdminSessionAccount[]
  activeToken: string
  currentUser?: RelayAdminCurrentUser
}

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

const userDisplayName = (user: RelayAdminCurrentUser) => user.name.trim() || user.email

export const ProfilePage = ({
  accounts,
  activeToken,
  currentUser
}: ProfilePageProps) => {
  if (currentUser == null) {
    return (
      <section className='relay-profile-panel'>
        <Empty className='relay-profile__empty' description='未登录账号' />
      </section>
    )
  }

  const rememberedAccount = accounts.find(account => account.token === activeToken)
  const avatarUrl = currentUser.avatarUrl == null || currentUser.avatarUrl === ''
    ? rememberedAccount?.user.avatarUrl ?? undefined
    : currentUser.avatarUrl
  const provider = currentUser.provider == null || currentUser.provider === '' ? 'local' : currentUser.provider
  const descriptionItems: DescriptionsProps['items'] = [
    {
      children: currentUser.email,
      key: 'email',
      label: '邮箱'
    },
    {
      children: currentUser.name === '' ? '-' : currentUser.name,
      key: 'name',
      label: '名称'
    },
    {
      children: currentUser.loginId == null || currentUser.loginId === '' ? currentUser.email : currentUser.loginId,
      key: 'loginId',
      label: '登录 ID'
    },
    {
      children: currentUser.disabledAt == null ? 'active' : 'disabled',
      key: 'status',
      label: '状态'
    },
    {
      children: currentUser.role,
      key: 'role',
      label: '权限'
    },
    {
      children: provider,
      key: 'provider',
      label: '登录方式'
    },
    {
      children: currentUser.id,
      key: 'id',
      label: '账号 ID'
    },
    {
      children: formatTimestamp(rememberedAccount?.savedAt),
      key: 'savedAt',
      label: '本机记住时间'
    }
  ]

  return (
    <section className='relay-profile-panel'>
      <div className='relay-profile'>
        <div className='relay-profile__hero'>
          <Avatar
            className='relay-profile__avatar'
            icon={<AdminIcon name='person' />}
            size={60}
            src={avatarUrl}
          />
          <div className='relay-profile__identity'>
            <span className='relay-profile__eyebrow'>当前账号</span>
            <h2>{userDisplayName(currentUser)}</h2>
            <p>{currentUser.email}</p>
          </div>
        </div>

        <Descriptions
          bordered
          className='relay-profile__descriptions'
          column={{ lg: 2, md: 1, sm: 1, xl: 2, xs: 1, xxl: 2 }}
          items={descriptionItems}
          size='small'
        />
      </div>
    </section>
  )
}
