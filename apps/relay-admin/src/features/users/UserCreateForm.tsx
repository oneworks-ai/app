import { Button, Form, Input, InputNumber, Select } from 'antd'

import { relayAdminRoles } from '../../shared/model/adminRoles'
import type { CreateUserInput, RelayAdminRole } from '../../shared/model/adminTypes'

export interface UserCreateFormProps {
  disabled: boolean
  onCreateUser: (input: CreateUserInput) => Promise<void>
  onCreated?: () => void
}

interface UserCreateFormValues {
  email: string
  loginId?: string
  maxDevices?: number | null
  name?: string
  password?: string
  role: RelayAdminRole
}

export const UserCreateForm = ({ disabled, onCreated, onCreateUser }: UserCreateFormProps) => {
  const [form] = Form.useForm<UserCreateFormValues>()

  const handleCreate = async (values: UserCreateFormValues) => {
    const input: CreateUserInput = {
      email: values.email.trim(),
      loginId: values.loginId?.trim() === '' ? null : values.loginId?.trim(),
      maxDevices: values.maxDevices ?? null,
      name: values.name?.trim() ?? '',
      role: values.role
    }
    const password = values.password ?? ''
    if (password !== '') input.password = password
    if (input.email === '') return
    await onCreateUser(input)
    form.resetFields()
    onCreated?.()
  }

  return (
    <Form
      form={form}
      layout='vertical'
      initialValues={{ role: 'member' }}
      onFinish={handleCreate}
    >
      <Form.Item label='邮箱' name='email' rules={[{ required: true, type: 'email' }]}>
        <Input disabled={disabled} placeholder='email@example.com' />
      </Form.Item>
      <Form.Item label='登录 ID' name='loginId'>
        <Input disabled={disabled} placeholder='留空默认使用邮箱' />
      </Form.Item>
      <Form.Item label='名称' name='name'>
        <Input disabled={disabled} placeholder='显示名称' />
      </Form.Item>
      <Form.Item label='登录密码' name='password' rules={[{ min: 8 }]}>
        <Input.Password autoComplete='new-password' disabled={disabled} placeholder='至少 8 位，留空则暂不启用' />
      </Form.Item>
      <Form.Item label='权限' name='role' rules={[{ required: true }]}>
        <Select disabled={disabled} options={relayAdminRoles.map(role => ({ label: role, value: role }))} />
      </Form.Item>
      <Form.Item label='设备上限' name='maxDevices'>
        <InputNumber
          controls={false}
          disabled={disabled}
          min={0}
          placeholder='不限'
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Button block disabled={disabled} htmlType='submit' type='primary'>
        创建用户
      </Button>
    </Form>
  )
}
