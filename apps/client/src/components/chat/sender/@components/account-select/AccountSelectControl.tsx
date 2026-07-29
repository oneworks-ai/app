/* eslint-disable max-lines -- account selector keeps control, menu actions, and connect flow together. */
import '../sender-toolbar/SenderSelectShared.scss'
import '../sender-toolbar/SenderSelectBase.scss'
import './AccountSelectControl.scss'
import './AccountSelectDropdown.scss'

import { App, Button, Modal, Tooltip } from 'antd'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useSWRConfig } from 'swr'

import { getApiErrorMessage, manageAdapterAccount } from '#~/api'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { OverlayAction, OverlayDivider } from '#~/components/overlay'
import type { ChatAdapterAccountOption } from '#~/hooks/chat/use-chat-adapter-account-selection'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

import type { SenderToolbarData, SenderToolbarHandlers, SenderToolbarState } from '../../@types/sender-toolbar-types'
import {
  SenderMobileSelectDrawer,
  handleSenderMobileSelectOptionKeyDown
} from '../mobile-select-drawer/SenderMobileSelectDrawer'
import { AccountAvatar } from './AccountAvatar'
import { AccountQuotaIndicators } from './AccountQuotaIndicators'
import { AccountQuotaDialog } from './AccountQuotaModal'

interface AccountQuotaDialogTarget {
  adapter?: string
  option: ChatAdapterAccountOption
}

interface PendingAccountQuotaDialog extends AccountQuotaDialogTarget {
  source: 'desktop' | 'mobile'
  token: number
}

const renderSelectArrow = (onMouseDown: (event: ReactMouseEvent<HTMLSpanElement>) => void) => (
  <span className='material-symbols-rounded sender-select-arrow' onMouseDown={onMouseDown}>
    keyboard_arrow_down
  </span>
)

const getAccountPopupContainer = (triggerNode: HTMLElement) => (
  triggerNode.closest<HTMLElement>('.chat-status-bar__account-group') ??
    triggerNode.parentElement ??
    document.body
)

export function AccountSelectControl({
  state,
  data,
  handlers
}: {
  state: Pick<
    SenderToolbarState,
    'isThinking' | 'modelUnavailable' | 'selectedAccount' | 'selectedAdapter' | 'showAccountSelector'
  >
  data: Pick<SenderToolbarData, 'accountOptions'>
  handlers: Pick<SenderToolbarHandlers, 'onAccountChange'>
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { mutate } = useSWRConfig()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const { isThinking, modelUnavailable, selectedAccount, selectedAdapter, showAccountSelector } = state
  const { accountOptions } = data
  const [showAccountSelect, setShowAccountSelectState] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [cancelingCreateAccount, setCancelingCreateAccount] = useState(false)
  const [mobileDrawerMotionInstance, setMobileDrawerMotionInstance] = useState(0)
  const [pendingQuotaDialog, setPendingQuotaDialogState] = useState<PendingAccountQuotaDialog>()
  const [quotaDialog, setQuotaDialog] = useState<AccountQuotaDialogTarget>()
  const [quotaDialogOpen, setQuotaDialogOpenState] = useState(false)
  const accountTriggerRef = useRef<HTMLButtonElement>(null)
  const createAccountAbortRef = useRef<AbortController | null>(null)
  const pendingQuotaDialogRef = useRef<PendingAccountQuotaDialog>()
  const quotaDialogOpenRef = useRef(false)
  const quotaHandoffTokenRef = useRef(0)
  const showAccountSelectRef = useRef(false)
  const suppressNextCompactTriggerFocusRef = useRef(false)
  const isCompactControl = isCompactLayout || isTouchInteraction

  const selectedOption = useMemo(
    () => accountOptions?.find(option => option.value === selectedAccount),
    [accountOptions, selectedAccount]
  )
  const isDisabled = modelUnavailable || isThinking

  const setPendingQuotaDialog = useCallback((pending: PendingAccountQuotaDialog | undefined) => {
    pendingQuotaDialogRef.current = pending
    setPendingQuotaDialogState(pending)
  }, [])

  const setQuotaDialogOpen = useCallback((open: boolean) => {
    quotaDialogOpenRef.current = open
    setQuotaDialogOpenState(open)
  }, [])

  const cancelPendingQuotaDialog = useCallback(() => {
    quotaHandoffTokenRef.current += 1
    suppressNextCompactTriggerFocusRef.current = false
    setPendingQuotaDialog(undefined)
  }, [setPendingQuotaDialog])

  const setAccountSelectOpen = useCallback((open: boolean) => {
    showAccountSelectRef.current = open
    if (open) {
      if (pendingQuotaDialogRef.current?.source === 'mobile') {
        // Remount the motion owner so an interrupted leave cannot finish under a newer handoff token.
        setMobileDrawerMotionInstance(instance => instance + 1)
      }
      cancelPendingQuotaDialog()
    }
    setShowAccountSelectState(open)
  }, [cancelPendingQuotaDialog])

  const completeQuotaDialogHandoff = useCallback((
    source: PendingAccountQuotaDialog['source'],
    token: number | string | undefined
  ) => {
    const pending = pendingQuotaDialogRef.current
    if (
      typeof token !== 'number' ||
      pending == null ||
      pending.source !== source ||
      pending.token !== token ||
      showAccountSelectRef.current
    ) {
      return
    }

    setPendingQuotaDialog(undefined)
    setQuotaDialog({
      adapter: pending.adapter,
      option: pending.option
    })
    setQuotaDialogOpen(true)
  }, [setPendingQuotaDialog, setQuotaDialogOpen])

  const handleDesktopPopupCloseComplete = useCallback((closeRequestKey: number | string | undefined) => {
    completeQuotaDialogHandoff('desktop', closeRequestKey)
  }, [completeQuotaDialogHandoff])

  const handleMobileDrawerAfterOpenChange = useCallback((
    open: boolean,
    closeRequestKey: number | string | undefined
  ) => {
    if (!open) {
      completeQuotaDialogHandoff('mobile', closeRequestKey)
    }
  }, [completeQuotaDialogHandoff])

  const handleQuotaDialogAfterClose = useCallback(() => {
    setQuotaDialog(undefined)
    const trigger = accountTriggerRef.current
    if (trigger == null) {
      return
    }

    suppressNextCompactTriggerFocusRef.current = isCompactControl
    const wasFocused = document.activeElement === trigger
    trigger.focus({ preventScroll: true })
    if (wasFocused || document.activeElement !== trigger) {
      suppressNextCompactTriggerFocusRef.current = false
    }
  }, [isCompactControl])

  useEffect(() => {
    const pending = pendingQuotaDialogRef.current
    const expectedSource = isCompactControl ? 'mobile' : 'desktop'
    if (pending != null && pending.source !== expectedSource) {
      cancelPendingQuotaDialog()
    }
  }, [cancelPendingQuotaDialog, isCompactControl])

  if (!showAccountSelector || accountOptions == null || accountOptions.length === 0) {
    return null
  }

  const openAdapterConfig = () => {
    if (selectedAdapter == null || selectedAdapter.trim() === '') {
      return
    }

    setAccountSelectOpen(false)
    void navigate(
      `/config/adapters/${encodeURIComponent(selectedAdapter)}/accounts?source=user`
    )
  }

  const createAccount = () => {
    if (selectedAdapter == null || selectedAdapter.trim() === '') {
      return
    }

    setAccountSelectOpen(false)
    const abortController = new AbortController()
    createAccountAbortRef.current = abortController
    setCreatingAccount(true)
    setCancelingCreateAccount(false)

    void (async () => {
      try {
        const result = await manageAdapterAccount(
          selectedAdapter,
          { action: 'add' },
          { signal: abortController.signal }
        )

        await mutate((key) => (
          Array.isArray(key) &&
          key[0] === '/api/adapters' &&
          key[1] === selectedAdapter
        ))

        if (result.accountKey != null && result.accountKey.trim() !== '') {
          handlers.onAccountChange?.(result.accountKey)
        }

        void message.success(result.message ?? t('config.accounts.actionSuccess.add'))
      } catch (error) {
        if (abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          void message.info(t('chat.accountSelectCreateCanceled'))
          return
        }

        void message.error(getApiErrorMessage(error, t('config.accounts.actionFailed.add')))
      } finally {
        if (createAccountAbortRef.current === abortController) {
          createAccountAbortRef.current = null
        }
        setCreatingAccount(false)
        setCancelingCreateAccount(false)
      }
    })()
  }

  const cancelCreateAccount = () => {
    const controller = createAccountAbortRef.current
    if (controller == null || controller.signal.aborted) {
      return
    }

    setCancelingCreateAccount(true)
    controller.abort()
  }

  const openAccountConfig = (accountKey: string) => {
    if (selectedAdapter == null || selectedAdapter.trim() === '') {
      return
    }

    setAccountSelectOpen(false)
    void navigate(
      `/config/adapters/${encodeURIComponent(selectedAdapter)}/accounts/${encodeURIComponent(accountKey)}?source=user`
    )
  }

  const handleAccountSelection = (value: string) => {
    handlers.onAccountChange?.(value)
    setAccountSelectOpen(false)
  }

  const openCompactAccountSelect = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      !isCompactControl ||
      isDisabled ||
      showAccountSelect ||
      pendingQuotaDialogRef.current != null ||
      quotaDialogOpenRef.current
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setAccountSelectOpen(true)
  }

  const openAccountQuota = (option: ChatAdapterAccountOption) => {
    const token = quotaHandoffTokenRef.current + 1
    quotaHandoffTokenRef.current = token
    const source = isCompactControl ? 'mobile' : 'desktop'
    if (source === 'mobile') {
      suppressNextCompactTriggerFocusRef.current = true
    }
    setPendingQuotaDialog({
      adapter: selectedAdapter,
      option,
      source,
      token
    })
    setAccountSelectOpen(false)
  }

  const renderOption = (option: ChatAdapterAccountOption) => (
    <div className='account-option'>
      <AccountAvatar option={option} />
      <div className='account-option__body'>
        <span className='account-option__title'>{option.label}</span>
        {option.meta != null && option.meta !== '' && (
          <div className='account-option__meta'>{option.meta}</div>
        )}
      </div>
      {option.quotaWindows != null && option.quotaWindows.length > 0 && (
        <div className='account-option__quota'>
          <AccountQuotaIndicators
            adapter={selectedAdapter}
            account={option.value}
            onRequestOpen={() => openAccountQuota(option)}
            quota={option.quota}
            windows={option.quotaWindows}
          />
        </div>
      )}
      <div className='account-option__actions'>
        <Tooltip
          title={t('chat.accountSelectOpenAccountConfig', { account: option.label })}
          placement='left'
        >
          <button
            type='button'
            className='account-option__action'
            aria-label={t('chat.accountSelectOpenAccountConfig', { account: option.label })}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openAccountConfig(option.value)
            }}
          >
            <span className='material-symbols-rounded'>settings</span>
          </button>
        </Tooltip>
      </div>
    </div>
  )

  const renderPopup = (originNode: ReactNode) => (
    <>
      {originNode}
      {selectedAdapter != null && selectedAdapter.trim() !== '' && (
        <div className='account-select-popup__footer'>
          <OverlayDivider className='account-select-popup__footer-divider' decorative />
          <OverlayAction
            className='account-select-popup__footer-action'
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={createAccount}
          >
            <span className='material-symbols-rounded'>person_add</span>
            <span>{t('chat.accountSelectCreateAccount', { adapter: selectedAdapter })}</span>
          </OverlayAction>
          <OverlayAction
            className='account-select-popup__footer-action'
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={openAdapterConfig}
          >
            <span className='material-symbols-rounded'>settings</span>
            <span>{t('chat.accountSelectOpenAdapterConfig', { adapter: selectedAdapter })}</span>
          </OverlayAction>
        </div>
      )}
    </>
  )

  return (
    <>
      {isCompactControl
        ? (
          <div
            className={[
              'sender-select-shell',
              'sender-select-shell--account',
              'sender-select-shell--compact',
              showAccountSelect ? 'is-open' : '',
              isDisabled ? 'is-disabled' : ''
            ].filter(Boolean).join(' ')}
            onPointerDownCapture={openCompactAccountSelect}
          >
            <button
              ref={accountTriggerRef}
              type='button'
              className='account-select account-select--responsive sender-responsive-select-button sender-responsive-select-button--account'
              aria-label={selectedOption?.label ?? t('chat.accountSelectPlaceholder')}
              disabled={isDisabled}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setAccountSelectOpen(true)
              }}
              onFocus={() => {
                if (suppressNextCompactTriggerFocusRef.current) {
                  suppressNextCompactTriggerFocusRef.current = false
                  return
                }
                if (pendingQuotaDialogRef.current != null || quotaDialogOpenRef.current) {
                  return
                }
                setAccountSelectOpen(true)
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setAccountSelectOpen(true)
              }}
            >
              {selectedOption == null
                ? (
                  <span className='material-symbols-rounded sender-responsive-select-button__icon'>
                    switch_account
                  </span>
                )
                : <AccountAvatar option={selectedOption} size='control' />}
              <span className='sender-responsive-select-button__label'>
                {selectedOption?.label ?? t('chat.accountSelectPlaceholder')}
              </span>
              <span className='material-symbols-rounded sender-responsive-select-button__chevron'>
                keyboard_arrow_down
              </span>
            </button>
            <SenderMobileSelectDrawer
              open={showAccountSelect}
              title={t('chat.accountSelectPlaceholder')}
              className='account-mobile-select-drawer'
              closeRequestKey={pendingQuotaDialog?.source === 'mobile' ? pendingQuotaDialog.token : undefined}
              motionInstanceKey={mobileDrawerMotionInstance}
              onAfterOpenChange={handleMobileDrawerAfterOpenChange}
              onClose={() => setAccountSelectOpen(false)}
            >
              <div className='sender-mobile-select-list' role='listbox'>
                {accountOptions.map(option => (
                  <div
                    key={option.value}
                    role='option'
                    tabIndex={0}
                    aria-selected={selectedAccount === option.value}
                    className={[
                      'sender-mobile-select-option',
                      'account-mobile-select-option',
                      selectedAccount === option.value ? 'is-selected' : ''
                    ].filter(Boolean).join(' ')}
                    onClick={() => handleAccountSelection(option.value)}
                    onKeyDown={(event) =>
                      handleSenderMobileSelectOptionKeyDown(event, () => handleAccountSelection(option.value))}
                  >
                    <span className='sender-mobile-select-option__content'>
                      {renderOption(option)}
                    </span>
                    {selectedAccount === option.value && (
                      <span className='material-symbols-rounded sender-mobile-select-option__check'>check</span>
                    )}
                  </div>
                ))}
              </div>
              {selectedAdapter != null && selectedAdapter.trim() !== '' && (
                <div className='sender-mobile-select-actions'>
                  <button
                    type='button'
                    className='account-select-popup__footer-action'
                    onClick={createAccount}
                  >
                    <span className='material-symbols-rounded'>person_add</span>
                    <span>{t('chat.accountSelectCreateAccount', { adapter: selectedAdapter })}</span>
                  </button>
                  <button
                    type='button'
                    className='account-select-popup__footer-action'
                    onClick={openAdapterConfig}
                  >
                    <span className='material-symbols-rounded'>settings</span>
                    <span>{t('chat.accountSelectOpenAdapterConfig', { adapter: selectedAdapter })}</span>
                  </button>
                </div>
              )}
            </SenderMobileSelectDrawer>
          </div>
        )
        : (
          <Select
            className='account-select'
            classNames={{ popup: { root: 'account-select-popup' } }}
            controlTrigger={{
              ariaLabel: selectedOption?.label ?? t('chat.accountSelectPlaceholder'),
              className: 'sender-select-body-trigger',
              ref: accountTriggerRef,
              stopPropagation: true,
              wrapperClassName: 'sender-select-shell sender-select-shell--account'
            }}
            open={showAccountSelect}
            popupCloseKey={pendingQuotaDialog?.source === 'desktop' ? pendingQuotaDialog.token : undefined}
            value={selectedAccount}
            options={accountOptions}
            disabled={isDisabled}
            onChange={handleAccountSelection}
            onOpenChange={setAccountSelectOpen}
            onPopupCloseComplete={handleDesktopPopupCloseComplete}
            optionRender={(option) => renderOption(option.data as ChatAdapterAccountOption)}
            optionLabelProp='label'
            placeholder={t('chat.accountSelectPlaceholder')}
            prefix={selectedOption == null ? undefined : <AccountAvatar option={selectedOption} size='control' />}
            getPopupContainer={getAccountPopupContainer}
            popupMatchSelectWidth={false}
            popupRender={renderPopup}
            suffixIcon={renderSelectArrow((event) => {
              event.preventDefault()
              event.stopPropagation()
              setAccountSelectOpen(!showAccountSelectRef.current)
            })}
          />
        )}
      <AccountQuotaDialog
        open={quotaDialogOpen}
        adapter={quotaDialog?.adapter}
        account={quotaDialog?.option.value}
        focusTriggerAfterClose={false}
        quota={quotaDialog?.option.quota}
        onAfterClose={handleQuotaDialogAfterClose}
        onClose={() => setQuotaDialogOpen(false)}
      />
      <Modal
        open={creatingAccount}
        centered
        maskClosable={false}
        keyboard={false}
        closable={false}
        title={t('chat.accountSelectCreateTitle', { adapter: selectedAdapter ?? 'adapter' })}
        footer={[
          <Button
            key='cancel'
            danger
            disabled={cancelingCreateAccount}
            onClick={cancelCreateAccount}
          >
            {cancelingCreateAccount ? t('chat.accountSelectCreateCanceling') : t('common.cancel')}
          </Button>
        ]}
      >
        <div className='account-select-create-modal'>
          <span className='material-symbols-rounded account-select-create-modal__icon'>
            pending_actions
          </span>
          <div className='account-select-create-modal__title'>
            {t('chat.accountSelectCreateWaiting')}
          </div>
          <div className='account-select-create-modal__description'>
            {t('chat.accountSelectCreateDescription', { adapter: selectedAdapter ?? 'adapter' })}
          </div>
        </div>
      </Modal>
    </>
  )
}
