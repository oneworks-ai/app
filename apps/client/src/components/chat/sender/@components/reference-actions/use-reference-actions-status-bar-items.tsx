import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { OverlayMenuItem } from '#~/components/overlay'

import type { SenderToolbarData, SenderToolbarState } from '../../@types/sender-toolbar-types'

const accountMenuKeyPrefix = 'status-account:'
const adapterMenuKeyPrefix = 'status-adapter:'

const getAdapterOptionTitle = (
  option: NonNullable<SenderToolbarData['adapterOptions']>[number]
) => option.searchText.replace(`${option.value} `, '').trim() || option.value

export function useReferenceActionsStatusBarItems({
  accountOptions,
  adapterLocked,
  adapterOptions,
  hiddenBuiltinAdapterOptions,
  isInlineEdit,
  isThinking,
  modelUnavailable,
  selectedAccount,
  selectedAdapter,
  showAccountSelector,
  showStatusBarControlsInMore
}:
  & Pick<
    SenderToolbarState,
    | 'adapterLocked'
    | 'isInlineEdit'
    | 'isThinking'
    | 'modelUnavailable'
    | 'selectedAccount'
    | 'selectedAdapter'
    | 'showAccountSelector'
  >
  & Pick<SenderToolbarData, 'accountOptions' | 'adapterOptions' | 'hiddenBuiltinAdapterOptions'>
  & {
    showStatusBarControlsInMore: boolean
  })
{
  const { t } = useTranslation()

  return useMemo(() => {
    if (!showStatusBarControlsInMore || isInlineEdit) {
      return { items: [], selectedKeys: [] }
    }

    const availableAccountOptions = accountOptions ?? []
    const availableAdapterOptions = adapterOptions ?? []
    const hiddenAdapterOptions = hiddenBuiltinAdapterOptions ?? []
    const selectedAccountOption = availableAccountOptions.find(option => option.value === selectedAccount)
    const selectedAdapterOption = availableAdapterOptions.find(option => option.value === selectedAdapter)
    const canShowAccount = showAccountSelector && availableAccountOptions.length > 0
    const canShowAdapter = availableAdapterOptions.length > 1 || hiddenAdapterOptions.length > 0
    const accountDisabled = modelUnavailable || isThinking
    const adapterDisabled = adapterLocked || modelUnavailable || isThinking
    const items: OverlayMenuItem[] = []
    const selectedKeys: string[] = []

    if (canShowAccount) {
      if (selectedAccount != null) selectedKeys.push(`${accountMenuKeyPrefix}${selectedAccount}`)
      items.push({
        key: 'status-account',
        label: t('chat.accountSelectPlaceholder'),
        icon: 'switch_account',
        disabled: accountDisabled,
        trailing: selectedAccountOption == null
          ? undefined
          : <span className='reference-actions-menu-current'>{selectedAccountOption.label}</span>,
        children: availableAccountOptions.map(option => ({
          key: `${accountMenuKeyPrefix}${option.value}`,
          label: option.label,
          description: option.meta,
          icon: selectedAccount === option.value ? 'check' : 'person',
          selected: selectedAccount === option.value
        }))
      })
    }

    if (canShowAdapter) {
      if (selectedAdapter != null) selectedKeys.push(`${adapterMenuKeyPrefix}${selectedAdapter}`)
      items.push({
        key: 'status-adapter',
        label: t('chat.adapterSelectPlaceholder'),
        icon: 'deployed_code',
        disabled: adapterDisabled,
        trailing: selectedAdapterOption == null
          ? undefined
          : <span className='reference-actions-menu-current'>{getAdapterOptionTitle(selectedAdapterOption)}</span>,
        children: [
          ...availableAdapterOptions.map(option => ({
            key: `${adapterMenuKeyPrefix}${option.value}`,
            label: option.displayLabel,
            selected: selectedAdapter === option.value
          })),
          ...(hiddenAdapterOptions.length > 0
            ? [
              { key: 'status-adapter-hidden-divider', type: 'divider' as const },
              {
                key: 'status-adapter-hidden',
                label: t('chat.adapterHiddenBuiltinTitle'),
                icon: 'visibility_off',
                children: hiddenAdapterOptions.map(option => ({
                  key: `status-adapter-hidden:${option.value}`,
                  label: option.title,
                  icon: option.iconUrl == null
                    ? <span className='material-symbols-rounded'>{option.fallbackIcon}</span>
                    : <img src={option.iconUrl} alt='' aria-hidden='true' />,
                  onSelect: option.onRestore
                })) ?? []
              }
            ]
            : [])
        ]
      })
    }

    return { items, selectedKeys }
  }, [
    accountOptions,
    adapterLocked,
    adapterOptions,
    hiddenBuiltinAdapterOptions,
    isInlineEdit,
    isThinking,
    modelUnavailable,
    selectedAccount,
    selectedAdapter,
    showAccountSelector,
    showStatusBarControlsInMore,
    t
  ])
}

export const isReferenceActionsStatusAccountItem = (key: string) => key.startsWith(accountMenuKeyPrefix)
export const isReferenceActionsStatusAdapterItem = (key: string) => key.startsWith(adapterMenuKeyPrefix)
export const getReferenceActionsStatusValue = (key: string) => key.slice(key.indexOf(':') + 1)
