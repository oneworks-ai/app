import { Input, Modal } from 'antd'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'

import type { TranslationFn } from '../configUtils'

export const ChannelCreateModal = ({
  canSubmit,
  kind,
  kindOptions,
  name,
  onCancel,
  onKindChange,
  onNameChange,
  onSubmit,
  open,
  t
}: {
  canSubmit: boolean
  kind: string
  kindOptions: Array<{ label: string; value: string }>
  name: string
  onCancel: () => void
  onKindChange: (kind: string) => void
  onNameChange: (name: string) => void
  onSubmit: () => void
  open: boolean
  t: TranslationFn
}) => (
  <Modal
    open={open}
    title={t('config.channels.add')}
    okText={t('common.confirm')}
    cancelText={t('common.cancel')}
    okButtonProps={{ disabled: !canSubmit }}
    onCancel={onCancel}
    onOk={onSubmit}
  >
    <div className='channel-collection__create-fields'>
      <Input
        autoFocus
        value={name}
        placeholder={t('config.editor.newChannelName')}
        onChange={event => onNameChange(event.target.value)}
        onPressEnter={onSubmit}
      />
      <Select
        value={kind}
        options={kindOptions}
        placeholder={t('config.channels.typePlaceholder')}
        onChange={onKindChange}
      />
    </div>
  </Modal>
)
