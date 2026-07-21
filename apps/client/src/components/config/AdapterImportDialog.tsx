import { Form, Modal } from 'antd'

import { AdapterImportSelect } from './AdapterImportRow'
import type { AdapterImportAction } from './AdapterImportRow'

export function AdapterImportDialog({
  action,
  cancelLabel,
  open,
  title,
  onClose
}: {
  action: AdapterImportAction
  cancelLabel: string
  open: boolean
  title: string
  onClose: () => void
}) {
  const handleImport = () => {
    if (
      action.disabled === true ||
      action.loading === true ||
      action.optionsLoading === true ||
      action.onClick == null
    ) return

    onClose()
    action.onClick()
  }

  return (
    <Modal
      centered
      destroyOnHidden
      className='config-view__adapter-import-dialog'
      cancelText={cancelLabel}
      confirmLoading={action.loading}
      okButtonProps={{
        disabled: action.disabled === true || action.optionsLoading === true || action.onClick == null
      }}
      okText={action.buttonLabel}
      open={open}
      title={title}
      width={480}
      onCancel={onClose}
      onOk={handleImport}
    >
      <Form layout='vertical'>
        <Form.Item label={action.selectLabel}>
          <AdapterImportSelect action={action} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
