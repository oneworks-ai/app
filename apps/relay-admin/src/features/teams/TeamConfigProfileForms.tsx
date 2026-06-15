import { Button, Form, Input, Select } from 'antd'

import type {
  CreateConfigProfileInput,
  CreateConfigProfileVersionInput,
  RelayAdminConfigPatch,
  RelayAdminConfigSafeField
} from './teamTypes'

export const relayConfigSafeFieldOptions: Array<{ label: string; value: RelayAdminConfigSafeField }> = [
  { label: 'defaultModelService', value: 'defaultModelService' },
  { label: 'modelServices', value: 'modelServices' },
  { label: 'recommendedModels', value: 'recommendedModels' },
  { label: 'plugins', value: 'plugins' },
  { label: 'marketplaces', value: 'marketplaces' },
  { label: 'skills', value: 'skills' },
  { label: 'skillsMeta', value: 'skillsMeta' },
  { label: 'skillRegistries', value: 'skillRegistries' }
]

export interface TeamProfileCreateFormProps {
  disabled: boolean
  teamId: string
  onCreateProfile: (input: CreateConfigProfileInput) => Promise<void>
  onCreated?: () => void
}

interface TeamProfileCreateFormValues {
  description?: string
  name: string
}

const cleanText = (value: string | undefined) => value?.trim() ?? ''

const parseJsonRecord = (value: string | undefined) => {
  const text = cleanText(value)
  if (text === '') return undefined
  const parsed = JSON.parse(text) as unknown
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON must be an object.')
  }
  return parsed as Record<string, string>
}

const parseConfigPatch = (value: string | undefined): RelayAdminConfigPatch => {
  const parsed = parseJsonRecord(value)
  if (parsed == null) return {}
  return parsed as RelayAdminConfigPatch
}

export const TeamProfileCreateForm = ({
  disabled,
  onCreateProfile,
  onCreated,
  teamId
}: TeamProfileCreateFormProps) => {
  const [form] = Form.useForm<TeamProfileCreateFormValues>()

  const handleCreate = async (values: TeamProfileCreateFormValues) => {
    const input = {
      description: cleanText(values.description),
      name: cleanText(values.name),
      teamId
    }
    if (input.name === '') return
    await onCreateProfile(input)
    form.resetFields()
    onCreated?.()
  }

  return (
    <Form form={form} layout='vertical' onFinish={handleCreate}>
      <Form.Item label='Profile 名称' name='name' rules={[{ required: true }]}>
        <Input disabled={disabled} placeholder='Team defaults' />
      </Form.Item>
      <Form.Item label='描述' name='description'>
        <Input.TextArea autoSize={{ minRows: 3 }} disabled={disabled} />
      </Form.Item>
      <Button block disabled={disabled} htmlType='submit' type='primary'>
        创建 Profile
      </Button>
    </Form>
  )
}

export interface TeamProfileVersionFormProps {
  disabled: boolean
  onCreateVersion: (input: CreateConfigProfileVersionInput) => Promise<void>
  onCreated?: () => void
}

interface TeamProfileVersionFormValues {
  allowedFields: RelayAdminConfigSafeField[]
  changeNote?: string
  configPatch: string
  secretRefs?: string
}

export const TeamProfileVersionForm = ({ disabled, onCreateVersion, onCreated }: TeamProfileVersionFormProps) => {
  const [form] = Form.useForm<TeamProfileVersionFormValues>()

  const handleCreate = async (values: TeamProfileVersionFormValues) => {
    const configPatch = parseConfigPatch(values.configPatch)
    await onCreateVersion({
      allowedFields: values.allowedFields,
      changeNote: cleanText(values.changeNote),
      configPatch,
      secretRefs: parseJsonRecord(values.secretRefs)
    })
    form.resetFields()
    onCreated?.()
  }

  return (
    <Form
      form={form}
      initialValues={{
        allowedFields: ['defaultModelService', 'modelServices', 'plugins', 'skills'],
        configPatch: '{\n  "defaultModelService": "team-model"\n}'
      }}
      layout='vertical'
      onFinish={handleCreate}
    >
      <Form.Item label='允许字段' name='allowedFields' rules={[{ required: true }]}>
        <Select disabled={disabled} mode='multiple' options={relayConfigSafeFieldOptions} />
      </Form.Item>
      <Form.Item label='Config Patch JSON' name='configPatch' rules={[{ required: true }]}>
        <Input.TextArea autoSize={{ minRows: 8 }} disabled={disabled} />
      </Form.Item>
      <Form.Item label='Secret Refs JSON' name='secretRefs'>
        <Input.TextArea autoSize={{ minRows: 3 }} disabled={disabled} placeholder='{"OPENAI_API_KEY":"secret-id"}' />
      </Form.Item>
      <Form.Item label='变更说明' name='changeNote'>
        <Input disabled={disabled} />
      </Form.Item>
      <Button block disabled={disabled} htmlType='submit' type='primary'>
        创建版本
      </Button>
    </Form>
  )
}
