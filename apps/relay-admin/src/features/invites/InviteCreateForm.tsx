import { Button, Form, Input, InputNumber, Select } from 'antd'

import { inviteAssignableRoles } from '../../shared/model/adminRoles'
import type { CreateInviteInput, RelayAdminRole } from '../../shared/model/adminTypes'

export interface InviteCreateFormProps {
  disabled: boolean
  onCreateInvite: (input: CreateInviteInput) => Promise<void>
  onCreated?: () => void
}

interface InviteCreateFormValues {
  code?: string
  maxUses: number
  role: RelayAdminRole
  userId?: string
}

export const InviteCreateForm = ({ disabled, onCreated, onCreateInvite }: InviteCreateFormProps) => {
  const [form] = Form.useForm<InviteCreateFormValues>()

  const handleCreate = async (values: InviteCreateFormValues) => {
    await onCreateInvite({
      code: values.code?.trim() || undefined,
      maxUses: Math.max(1, Number(values.maxUses || 1)),
      role: values.role,
      userId: values.userId?.trim() || undefined
    })
    form.resetFields()
    onCreated?.()
  }

  return (
    <Form
      form={form}
      layout='vertical'
      initialValues={{ maxUses: 1, role: 'member' }}
      onFinish={handleCreate}
    >
      <Form.Item label='邀请码' name='code'>
        <Input disabled={disabled} placeholder='留空自动生成' />
      </Form.Item>
      <Form.Item label='权限' name='role' rules={[{ required: true }]}>
        <Select disabled={disabled} options={inviteAssignableRoles.map(role => ({ label: role, value: role }))} />
      </Form.Item>
      <Form.Item label='可使用次数' name='maxUses' rules={[{ required: true }]}>
        <InputNumber disabled={disabled} min={1} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label='绑定用户 ID' name='userId'>
        <Input disabled={disabled} placeholder='可选' />
      </Form.Item>
      <Button block disabled={disabled} htmlType='submit' type='primary'>
        创建邀请码
      </Button>
    </Form>
  )
}
