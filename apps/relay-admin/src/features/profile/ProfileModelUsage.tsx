import { Alert, Card, Spin, Switch, Table, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { fetchRelayProfileModelUsage } from '../teams/teamModelUsageApi'
import type { RelayAdminModelUsageEvent, RelayAdminModelUsageResponse } from '../teams/teamModelUsageApi'
import { fetchRelayProfileDataReportingSettings, updateRelayProfileDataReportingSettings } from './profileApi'
import type { RelayProfileDataReportingSettings } from './profileApi'

export interface ProfileModelUsageProps {
  token: string
}

const formatNumber = (value: number) => new Intl.NumberFormat('zh-CN').format(value)

const formatTimestamp = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date)
}

const compactId = (value: string | undefined) => value == null ? '-' : `${value.slice(0, 8)}…`

export const ProfileModelUsage = ({ token }: ProfileModelUsageProps) => {
  const [settings, setSettings] = useState<RelayProfileDataReportingSettings>()
  const [usage, setUsage] = useState<RelayAdminModelUsageResponse>()
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    if (token === '') return
    setLoading(true)
    setError(undefined)
    try {
      const [nextSettings, nextUsage] = await Promise.all([
        fetchRelayProfileDataReportingSettings(token),
        fetchRelayProfileModelUsage(token, { limit: 50 })
      ])
      setSettings(nextSettings)
      setUsage(nextUsage)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const updatePersonal = async (enabled: boolean) => {
    setSavingKey('personal')
    setError(undefined)
    try {
      setSettings(await updateRelayProfileDataReportingSettings(token, { personalEnabled: enabled }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSavingKey(undefined)
    }
  }

  const updateDiagnostics = async (enabled: boolean) => {
    setSavingKey('diagnostic')
    setError(undefined)
    try {
      setSettings(await updateRelayProfileDataReportingSettings(token, { diagnosticEnabled: enabled }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSavingKey(undefined)
    }
  }

  if (loading && settings == null) return <Spin size='small' />

  const summary = usage?.summary
  const metrics = [
    ['请求次数', formatNumber(summary?.requests ?? 0)],
    ['Token 总量', formatNumber(summary?.totalTokens ?? 0)],
    ['输入 Token', formatNumber(summary?.inputTokens ?? 0)],
    ['输出 Token', formatNumber(summary?.outputTokens ?? 0)]
  ]

  return (
    <div className='relay-profile-usage'>
      {error == null ? null : <Alert showIcon message={error} type='error' />}

      <Card className='relay-profile-usage__setting-card' size='small' title='数据与诊断'>
        <div className='relay-profile-usage__setting-row'>
          <span>
            <strong>系统诊断数据</strong>
            <small>用于分析启动成功率、启动耗时和错误阶段；不包含提示词、回复、代码、路径或凭据。</small>
          </span>
          <Switch
            checked={settings?.diagnosticReporting.enabled ?? true}
            loading={savingKey === 'diagnostic'}
            onChange={enabled => void updateDiagnostics(enabled)}
          />
        </div>
        <div className='relay-profile-usage__setting-row'>
          <span>
            <strong>模型服务统计</strong>
            <small>个人空间默认开启；关闭后新的模型服务统计不再写入服务端，已有统计保留到数据到期或账号删除。</small>
          </span>
          <Switch
            checked={settings?.modelUsageReporting.personal.enabled ?? true}
            loading={savingKey === 'personal'}
            onChange={enabled => void updatePersonal(enabled)}
          />
        </div>
      </Card>

      <div className='relay-profile-usage__metrics'>
        {metrics.map(([label, value]) => (
          <Card key={label} size='small'>
            <small>{label}</small>
            <strong>{value}</strong>
          </Card>
        ))}
      </div>

      <Card size='small' title='个人模型服务统计明细'>
        <Table<RelayAdminModelUsageEvent>
          dataSource={usage?.events ?? []}
          loading={loading}
          pagination={false}
          rowKey='id'
          size='small'
          columns={[
            { dataIndex: 'occurredAt', title: '时间', render: value => formatTimestamp(String(value)) },
            { dataIndex: 'modelService', title: '模型服务' },
            { dataIndex: 'model', title: '模型' },
            { dataIndex: 'deviceId', title: '设备', render: value => compactId(value as string | undefined) },
            {
              key: 'tokens',
              title: 'Token',
              render: (_, event) => formatNumber(event.inputTokens + event.outputTokens)
            },
            {
              dataIndex: 'success',
              title: '结果',
              render: value => <Tag color={value === true ? 'green' : 'red'}>{value === true ? '成功' : '失败'}</Tag>
            }
          ]}
        />
      </Card>
    </div>
  )
}
