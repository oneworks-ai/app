import { Button, Form, Input } from 'antd'

import type { CreateTeamInput } from './teamTypes'

export interface TeamCreateFormProps {
  disabled: boolean
  onCreateTeam: (input: CreateTeamInput) => Promise<void>
  onCreated?: () => void
}

interface TeamCreateFormValues {
  description?: string
  name: string
  slug?: string
}

const cleanText = (value: string | undefined) => value?.trim() ?? ''

export const TeamCreateForm = ({ disabled, onCreateTeam, onCreated }: TeamCreateFormProps) => {
  const [form] = Form.useForm<TeamCreateFormValues>()

  const handleCreate = async (values: TeamCreateFormValues) => {
    const input: CreateTeamInput = {
      name: cleanText(values.name),
      description: cleanText(values.description),
      slug: cleanText(values.slug)
    }
    if (input.name === '') return
    await onCreateTeam(input)
    form.resetFields()
    onCreated?.()
  }

  return (
    <Form form={form} layout='vertical' onFinish={handleCreate}>
      <Form.Item label='团队名称' name='name' rules={[{ required: true }]}>
        <Input disabled={disabled} placeholder='Team name' />
      </Form.Item>
      <Form.Item label='Slug' name='slug'>
        <Input disabled={disabled} placeholder='team-slug' />
      </Form.Item>
      <Form.Item label='描述' name='description'>
        <Input.TextArea autoSize={{ minRows: 3 }} disabled={disabled} placeholder='团队用途' />
      </Form.Item>
      <Button block disabled={disabled} htmlType='submit' type='primary'>
        创建团队
      </Button>
    </Form>
  )
}
