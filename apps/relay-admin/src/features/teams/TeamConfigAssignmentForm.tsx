import { Button, Form, Input, InputNumber, Select, Switch } from 'antd'

import type {
  CreateConfigProfileAssignmentInput,
  RelayAdminConfigAssignmentMode,
  RelayAdminConfigProjectRule,
  RelayAdminConfigTarget,
  RelayAdminTeam
} from './teamTypes'

export interface TeamConfigAssignmentFormProps {
  disabled: boolean
  team: RelayAdminTeam
  versionOptions: Array<{ label: string; value: string }>
  onCreateAssignment: (input: CreateConfigProfileAssignmentInput) => Promise<void>
  onCreated?: () => void
}

interface TeamConfigAssignmentFormValues {
  allow?: string
  deny?: string
  enabled: boolean
  mode: RelayAdminConfigAssignmentMode
  priority?: number
  teamIds?: string
  userIds?: string
  versionId?: string
}

const splitLines = (value: string | undefined) => {
  const items = (value ?? '').split(/\n|,/u).map(item => item.trim()).filter(Boolean)
  return items.length === 0 ? undefined : Array.from(new Set(items))
}

const compactProject = (values: TeamConfigAssignmentFormValues): RelayAdminConfigProjectRule | undefined => {
  const allow = splitLines(values.allow)
  const deny = splitLines(values.deny)
  return allow == null && deny == null ? undefined : { allow, deny }
}

const compactTarget = (values: TeamConfigAssignmentFormValues, fallbackTeamId: string): RelayAdminConfigTarget => ({
  teamIds: splitLines(values.teamIds) ?? [fallbackTeamId],
  userIds: splitLines(values.userIds)
})

export const TeamConfigAssignmentForm = ({
  disabled,
  onCreateAssignment,
  onCreated,
  team,
  versionOptions
}: TeamConfigAssignmentFormProps) => {
  const [form] = Form.useForm<TeamConfigAssignmentFormValues>()

  const handleCreate = async (values: TeamConfigAssignmentFormValues) => {
    await onCreateAssignment({
      enabled: values.enabled,
      mode: values.mode,
      priority: values.priority,
      project: compactProject(values),
      target: compactTarget(values, team.id),
      versionId: values.versionId
    })
    form.resetFields()
    onCreated?.()
  }

  return (
    <Form
      form={form}
      initialValues={{
        enabled: true,
        mode: 'default',
        priority: 100,
        teamIds: team.id,
        versionId: versionOptions.at(-1)?.value
      }}
      layout='vertical'
      onFinish={handleCreate}
    >
      <Form.Item label='版本' name='versionId'>
        <Select allowClear disabled={disabled} options={versionOptions} />
      </Form.Item>
      <Form.Item label='模式' name='mode' rules={[{ required: true }]}>
        <Select
          disabled={disabled}
          options={[
            { label: 'default', value: 'default' },
            { label: 'override', value: 'override' }
          ]}
        />
      </Form.Item>
      <Form.Item label='启用' name='enabled' valuePropName='checked'>
        <Switch disabled={disabled} />
      </Form.Item>
      <Form.Item label='优先级' name='priority'>
        <InputNumber controls={false} disabled={disabled} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label='团队 ID' name='teamIds'>
        <Input.TextArea autoSize={{ minRows: 2 }} disabled={disabled} />
      </Form.Item>
      <Form.Item label='用户 ID' name='userIds'>
        <Input.TextArea autoSize={{ minRows: 2 }} disabled={disabled} />
      </Form.Item>
      <Form.Item label='项目 allow' name='allow'>
        <Input.TextArea autoSize={{ minRows: 2 }} disabled={disabled} />
      </Form.Item>
      <Form.Item label='项目 deny' name='deny'>
        <Input.TextArea autoSize={{ minRows: 2 }} disabled={disabled} />
      </Form.Item>
      <Button block disabled={disabled} htmlType='submit' type='primary'>
        创建 Assignment
      </Button>
    </Form>
  )
}
