import './AccountQuotaModal.scss'

import { Modal } from 'antd'
import type { MouseEvent, ReactElement } from 'react'
import { cloneElement, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdapterAccountQuotaInfo } from '@oneworks/types'

import { AccountQuotaPanel } from '#~/components/account-quota/AccountQuotaPanel'

export { AccountQuotaPanel as AccountQuotaModalBody } from '#~/components/account-quota/AccountQuotaPanel'

export function AccountQuotaModal({
  adapter,
  account,
  quota,
  trigger
}: {
  adapter?: string
  account?: string
  quota?: AdapterAccountQuotaInfo
  trigger: ReactElement<{ onClick?: (event: MouseEvent) => void }>
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {cloneElement(trigger, {
        onClick: (event) => {
          trigger.props.onClick?.(event)
          setOpen(true)
        }
      })}
      <AccountQuotaDialog
        open={open}
        adapter={adapter}
        account={account}
        quota={quota}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

export function AccountQuotaDialog({
  account,
  adapter,
  focusTriggerAfterClose,
  open,
  quota,
  onAfterClose,
  onClose
}: {
  account?: string
  adapter?: string
  focusTriggerAfterClose?: boolean
  open: boolean
  quota?: AdapterAccountQuotaInfo
  onAfterClose?: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <Modal
      open={open}
      title={t('chat.accountQuotaModal.title')}
      footer={null}
      centered
      destroyOnHidden
      focusTriggerAfterClose={focusTriggerAfterClose}
      className='account-quota-modal'
      afterClose={onAfterClose}
      onCancel={onClose}
    >
      <AccountQuotaPanel adapter={adapter} account={account} quota={quota} />
    </Modal>
  )
}
