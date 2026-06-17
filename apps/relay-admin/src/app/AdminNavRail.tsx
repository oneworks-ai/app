import { Avatar, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  HostNavRail,
  HostNavRailFooterButton,
  HostSidebarListHeader,
  HostSidebarQuickLinks,
  HostVibeIcon
} from '@oneworks/route-layout'
import type { HostNavRailResizeHandleProps, HostSidebarQuickLinkItem } from '@oneworks/route-layout'

import type { AdminSessionAccount } from '../features/auth/adminSessionStorage'
import type { RelayAdminCurrentUser } from '../shared/model/adminTypes'
import { AdminIcon } from '../shared/ui/AdminIcon'
import { useAdminTheme } from './AdminThemeProvider'

interface AdminNavMenuItem {
  key: string
  label: ReactNode
  disabled?: boolean
  children?: AdminNavMenuItem[]
  className?: string
  icon?: ReactNode
  popupClassName?: string
  selected?: boolean
  onSelect?: () => void
}

interface AdminNavMenuSection {
  items: AdminNavMenuItem[]
  key: string
  label?: ReactNode
}

export interface AdminNavRailProps {
  accounts?: AdminSessionAccount[]
  activeToken?: string
  currentUser?: RelayAdminCurrentUser
  drawerWidth?: number
  isCollapsed?: boolean
  isPreviewOpen?: boolean
  isResizing?: boolean
  items: HostSidebarQuickLinkItem[]
  loginUrl?: string
  resizeHandle?: HostNavRailResizeHandleProps
  onLogout?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onSelectAccount?: (token: string) => void
}

export const AdminNavRail = ({
  accounts = [],
  activeToken = '',
  currentUser,
  drawerWidth,
  isCollapsed = false,
  isPreviewOpen = false,
  isResizing = false,
  items,
  loginUrl = '/login',
  resizeHandle,
  onLogout,
  onPointerEnter,
  onPointerLeave,
  onSelectAccount
}: AdminNavRailProps) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { isDarkMode, setThemeMode, themeMode } = useAdminTheme()
  const [language, setLanguage] = useState('zh-CN')
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const menuIconMode = isDarkMode ? 'dark' : 'light'
  const themeOptions = useMemo(() => [
    {
      icon: 'desktop_windows' as const,
      key: 'system' as const,
      label: '跟随系统'
    },
    {
      icon: 'light_mode' as const,
      key: 'light' as const,
      label: '浅色模式'
    },
    {
      icon: 'dark_mode' as const,
      key: 'dark' as const,
      label: '深色模式'
    }
  ], [])
  const languageLabel = language === 'zh-CN' ? '中文' : 'English'
  const accountLabel = currentUser?.name.trim() || currentUser?.email || '账号'
  const visibleAccounts = useMemo<AdminSessionAccount[]>(() => {
    if (currentUser == null || activeToken === '') return accounts
    if (accounts.some(account => account.token === activeToken)) return accounts
    return [
      {
        savedAt: '',
        token: activeToken,
        user: currentUser
      },
      ...accounts
    ]
  }, [accounts, activeToken, currentUser])
  const activeAccount = visibleAccounts.find(account => account.token === activeToken)
  const currentUserAvatar = currentUser?.avatarUrl == null || currentUser.avatarUrl === ''
    ? activeAccount?.user.avatarUrl
    : currentUser.avatarUrl
  const currentUserAvatarNode = currentUser == null
    ? <AdminIcon name='account_circle' />
    : (
      <Avatar
        className='relay-admin-nav-account-avatar'
        icon={<AdminIcon name='person' />}
        size={16}
        src={currentUserAvatar == null || currentUserAvatar === '' ? undefined : currentUserAvatar}
      />
    )
  const activeAccountKey = useMemo(() => {
    const activeIndex = visibleAccounts.findIndex(account => account.token === activeToken)
    return activeIndex < 0
      ? undefined
      : `account:${visibleAccounts[activeIndex]?.user.id ?? activeIndex}:${activeIndex}`
  }, [activeToken, visibleAccounts])
  const openCurrentAccountProfile = useCallback(() => {
    if (currentUser == null) return
    void navigate('/profile')
    setAccountMenuOpen(false)
  }, [currentUser, navigate])
  const openMessageCenter = useCallback(() => {
    void navigate('/messages')
    setAccountMenuOpen(false)
  }, [navigate])
  const normalizedPathname = location.pathname.replace(/\/+$/u, '')
  const isMessageCenterActive = normalizedPathname === '/messages' || normalizedPathname.startsWith('/messages/')
  const accountMenuItems = useMemo<MenuProps['items']>(() => {
    const accountItems = visibleAccounts.length === 0
      ? [{
        disabled: true,
        icon: <AdminIcon name='account_circle' />,
        key: 'account:empty',
        label: '暂无账号'
      }]
      : visibleAccounts.map((account, index) => {
        const name = account.user.name.trim() || account.user.email
        const isActive = account.token === activeToken
        const avatarUrl = account.user.avatarUrl == null || account.user.avatarUrl === ''
          ? undefined
          : account.user.avatarUrl
        return {
          className: 'relay-admin-account-menu-item',
          icon: (
            <Avatar
              className='relay-admin-nav-account-avatar relay-admin-nav-account-avatar--menu'
              icon={<AdminIcon name='person' />}
              size={20}
              src={avatarUrl}
            />
          ),
          key: `account:${account.user.id}:${index}`,
          label: (
            <span className='relay-admin-account-menu-label'>
              <span className='relay-admin-account-menu-name'>{name}</span>
              <span className='relay-admin-account-menu-meta'>{account.user.email} · {account.user.role}</span>
            </span>
          ),
          onClick: () => {
            if (isActive) {
              void navigate('/profile')
              setAccountMenuOpen(false)
              return
            }
            onSelectAccount?.(account.token)
            setAccountMenuOpen(false)
          }
        }
      })

    return [
      ...accountItems,
      {
        key: 'account:divider',
        type: 'divider' as const
      },
      {
        disabled: currentUser == null,
        icon: <AdminIcon name='person' />,
        key: 'account:detail',
        label: '个人资料',
        onClick: openCurrentAccountProfile
      },
      {
        disabled: currentUser == null,
        icon: <AdminIcon name='notifications' />,
        key: 'account:messages',
        label: '消息中心',
        onClick: openMessageCenter
      },
      {
        icon: <AdminIcon name='login' />,
        key: 'account:login',
        label: '登录其他账号',
        onClick: () => {
          window.location.assign(loginUrl)
          setAccountMenuOpen(false)
        }
      },
      {
        disabled: activeToken === '',
        icon: <AdminIcon name='logout' />,
        key: 'account:logout',
        label: '退出登录',
        onClick: () => {
          onLogout?.()
          setAccountMenuOpen(false)
        }
      }
    ]
  }, [
    activeToken,
    currentUser,
    loginUrl,
    navigate,
    onLogout,
    onSelectAccount,
    openMessageCenter,
    openCurrentAccountProfile,
    visibleAccounts
  ])
  const menuSections = useMemo<AdminNavMenuSection[]>(() => [
    {
      items: [
        {
          className: 'relay-admin-nav-menu-theme-item',
          key: 'theme-mode',
          label: (
            <div className='relay-admin-nav-menu-theme-block'>
              <span className='relay-admin-nav-menu-theme-main'>
                <AdminIcon className='relay-admin-nav-menu-theme-leading-icon' name='dark_mode' />
                <span className='relay-admin-nav-menu-theme-title'>主题模式</span>
              </span>
              <div className='relay-admin-nav-menu-theme-switch' role='radiogroup' aria-label='主题模式'>
                {themeOptions.map(option => (
                  <button
                    type='button'
                    key={option.key}
                    className={[
                      'relay-admin-nav-menu-theme-button',
                      themeMode === option.key ? 'is-active' : ''
                    ].filter(Boolean).join(' ')}
                    role='radio'
                    aria-checked={themeMode === option.key}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      setThemeMode(option.key)
                    }}
                    aria-label={option.label}
                    title={option.label}
                  >
                    <AdminIcon className='relay-admin-nav-menu-theme-button__icon' name={option.icon} />
                    <span className='relay-admin-nav-menu-theme-button__label'>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        },
        {
          children: [
            {
              icon: <AdminIcon name={language === 'zh-CN' ? 'check' : 'language'} />,
              key: 'language:zh-CN',
              label: '中文',
              selected: language === 'zh-CN',
              onSelect: () => setLanguage('zh-CN')
            },
            {
              icon: <AdminIcon name={language === 'en-US' ? 'check' : 'language'} />,
              key: 'language:en-US',
              label: 'English',
              selected: language === 'en-US',
              onSelect: () => setLanguage('en-US')
            }
          ],
          icon: <AdminIcon name='language' />,
          key: 'language',
          label: (
            <span className='relay-admin-nav-menu-language-label'>
              <span className='relay-admin-nav-menu-language-title'>语言</span>
              <span className='relay-admin-nav-menu-language-current'>{languageLabel}</span>
            </span>
          ),
          popupClassName: 'relay-admin-nav-submenu-dropdown'
        }
      ],
      key: 'preferences'
    }
  ], [language, languageLabel, themeMode, themeOptions])
  const menuItems = useMemo<MenuProps['items']>(() => {
    const toMenuItem = (item: AdminNavMenuItem): NonNullable<MenuProps['items']>[number] => ({
      children: item.children?.map(toMenuItem),
      className: item.className,
      disabled: item.disabled,
      icon: item.icon,
      key: item.key,
      label: item.label,
      popupClassName: item.popupClassName,
      onClick: item.children == null
        ? () => {
          if (item.disabled === true) return
          item.onSelect?.()
          setMenuOpen(false)
        }
        : undefined
    })
    const visibleSections = menuSections.filter(section => section.items.length > 0)

    return visibleSections.flatMap((section, index) => {
      const items = section.items.map(toMenuItem)

      if (index === 0) return items

      return [
        {
          key: `${section.key}:divider`,
          type: 'divider' as const
        },
        ...items
      ]
    })
  }, [menuSections])
  const menuSelectedKeys = useMemo(
    () =>
      menuSections.flatMap(section =>
        section.items.flatMap(item =>
          item.children == null
            ? item.selected === true ? [item.key] : []
            : item.children.filter(child => child.selected === true).map(child => child.key)
        )
      ),
    [menuSections]
  )
  const expandIcon = (
    <span className='relay-admin-icon relay-admin-nav-menu-submenu-chevron' aria-hidden='true'>
      ›
    </span>
  )

  return (
    <HostNavRail
      drawerWidth={drawerWidth}
      isCollapsed={isCollapsed}
      isPreviewOpen={isPreviewOpen}
      isResizing={isResizing}
      resizeHandle={resizeHandle}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      footerMenu={
        <div className='relay-admin-nav-footer-actions'>
          <div className='relay-admin-nav-account-footer-row'>
            <Dropdown
              destroyOnHidden
              overlayClassName='relay-admin-nav-menu-dropdown relay-admin-account-menu-dropdown'
              open={accountMenuOpen}
              placement='topLeft'
              trigger={['click']}
              onOpenChange={setAccountMenuOpen}
              menu={{
                items: accountMenuItems,
                selectedKeys: activeAccountKey == null ? [] : [activeAccountKey]
              }}
            >
              <HostNavRailFooterButton
                active={accountMenuOpen}
                aria-expanded={accountMenuOpen}
                aria-haspopup='menu'
                icon={currentUserAvatarNode}
                label={accountLabel}
                title={accountLabel}
              />
            </Dropdown>
            <button
              type='button'
              aria-label='消息中心'
              className={[
                'relay-admin-nav-message-button',
                isMessageCenterActive ? 'is-active' : ''
              ].filter(Boolean).join(' ')}
              disabled={currentUser == null}
              title='消息中心'
              onClick={openMessageCenter}
            >
              <AdminIcon name='notifications' />
            </button>
          </div>
          <Dropdown
            destroyOnHidden
            overlayClassName='relay-admin-nav-menu-dropdown'
            open={menuOpen}
            placement='topLeft'
            trigger={['click']}
            onOpenChange={setMenuOpen}
            menu={{
              expandIcon,
              items: menuItems,
              selectedKeys: menuSelectedKeys,
              triggerSubMenuAction: 'click'
            }}
          >
            <HostNavRailFooterButton
              active={menuOpen}
              aria-expanded={menuOpen}
              aria-haspopup='menu'
              icon={<HostVibeIcon mode={menuIconMode} title='菜单' />}
              label='菜单'
            />
          </Dropdown>
        </div>
      }
    >
      <div className='sidebar-container sidebar-container--nav-embedded relay-admin-nav-sidebar-container'>
        <div className='sidebar-content'>
          <HostSidebarListHeader className='sidebar-header relay-admin-nav-sidebar-header'>
            <HostSidebarQuickLinks
              ariaLabel='认证管理'
              className='relay-admin-nav-quick-links'
              items={items}
            />
          </HostSidebarListHeader>
        </div>
      </div>
    </HostNavRail>
  )
}
