import { Button, Form, Input, Modal, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { toCanonicalAssetSlug } from '@oneworks/utils/asset-slug'

import { getAssetPreview } from '#~/api.js'
import type { AssetDestinationPreview, CreatableAssetKind } from '#~/api.js'

export interface CreateAssetFormValues {
  description?: string
  name: string
  params?: Array<{ description?: string; name?: string }>
}

export interface CreateAssetModalProps {
  form: FormInstance<CreateAssetFormValues>
  kind: CreatableAssetKind
  open: boolean
  saving: boolean
  onClose: () => void
  onSave: () => void
}

export function CreateAssetModal({
  form,
  kind,
  open,
  saving,
  onClose,
  onSave
}: CreateAssetModalProps) {
  const { t } = useTranslation()
  const name = Form.useWatch('name', form) ?? ''
  const slug = toCanonicalAssetSlug(name)
  const { data: previewResult, error: previewError } = useSWR<{ asset: AssetDestinationPreview }>(
    !open || slug == null ? null : ['asset-preview', kind, name],
    () => getAssetPreview(kind, name)
  )
  const preview = slug == null
    ? t('knowledge.assets.locationPending')
    : previewError == null
    ? previewResult?.asset.path ?? t('knowledge.assets.locationResolving')
    : t('knowledge.assets.locationUnavailable')

  return (
    <Modal
      title={t(`knowledge.assets.${kind}.title`)}
      open={open}
      confirmLoading={saving}
      closable={!saving}
      keyboard={!saving}
      maskClosable={!saving}
      okText={t('config.actions.save')}
      cancelText={t('config.actions.cancel')}
      cancelButtonProps={{ disabled: saving }}
      afterOpenChange={visible => {
        if (visible) form.focusField('name')
      }}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form
        form={form}
        layout='vertical'
        className='knowledge-base-view__create-asset-form'
        onFinish={onSave}
      >
        <Form.Item
          name='name'
          label={t('knowledge.assets.name')}
          rules={[{ required: true, message: t('knowledge.assets.nameRequired') }]}
        >
          <Input
            autoFocus
            placeholder={t('knowledge.assets.namePlaceholder')}
            maxLength={120}
            onPressEnter={event => {
              if (event.nativeEvent.isComposing) return
              event.preventDefault()
              form.submit()
            }}
          />
        </Form.Item>
        <Form.Item name='description' label={t('knowledge.assets.description')}>
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={2000}
            placeholder={t('knowledge.assets.descriptionPlaceholder')}
          />
        </Form.Item>
        {kind === 'spec' && (
          <Form.List name='params'>
            {(fields, { add, remove }) => (
              <div className='knowledge-base-view__asset-params'>
                <div className='knowledge-base-view__asset-params-heading'>
                  <Typography.Text>{t('knowledge.assets.params')}</Typography.Text>
                  <Button type='link' aria-label={t('knowledge.assets.addParam')} onClick={() => add()}>
                    {t('knowledge.assets.addParam')}
                  </Button>
                </div>
                {fields.map((field, index) => {
                  const { key, ...fieldProps } = field
                  return (
                    <div className='knowledge-base-view__asset-param-row' key={key}>
                      <Form.Item
                        {...fieldProps}
                        name={[field.name, 'name']}
                        label={t('knowledge.assets.paramName', { index: index + 1 })}
                        rules={[{ required: true, message: t('knowledge.assets.paramNameRequired') }]}
                      >
                        <Input
                          aria-label={t('knowledge.assets.paramName', { index: index + 1 })}
                          maxLength={80}
                        />
                      </Form.Item>
                      <Form.Item
                        {...fieldProps}
                        name={[field.name, 'description']}
                        label={t('knowledge.assets.paramDescription', { index: index + 1 })}
                      >
                        <Input
                          aria-label={t('knowledge.assets.paramDescription', { index: index + 1 })}
                          maxLength={500}
                        />
                      </Form.Item>
                      <Form.Item
                        noStyle
                        shouldUpdate={(previous, next) => (
                          previous.params?.[field.name]?.name !== next.params?.[field.name]?.name
                        )}
                      >
                        {() => {
                          const paramName = form.getFieldValue(['params', field.name, 'name']) || `${index + 1}`
                          return (
                            <Button
                              aria-label={t('knowledge.assets.removeParam', { name: paramName })}
                              danger
                              type='text'
                              onClick={() => remove(field.name)}
                            >
                              <span className='material-symbols-rounded' aria-hidden='true'>delete</span>
                            </Button>
                          )
                        }}
                      </Form.Item>
                    </div>
                  )
                })}
              </div>
            )}
          </Form.List>
        )}
        <Form.Item label={t('knowledge.assets.location')}>
          <Typography.Text code aria-live='polite'>{preview}</Typography.Text>
        </Form.Item>
      </Form>
    </Modal>
  )
}
