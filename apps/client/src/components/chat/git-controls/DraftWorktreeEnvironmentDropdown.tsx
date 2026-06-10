import { Button, Dropdown, Empty } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { listWorktreeEnvironments } from '#~/api'
import { toDisplayEnvironmentName, toEnvironmentReference } from '#~/components/config/worktree-environment-panel-model'
import { OverlayAction, OverlayPanel } from '#~/components/overlay'
import { SenderMobileSelectDrawer } from '../sender/@components/mobile-select-drawer/SenderMobileSelectDrawer'

export function DraftWorktreeEnvironmentDropdown({
  compact = false,
  disabled = false,
  value,
  placement = 'topLeft',
  onChange
}: {
  compact?: boolean
  disabled?: boolean
  value?: string
  placement?: 'bottomLeft' | 'topLeft'
  onChange: (value?: string) => void
}) {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { data } = useSWR('worktree-environments', listWorktreeEnvironments, { revalidateOnFocus: false })
  const environments = data?.environments ?? []
  const selectedEnvironment = environments.find(environment => (
    toEnvironmentReference(environment) === value || environment.id === value
  ))
  const triggerLabel = selectedEnvironment != null
    ? toDisplayEnvironmentName(selectedEnvironment.id)
    : value != null && value !== ''
    ? toDisplayEnvironmentName(value)
    : t('chat.sessionWorkspaceEnvironmentDefault')
  const hasEnvironments = environments.length > 0
  const handleChange = useCallback((nextValue?: string) => {
    onChange(nextValue)
    setMobileOpen(false)
  }, [onChange])
  const menuRows = useMemo(() => {
    const rows = (
      <>
        <OverlayAction
          className={`chat-header-git__menu-row ${value == null || value === '' ? 'is-selected' : ''}`}
          disabled={disabled}
          onClick={() => handleChange(undefined)}
        >
          <span className='chat-header-git__menu-row-main'>
            <span className='chat-header-git__row-icon material-symbols-rounded'>settings_suggest</span>
            <span className='chat-header-git__menu-row-title'>
              {t('chat.sessionWorkspaceEnvironmentDefault')}
            </span>
          </span>
        </OverlayAction>

        {hasEnvironments
          ? environments.map((environment) => {
            const environmentReference = toEnvironmentReference(environment)
            const isActive = environmentReference === value || environment.id === value
            return (
              <OverlayAction
                key={`${environment.source}:${environment.id}`}
                className={`chat-header-git__menu-row ${isActive ? 'is-selected' : ''}`}
                disabled={disabled}
                title={environment.path}
                onClick={() => handleChange(environmentReference)}
              >
                <span className='chat-header-git__menu-row-main'>
                  <span className='chat-header-git__row-icon material-symbols-rounded'>
                    {environment.isLocal ? 'person' : 'folder'}
                  </span>
                  <span className='chat-header-git__menu-row-title'>
                    {toDisplayEnvironmentName(environment.id)}
                  </span>
                </span>
                <span className='chat-header-git__menu-row-trailing'>
                  <span className='chat-header-git__menu-row-value'>
                    {environment.isLocal
                      ? t('chat.sessionWorkspaceEnvironmentLocal')
                      : t('chat.sessionWorkspaceEnvironmentProject')}
                  </span>
                </span>
              </OverlayAction>
            )
          })
          : (
            <div className='chat-header-git__empty chat-header-git__empty--environment'>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('chat.sessionWorkspaceNoEnvironments')}
              />
            </div>
          )}
      </>
    )

    return compact
      ? (
        <div className='chat-header-git__overlay chat-header-git__overlay--environment'>
          {rows}
        </div>
      )
      : (
        <OverlayPanel className='chat-header-git__overlay chat-header-git__overlay--environment'>
          {rows}
        </OverlayPanel>
      )
  }, [compact, disabled, environments, handleChange, hasEnvironments, t, value])

  const triggerButton = (
    <Button
      type='text'
      disabled={disabled}
      className='chat-header-git__trigger chat-header-git__trigger--environment'
      title={selectedEnvironment?.path ?? triggerLabel}
      aria-label={t('chat.sessionWorkspaceEnvironment')}
      onClick={compact ? () => setMobileOpen(true) : undefined}
    >
      <span className='chat-header-git__trigger-main'>
        <span className='material-symbols-rounded'>deployed_code</span>
        <span className='chat-header-git__trigger-label'>{triggerLabel}</span>
      </span>
      <span className='chat-header-git__trigger-chevron material-symbols-rounded'>expand_more</span>
    </Button>
  )

  if (compact) {
    return (
      <>
        {triggerButton}
        <SenderMobileSelectDrawer
          open={mobileOpen}
          title={t('chat.sessionWorkspaceEnvironment')}
          className='chat-git-mobile-drawer'
          onClose={() => setMobileOpen(false)}
        >
          {menuRows}
        </SenderMobileSelectDrawer>
      </>
    )
  }

  return (
    <Dropdown
      placement={placement}
      overlayClassName='chat-header-git-dropdown'
      trigger={['click']}
      popupRender={() => menuRows}
    >
      {triggerButton}
    </Dropdown>
  )
}
