import { Form, Input, Modal } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import type { RegistryFormValues } from './skill-hub-utils'

interface SkillRegistryModalProps {
  open: boolean
  saving: boolean
  form: FormInstance<RegistryFormValues>
  onSave: () => void
  onClose: () => void
}

export function SkillRegistryModal({
  open,
  saving,
  form,
  onSave,
  onClose
}: SkillRegistryModalProps) {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('knowledge.skills.addRegistry')}
      open={open}
      confirmLoading={saving}
      okText={t('config.actions.save')}
      cancelText={t('config.actions.cancel')}
      onOk={onSave}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form
        form={form}
        layout='vertical'
        initialValues={{ configSource: 'project' }}
        className='knowledge-base-view__registry-form'
      >
        <Form.Item
          name='configSource'
          label={t('knowledge.skills.registryConfigSource')}
          rules={[{ required: true }]}
        >
          <Select
            options={[
              { label: '~/.oneworks/.oo.config.json', value: 'global' },
              { label: '.oo.config.json', value: 'project' },
              { label: '.oo.dev.config.json', value: 'user' }
            ]}
          />
        </Form.Item>
        <Form.Item
          name='title'
          label={t('knowledge.skills.registryTitle')}
        >
          <Input placeholder={t('knowledge.skills.registryTitlePlaceholder')} />
        </Form.Item>
        <Form.Item
          name='source'
          label={t('knowledge.skills.registrySource')}
          rules={[{ required: true, message: t('knowledge.skills.registrySourceRequired') }]}
        >
          <Input placeholder={t('knowledge.skills.registrySourcePlaceholder')} />
        </Form.Item>
        <Form.Item
          name='registry'
          label={t('knowledge.skills.registryValue')}
        >
          <Input placeholder={t('knowledge.skills.registryValuePlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
