import { Button, Checkbox, Form, Input, Select } from 'antd'

import type { CreateSsoProviderInput, RelayAdminSsoProviderType } from '../../shared/model/adminTypes'
import { SsoProviderCallbackHint } from './SsoProviderCallbackHint'
import { getSsoProviderPreset, ssoProviderPresets } from './ssoProviderPresets'

export interface SsoProviderCreateFormProps {
  disabled: boolean
  onCreateProvider: (input: CreateSsoProviderInput) => Promise<void>
  onCreated?: () => void
}

interface SsoProviderCreateFormValues {
  authorizationUrl: string
  clientId: string
  clientSecret: string
  enabled: boolean
  id: string
  name: string
  preset?: string
  scope?: string
  tokenUrl: string
  type: RelayAdminSsoProviderType
  userInfoUrl: string
}

const defaultSsoCreateValues: Partial<SsoProviderCreateFormValues> = {
  enabled: true,
  scope: 'openid email profile',
  type: 'oidc'
}

export const SsoProviderCreateForm = ({ disabled, onCreated, onCreateProvider }: SsoProviderCreateFormProps) => {
  const [form] = Form.useForm<SsoProviderCreateFormValues>()
  const providerId = Form.useWatch('id', form) ?? ''

  const handlePresetChange = (presetId: string) => {
    const preset = getSsoProviderPreset(presetId)
    if (preset == null) return
    form.setFieldsValue(preset.values)
  }

  const handleCreate = async (values: SsoProviderCreateFormValues) => {
    const input: CreateSsoProviderInput = {
      authorizationUrl: values.authorizationUrl.trim(),
      clientId: values.clientId.trim(),
      clientSecret: values.clientSecret.trim(),
      enabled: values.enabled,
      id: values.id.trim().toLowerCase(),
      name: values.name.trim(),
      scope: values.scope?.trim() || 'openid email profile',
      tokenUrl: values.tokenUrl.trim(),
      type: values.type,
      userInfoUrl: values.userInfoUrl.trim()
    }
    await onCreateProvider(input)
    form.resetFields()
    onCreated?.()
  }

  return (
    <Form
      form={form}
      layout='vertical'
      initialValues={defaultSsoCreateValues}
      onFinish={handleCreate}
    >
      <Form.Item label='预设' name='preset'>
        <Select
          disabled={disabled}
          onChange={handlePresetChange}
          options={[
            { label: '自定义', value: '' },
            ...ssoProviderPresets.map(preset => ({ label: preset.label, value: preset.id }))
          ]}
        />
      </Form.Item>
      <Form.Item label='Provider ID' name='id' rules={[{ required: true }]}>
        <Input disabled={disabled} placeholder='provider-id' />
      </Form.Item>
      <Form.Item label='名称' name='name' rules={[{ required: true }]}>
        <Input disabled={disabled} placeholder='Provider 名称' />
      </Form.Item>
      <Form.Item label='类型' name='type' rules={[{ required: true }]}>
        <Select
          disabled={disabled}
          options={[
            { label: 'oidc', value: 'oidc' },
            { label: 'oauth2', value: 'oauth2' }
          ]}
        />
      </Form.Item>
      <Form.Item label='Client ID' name='clientId' rules={[{ required: true }]}>
        <Input disabled={disabled} />
      </Form.Item>
      <Form.Item label='Client Secret' name='clientSecret' rules={[{ required: true }]}>
        <Input.Password autoComplete='new-password' disabled={disabled} />
      </Form.Item>
      <Form.Item label='Authorization URL' name='authorizationUrl' rules={[{ required: true, type: 'url' }]}>
        <Input disabled={disabled} />
      </Form.Item>
      <Form.Item label='Token URL' name='tokenUrl' rules={[{ required: true, type: 'url' }]}>
        <Input disabled={disabled} />
      </Form.Item>
      <Form.Item label='User info URL' name='userInfoUrl' rules={[{ required: true, type: 'url' }]}>
        <Input disabled={disabled} />
      </Form.Item>
      <Form.Item label='Scope' name='scope'>
        <Input disabled={disabled} />
      </Form.Item>
      <Form.Item name='enabled' valuePropName='checked'>
        <Checkbox disabled={disabled}>启用</Checkbox>
      </Form.Item>
      <SsoProviderCallbackHint providerId={providerId} />
      <Button block disabled={disabled} htmlType='submit' type='primary'>
        创建 SSO
      </Button>
    </Form>
  )
}
