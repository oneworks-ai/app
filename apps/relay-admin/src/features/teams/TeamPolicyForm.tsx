import { Button, Form, InputNumber, Switch } from 'antd'
import { useEffect } from 'react'

import type { RelayAdminTeamPolicy, UpdateTeamPolicyInput } from './teamTypes'

export interface TeamPolicyFormProps {
  disabled: boolean
  policy?: RelayAdminTeamPolicy
  onUpdatePolicy: (input: UpdateTeamPolicyInput) => Promise<void>
}

interface TeamPolicyFormValues {
  maxAssignmentsPerProfile?: number | null
  maxMembersPerTeam?: number | null
  maxProfilesPerTeam?: number | null
  maxSecretTtlHours?: number | null
  maxTeamsPerTenant?: number | null
  maxTeamsPerUser?: number | null
  proxyModeEnabled: boolean
  requireOwnerApprovalForSecretProfiles: boolean
  selfServiceTeamCreation: boolean
  teamsEnabled: boolean
}

const compactLimit = (value: number | null | undefined) => (
  value == null ? null : Math.max(0, Math.trunc(value))
)

const valuesFromPolicy = (policy: RelayAdminTeamPolicy | undefined): TeamPolicyFormValues => ({
  maxAssignmentsPerProfile: policy?.maxAssignmentsPerProfile ?? null,
  maxMembersPerTeam: policy?.maxMembersPerTeam ?? null,
  maxProfilesPerTeam: policy?.maxProfilesPerTeam ?? null,
  maxSecretTtlHours: policy?.maxSecretTtlHours ?? null,
  maxTeamsPerTenant: policy?.maxTeamsPerTenant ?? null,
  maxTeamsPerUser: policy?.maxTeamsPerUser ?? null,
  proxyModeEnabled: policy?.proxyModeEnabled ?? false,
  requireOwnerApprovalForSecretProfiles: policy?.requireOwnerApprovalForSecretProfiles ?? false,
  selfServiceTeamCreation: policy?.selfServiceTeamCreation ?? true,
  teamsEnabled: policy?.teamsEnabled ?? true
})

export const TeamPolicyForm = ({ disabled, onUpdatePolicy, policy }: TeamPolicyFormProps) => {
  const [form] = Form.useForm<TeamPolicyFormValues>()

  useEffect(() => {
    form.setFieldsValue(valuesFromPolicy(policy))
  }, [form, policy])

  const handleSubmit = async (values: TeamPolicyFormValues) => {
    await onUpdatePolicy({
      maxAssignmentsPerProfile: compactLimit(values.maxAssignmentsPerProfile),
      maxMembersPerTeam: compactLimit(values.maxMembersPerTeam),
      maxProfilesPerTeam: compactLimit(values.maxProfilesPerTeam),
      maxSecretTtlHours: compactLimit(values.maxSecretTtlHours),
      maxTeamsPerTenant: compactLimit(values.maxTeamsPerTenant),
      maxTeamsPerUser: compactLimit(values.maxTeamsPerUser),
      proxyModeEnabled: values.proxyModeEnabled,
      requireOwnerApprovalForSecretProfiles: values.requireOwnerApprovalForSecretProfiles,
      selfServiceTeamCreation: values.selfServiceTeamCreation,
      teamsEnabled: values.teamsEnabled
    })
  }

  return (
    <Form
      className='relay-team-panel__policy-form'
      form={form}
      initialValues={valuesFromPolicy(policy)}
      layout='vertical'
      onFinish={handleSubmit}
    >
      <div className='relay-team-panel__policy-switches'>
        <Form.Item label='团队功能' name='teamsEnabled' valuePropName='checked'>
          <Switch disabled={disabled || policy == null} />
        </Form.Item>
        <Form.Item label='自助创建' name='selfServiceTeamCreation' valuePropName='checked'>
          <Switch disabled={disabled || policy == null} />
        </Form.Item>
        <Form.Item label='代理模式' name='proxyModeEnabled' valuePropName='checked'>
          <Switch disabled={disabled || policy == null} />
        </Form.Item>
        <Form.Item label='Secret 审批' name='requireOwnerApprovalForSecretProfiles' valuePropName='checked'>
          <Switch disabled={disabled || policy == null} />
        </Form.Item>
      </div>
      <div className='relay-team-panel__policy-grid'>
        <Form.Item label='租户团队上限' name='maxTeamsPerTenant'>
          <InputNumber controls={false} disabled={disabled || policy == null} min={0} placeholder='不限' />
        </Form.Item>
        <Form.Item label='用户团队上限' name='maxTeamsPerUser'>
          <InputNumber controls={false} disabled={disabled || policy == null} min={0} placeholder='不限' />
        </Form.Item>
        <Form.Item label='团队成员上限' name='maxMembersPerTeam'>
          <InputNumber controls={false} disabled={disabled || policy == null} min={0} placeholder='不限' />
        </Form.Item>
        <Form.Item label='Profile 上限' name='maxProfilesPerTeam'>
          <InputNumber controls={false} disabled={disabled || policy == null} min={0} placeholder='不限' />
        </Form.Item>
        <Form.Item label='Assignment 上限' name='maxAssignmentsPerProfile'>
          <InputNumber controls={false} disabled={disabled || policy == null} min={0} placeholder='不限' />
        </Form.Item>
        <Form.Item label='Secret TTL 小时' name='maxSecretTtlHours'>
          <InputNumber controls={false} disabled={disabled || policy == null} min={0} placeholder='不限' />
        </Form.Item>
      </div>
      <Button disabled={disabled || policy == null} htmlType='submit' type='primary'>
        保存策略
      </Button>
    </Form>
  )
}
