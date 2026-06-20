/* eslint-disable max-lines -- Secret management keeps the table and drawers in one local workflow. */
import { Button, Drawer, Form, Input, Space, Table } from 'antd'
import type { TableColumnsType } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { useTeamDetailTabActions } from './TeamDetailTabActions'
import type { CreateConfigSecretInput, RelayAdminConfigSecret, RelayAdminTeam } from './teamTypes'
import {
  createRelayAdminConfigSecret,
  fetchRelayAdminTeamConfigSecrets,
  revokeRelayAdminConfigSecret,
  rotateRelayAdminConfigSecret
} from './teamsApi'

export interface TeamConfigSecretsProps {
  disabled: boolean
  team: RelayAdminTeam
  token: string
}

interface ConfigSecretFormValues {
  name: string
  value: string
}

const cleanText = (value: string | undefined) => value?.trim() ?? ''

const secretTone = (secret: RelayAdminConfigSecret) => secret.revokedAt == null ? 'success' : 'warning'

export const TeamConfigSecrets = ({ disabled, team, token }: TeamConfigSecretsProps) => {
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [rotateSecret, setRotateSecret] = useState<RelayAdminConfigSecret | undefined>()
  const [secrets, setSecrets] = useState<RelayAdminConfigSecret[]>([])
  const [createForm] = Form.useForm<ConfigSecretFormValues>()
  const [rotateForm] = Form.useForm<Pick<ConfigSecretFormValues, 'value'>>()

  const refreshSecrets = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    let active = true
    if (token.trim() === '') {
      setSecrets([])
      setError(undefined)
      return
    }
    setLoading(true)
    setError(undefined)
    void fetchRelayAdminTeamConfigSecrets(token, team.id)
      .then(body => {
        if (!active) return
        setSecrets(body.secrets)
      })
      .catch(reason => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setSecrets([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [revision, team.id, token])

  const createSecret = async (values: ConfigSecretFormValues) => {
    const input: CreateConfigSecretInput = {
      name: cleanText(values.name),
      teamId: team.id,
      value: cleanText(values.value)
    }
    if (input.name === '' || input.value === '') return
    await createRelayAdminConfigSecret(token, input)
    createForm.resetFields()
    setCreateDrawerOpen(false)
    refreshSecrets()
  }

  const submitRotation = async (values: Pick<ConfigSecretFormValues, 'value'>) => {
    if (rotateSecret == null) return
    const value = cleanText(values.value)
    if (value === '') return
    await rotateRelayAdminConfigSecret(token, rotateSecret, { value })
    rotateForm.resetFields()
    setRotateSecret(undefined)
    refreshSecrets()
  }

  const revokeSecret = async (secret: RelayAdminConfigSecret) => {
    await revokeRelayAdminConfigSecret(token, secret)
    refreshSecrets()
  }

  const columns: TableColumnsType<RelayAdminConfigSecret> = [
    {
      dataIndex: 'name',
      key: 'name',
      title: '密钥',
      width: 180
    },
    {
      key: 'status',
      render: (_, secret) => (
        <StatusBadge tone={secretTone(secret)}>
          {secret.revokedAt == null ? 'active' : 'revoked'}
        </StatusBadge>
      ),
      title: '状态',
      width: 100
    },
    {
      dataIndex: 'secretVersion',
      key: 'secretVersion',
      render: value => `v${value}`,
      title: '版本',
      width: 80
    },
    {
      dataIndex: 'id',
      key: 'id',
      render: value => <span className='relay-team-panel__secondary'>{value}</span>,
      title: '密钥 ID',
      width: 260
    },
    {
      dataIndex: 'rotatedAt',
      key: 'rotatedAt',
      render: (_, secret) => secret.rotatedAt ?? secret.createdAt,
      title: '更新时间',
      width: 190
    },
    {
      align: 'right',
      fixed: 'right',
      key: 'actions',
      render: (_, secret) => (
        <Space size={4}>
          <AdminActionButton
            aria-label='轮换密钥'
            disabled={disabled || secret.revokedAt != null}
            iconName='refresh'
            size='small'
            title='轮换密钥'
            type='text'
            onClick={() => setRotateSecret(secret)}
          />
          <AdminActionButton
            aria-label='撤销密钥'
            disabled={disabled || secret.revokedAt != null}
            iconName='disabled_by_default'
            size='small'
            title='撤销密钥'
            type='text'
            onClick={() => void revokeSecret(secret)}
          />
        </Space>
      ),
      title: '操作',
      width: 96
    }
  ]
  const tabActions = useMemo(() => (
    <Space size={4}>
      <AdminActionButton
        aria-label='创建密钥'
        disabled={disabled}
        iconName='add'
        onClick={() => setCreateDrawerOpen(true)}
        size='small'
        title='创建密钥'
        type='primary'
      />
    </Space>
  ), [disabled])

  useTeamDetailTabActions('secrets', tabActions)

  return (
    <div className='relay-team-panel__secrets'>
      {error == null ? null : <p className='relay-team-panel__error'>{error}</p>}
      <Table<RelayAdminConfigSecret>
        className='relay-admin-table relay-team-panel__secret-table'
        columns={columns}
        dataSource={secrets}
        loading={loading}
        locale={{ emptyText: '暂无密钥' }}
        pagination={false}
        rowKey='id'
        scroll={{ x: 'max-content' }}
        size='middle'
      />

      <Drawer
        destroyOnHidden
        open={createDrawerOpen}
        title='新建密钥'
        width={460}
        onClose={() => setCreateDrawerOpen(false)}
      >
        <Form form={createForm} layout='vertical' onFinish={createSecret}>
          <Form.Item label='密钥名称' name='name' rules={[{ required: true }]}>
            <Input disabled={disabled} placeholder='OpenAI API key' />
          </Form.Item>
          <Form.Item label='密钥值' name='value' rules={[{ required: true }]}>
            <Input.Password disabled={disabled} />
          </Form.Item>
          <Button block disabled={disabled} htmlType='submit' type='primary'>
            创建密钥
          </Button>
        </Form>
      </Drawer>

      <Drawer
        destroyOnHidden
        open={rotateSecret != null}
        title={rotateSecret == null ? '轮换密钥' : `轮换密钥 · ${rotateSecret.name}`}
        width={460}
        onClose={() => setRotateSecret(undefined)}
      >
        <Form form={rotateForm} layout='vertical' onFinish={submitRotation}>
          <Form.Item label='密钥值' name='value' rules={[{ required: true }]}>
            <Input.Password disabled={disabled || rotateSecret == null} />
          </Form.Item>
          <Button block disabled={disabled || rotateSecret == null} htmlType='submit' type='primary'>
            轮换密钥
          </Button>
        </Form>
      </Drawer>
    </div>
  )
}
