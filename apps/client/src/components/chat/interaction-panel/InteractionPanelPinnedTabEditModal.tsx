import { Input, Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InteractionPanelPinnedTab } from './interaction-panel-pinned-tabs'

export function InteractionPanelPinnedTabEditModal({
  pinnedTab,
  onClose,
  onSave
}: {
  pinnedTab: InteractionPanelPinnedTab | null
  onClose: () => void
  onSave: (edits: { customIcon?: string; customTitle?: string }) => void
}) {
  const { t } = useTranslation()
  const [customTitle, setCustomTitle] = useState('')
  const [customIcon, setCustomIcon] = useState('')

  useEffect(() => {
    setCustomTitle(pinnedTab?.customTitle ?? '')
    setCustomIcon(pinnedTab?.customIcon ?? '')
  }, [pinnedTab])

  return (
    <Modal
      open={pinnedTab != null}
      title={t('chat.interactionPanel.editPinnedTab')}
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}
      className='chat-interaction-panel-pinned-edit-modal'
      onCancel={onClose}
      onOk={() => {
        onSave({ customIcon, customTitle })
      }}
    >
      <div className='chat-interaction-panel-pinned-edit'>
        <label className='chat-interaction-panel-pinned-edit__field'>
          <span>{t('chat.interactionPanel.pinnedTabTitle')}</span>
          <Input
            value={customTitle}
            placeholder={pinnedTab?.originalTitle}
            onChange={event => setCustomTitle(event.target.value)}
          />
        </label>
        <label className='chat-interaction-panel-pinned-edit__field'>
          <span>{t('chat.interactionPanel.pinnedTabIcon')}</span>
          <Input
            value={customIcon}
            placeholder={pinnedTab?.originalIcon}
            prefix={<span className='material-symbols-rounded'>interests</span>}
            onChange={event => setCustomIcon(event.target.value)}
          />
        </label>
        <div className='chat-interaction-panel-pinned-edit__hint'>
          {t('chat.interactionPanel.pinnedTabEditHint')}
        </div>
      </div>
    </Modal>
  )
}
