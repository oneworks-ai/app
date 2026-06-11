import { Button, Checkbox, Form, Input, Select, Space } from 'antd'

import type {
  RelayAdminSsoProvider,
  RelayAdminSsoProviderType,
  UpdateSsoProviderInput
} from '../../shared/model/adminTypes'
import { SsoProviderCallbackHint } from './SsoProviderCallbackHint'

export interface SsoProviderEditFormProps {
  disabled: boolean
  onCancel: () => void
  onUpdateProvider: (input: UpdateSsoProviderInput) => Promise<void>
  provider: RelayAdminSsoProvider
}

interface SsoProviderEditFormValues {
  authorizationUrl: string
  clientId: string
  clientSecret?: string
  enabled: boolean
  name: string
  scope?: string
  tokenUrl: string
  type: RelayAdminSsoProviderType
  userInfoUrl: string
}

export const SsoProviderEditForm = ({
  disabled,
  onCancel,
  onUpdateProvider,
  provider
}: SsoProviderEditFormProps) => {
  const handleUpdate = async (values: SsoProviderEditFormValues) => {
    const clientSecret = values.clientSecret?.trim() ?? ''
    const input: UpdateSsoProviderInput = {
      authorizationUrl: values.authorizationUrl.trim(),
      clientId: values.clientId.trim(),
      enabled: values.enabled,
      id: provider.id,
      name: values.name.trim(),
      scope: values.scope?.trim() || 'openid email profile',
      tokenUrl: values.tokenUrl.trim(),
      type: values.type,
      userInfoUrl: values.userInfoUrl.trim(),
      ...(clientSecret === '' ? {} : { clientSecret })
    }
    await onUpdateProvider(input)
    onCancel()
  }

  return (
    <Form
      layout='vertical'
      initialValues={{
        authorizationUrl: provider.authorizationUrl,
        clientId: provider.clientId,
        enabled: provider.enabled,
        name: provider.name,
        scope: provider.scope,
        tokenUrl: provider.tokenUrl,
        type: provider.type,
        userInfoUrl: provider.userInfoUrl
      }}
      onFinish={handleUpdate}
    >
      <Form.Item label='Provider ID'>
        <Input disabled value={provider.id} />
      </Form.Item>
      <Form.Item label='名称' name='name' rules={[{ required: true }]}>
        <Input disabled={disabled} />
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
      <Form.Item label='Client Secret' name='clientSecret'>
        <Input.Password autoComplete='new-password' disabled={disabled} placeholder='留空则保留原值' />
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
      <SsoProviderCallbackHint providerId={provider.id} />
      <Space className='relay-sso-panel__edit-actions'>
        <Button disabled={disabled} htmlType='submit' type='primary'>保存</Button>
        <Button disabled={disabled} onClick={onCancel}>取消</Button>
      </Space>
    </Form>
  )
}
