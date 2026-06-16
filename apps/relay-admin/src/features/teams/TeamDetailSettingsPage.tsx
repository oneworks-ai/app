import './TeamPanel.css'

import { Alert, Avatar, Button, Empty, Form, Input, Switch, Upload } from 'antd'
import type { UploadProps } from 'antd'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { AdminIcon } from '../../shared/ui/AdminIcon'
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
const maxAvatarFileBytes = 512 * 1024
const acceptedAvatarMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const avatarDataUrlPattern = /^data:image\/(?:png|jpeg|webp|gif);base64,/iu

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

const readAvatarFile = async (file: File) =>
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('头像读取失败'))
      }
    })
    reader.addEventListener('error', () => reject(new Error('头像读取失败')))
    reader.readAsDataURL(file)
  })

const validateAvatarSource = async (_: unknown, value: string | undefined) => {
  const text = cleanText(value)
  if (text === '') return
  if (avatarDataUrlPattern.test(text)) return
  try {
    const url = new URL(text)
    if (url.protocol === 'http:' || url.protocol === 'https:') return
  } catch {
    // Invalid URLs fall through to the shared field error below.
  }
  throw new Error('请上传 PNG、JPEG、WebP 或 GIF 图片')
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
  const [avatarUploadError, setAvatarUploadError] = useState<string | undefined>()
  const watchedAvatarUrl = Form.useWatch('avatarUrl', form)
  const watchedName = Form.useWatch('name', form)
  const avatarPreview = cleanText(watchedAvatarUrl) === '' ? undefined : cleanText(watchedAvatarUrl)

  useEffect(() => {
    form.setFieldsValue(valuesFromTeam(team))
    setAvatarUploadError(undefined)
  }, [form, team])

  const handleAvatarUpload: UploadProps['beforeUpload'] = file => {
    setAvatarUploadError(undefined)
    if (!acceptedAvatarMimeTypes.has(file.type)) {
      setAvatarUploadError('头像仅支持 PNG、JPEG、WebP 或 GIF')
      return Upload.LIST_IGNORE
    }
    if (file.size > maxAvatarFileBytes) {
      setAvatarUploadError('头像不能超过 512 KiB')
      return Upload.LIST_IGNORE
    }

    void readAvatarFile(file).then(dataUrl => {
      form.setFieldValue('avatarUrl', dataUrl)
      void form.validateFields(['avatarUrl'])
    }).catch(reason => {
      setAvatarUploadError(reason instanceof Error ? reason.message : String(reason))
    })
    return Upload.LIST_IGNORE
  }

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
            <div className='relay-team-panel__avatar-editor'>
              <Avatar
                className='relay-team-detail__avatar'
                shape='square'
                size={56}
                src={avatarPreview}
              >
                {teamInitials(watchedName ?? team.name)}
              </Avatar>
              <div className='relay-team-panel__avatar-controls'>
                <span className='relay-team-panel__avatar-label'>团队头像</span>
                <div className='relay-team-panel__avatar-actions'>
                  <Upload
                    accept='image/png,image/jpeg,image/webp,image/gif'
                    beforeUpload={handleAvatarUpload}
                    disabled={disabled}
                    maxCount={1}
                    showUploadList={false}
                  >
                    <Button disabled={disabled} icon={<AdminIcon name='cloud_upload' />}>
                      上传头像
                    </Button>
                  </Upload>
                  <Button
                    danger
                    disabled={disabled || avatarPreview == null}
                    icon={<AdminIcon name='delete' />}
                    onClick={() => {
                      form.setFieldValue('avatarUrl', '')
                      setAvatarUploadError(undefined)
                    }}
                  >
                    移除头像
                  </Button>
                </div>
                {avatarUploadError == null ? null : (
                  <Alert
                    className='relay-team-panel__avatar-error'
                    message={avatarUploadError}
                    showIcon={false}
                    type='error'
                  />
                )}
              </div>
            </div>
            <div className='relay-team-panel__settings-preview-copy'>
              <strong>{cleanText(watchedName) === '' ? team.name : cleanText(watchedName)}</strong>
              <span>{team.slug}</span>
            </div>
          </div>
          <Form.Item hidden name='avatarUrl' rules={[{ validator: validateAvatarSource }]}>
            <Input />
          </Form.Item>
          <Form.Item label='团队名称' name='name' rules={[{ required: true }]}>
            <Input disabled={disabled} />
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
