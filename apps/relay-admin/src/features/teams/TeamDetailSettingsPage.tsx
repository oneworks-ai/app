import './TeamPanel.css'

import { Avatar, Button, Empty, Form, Input, Switch } from 'antd'
import { useEffect } from 'react'
import { useParams } from 'react-router-dom'

import { DataPanel } from '../../shared/ui/DataPanel'
import type { RelayAdminTeam, UpdateTeamInput } from './teamTypes'

export interface TeamDetailSettingsPageProps {
  disabled: boolean
  loading: boolean
  teams: RelayAdminTeam[]
  onUpdateTeam: (team: RelayAdminTeam, input: UpdateTeamInput) => Promise<void>
}

interface TeamSettingsFormValues {
  avatarUrl?: string
  description?: string
  name: string
  proxyModeEnabled: boolean
  slug?: string
}

const cleanText = (value: string | undefined) => value?.trim() ?? ''

const valuesFromTeam = (team: RelayAdminTeam | undefined): TeamSettingsFormValues => ({
  avatarUrl: team?.avatarUrl ?? '',
  description: team?.description ?? '',
  name: team?.name ?? '',
  proxyModeEnabled: team?.proxyModeEnabled ?? false,
  slug: team?.slug ?? ''
})

const teamInitials = (name: string) => {
  const text = cleanText(name)
  if (text === '') return '团'
  const words = text.split(/\s+/u).filter(Boolean)
  if (words.length >= 2) {
    return `${Array.from(words[0] ?? '').at(0) ?? ''}${Array.from(words[1] ?? '').at(0) ?? ''}`.toUpperCase()
  }
  return Array.from(text).slice(0, 2).join('').toUpperCase()
}

const validateAvatarUrl = async (_: unknown, value: string | undefined) => {
  const text = cleanText(value)
  if (text === '') return
  try {
    const url = new URL(text)
    if (url.protocol === 'http:' || url.protocol === 'https:') return
  } catch {
    // Invalid URLs fall through to the shared field error below.
  }
  throw new Error('请输入 HTTP/HTTPS 图片地址')
}

export const TeamDetailSettingsPage = ({
  disabled,
  loading,
  onUpdateTeam,
  teams
}: TeamDetailSettingsPageProps) => {
  const { teamId } = useParams()
  const team = teams.find(item => item.id === teamId)
  const [form] = Form.useForm<TeamSettingsFormValues>()
  const watchedAvatarUrl = Form.useWatch('avatarUrl', form)
  const watchedName = Form.useWatch('name', form)

  useEffect(() => {
    form.setFieldsValue(valuesFromTeam(team))
  }, [form, team])

  const handleSubmit = async (values: TeamSettingsFormValues) => {
    if (team == null) return
    const name = cleanText(values.name)
    if (name === '') return
    await onUpdateTeam(team, {
      avatarUrl: cleanText(values.avatarUrl),
      description: cleanText(values.description),
      name,
      proxyModeEnabled: values.proxyModeEnabled,
      slug: cleanText(values.slug)
    })
  }

  if (team == null) {
    return (
      <DataPanel id='team-detail-settings'>
        <section className='relay-team-detail'>
          <Empty
            className='relay-team-detail__empty'
            description={loading ? '正在加载团队' : '团队不存在'}
          />
        </section>
      </DataPanel>
    )
  }

  return (
    <DataPanel id='team-detail-settings'>
      <div className='relay-team-panel relay-team-panel--settings'>
        <Form
          className='relay-team-panel__team-settings-form'
          form={form}
          initialValues={valuesFromTeam(team)}
          layout='vertical'
          onFinish={handleSubmit}
        >
          <div className='relay-team-panel__settings-preview'>
            <Avatar
              className='relay-team-detail__avatar'
              shape='square'
              size={56}
              src={cleanText(watchedAvatarUrl) === '' ? undefined : cleanText(watchedAvatarUrl)}
            >
              {teamInitials(watchedName ?? team.name)}
            </Avatar>
            <div>
              <strong>{cleanText(watchedName) === '' ? team.name : cleanText(watchedName)}</strong>
              <span>{team.slug}</span>
            </div>
          </div>
          <Form.Item label='团队名称' name='name' rules={[{ required: true }]}>
            <Input disabled={disabled} />
          </Form.Item>
          <Form.Item label='头像 URL' name='avatarUrl' rules={[{ validator: validateAvatarUrl }]}>
            <Input disabled={disabled} placeholder='https://example.com/team.png' />
          </Form.Item>
          <Form.Item label='Slug' name='slug'>
            <Input disabled={disabled} />
          </Form.Item>
          <Form.Item label='团队介绍' name='description'>
            <Input.TextArea autoSize={{ minRows: 3 }} disabled={disabled} />
          </Form.Item>
          <Form.Item label='允许配置 Proxy 模式' name='proxyModeEnabled' valuePropName='checked'>
            <Switch disabled={disabled} />
          </Form.Item>
          <Button disabled={disabled} htmlType='submit' type='primary'>
            保存团队设置
          </Button>
        </Form>
      </div>
    </DataPanel>
  )
}
