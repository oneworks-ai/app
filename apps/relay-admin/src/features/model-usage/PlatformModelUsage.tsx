/* eslint-disable max-lines -- cross-team metrics, drilldowns, filters, and event ledger form one analytics surface. */
import './PlatformModelUsage.css'
import '../teams/TeamModelUsage.css'

import { Alert, Button, Card, Input, Select, Space, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type {
  RelayAdminModelUsageEvent,
  RelayAdminModelUsageResponse,
  RelayAdminUsageAggregate
} from '../teams/teamModelUsageApi'
import { fetchRelayAdminModelUsage } from '../teams/teamModelUsageApi'

const PAGE_SIZE = 50

const emptyAggregate = (): RelayAdminUsageAggregate => ({
  activeUsers: 0,
  cacheCreationInputTokens: 0,
  cachedInputTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  requests: 0,
  totalTokens: 0
})

const emptyResponse: RelayAdminModelUsageResponse = {
  events: [],
  retention: { days: 90, maxEvents: 100_000 },
  series: [],
  summary: {
    ...emptyAggregate(),
    byAdapter: {},
    byModel: {},
    byModelService: {},
    bySource: {},
    byTeam: {},
    byUser: {}
  },
  teams: [],
  users: []
}

const compactNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1, notation: 'compact' })
const fullNumber = new Intl.NumberFormat('zh-CN')
const formatTokens = (value: number) => compactNumber.format(value)
const formatPercent = (value: number | undefined) => value == null ? '-' : `${(value * 100).toFixed(1)}%`
const formatDuration = (value: number | undefined) =>
  value == null ? '-' : value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(2)} s`
const formatTimestamp = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

const userLabel = (userId: string, data: RelayAdminModelUsageResponse) => {
  const user = data.users.find(item => item.id === userId)
  return user?.name.trim() || user?.email || userId
}

const teamLabel = (teamId: string, data: RelayAdminModelUsageResponse) =>
  data.teams.find(team => team.id === teamId)?.name ?? teamId

const downloadJson = (data: RelayAdminModelUsageResponse) => {
  const payload = {
    events: data.events,
    exportedAt: new Date().toISOString(),
    scope: 'platform',
    teams: data.teams,
    users: data.users,
    version: 1
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'oneworks-platform-model-usage.json'
  link.click()
  URL.revokeObjectURL(url)
}

const UsageMetric = ({ hint, label, value }: { hint: string; label: string; value: string }) => (
  <Card className='relay-team-usage__metric' size='small'>
    <span className='relay-team-usage__metric-label'>{label}</span>
    <span className='relay-team-usage__metric-value'>{value}</span>
    <span className='relay-team-usage__metric-hint'>{hint}</span>
  </Card>
)

export interface PlatformModelUsageProps {
  embedded?: boolean
  token: string
}

export const PlatformModelUsage = ({ embedded = false, token }: PlatformModelUsageProps) => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState(emptyResponse)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const loadSequence = useRef(0)
  const query = searchParams.get('q') ?? ''
  const teamId = searchParams.get('teamId') ?? ''
  const userId = searchParams.get('userId') ?? ''
  const modelService = searchParams.get('modelService') ?? ''
  const source = searchParams.get('source') ?? ''
  const range = searchParams.get('range') ?? '30d'
  const cursor = searchParams.get('cursor') ?? ''

  const updateFilter = useCallback((key: string, value: string) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current)
      if (value === '') next.delete(key)
      else next.set(key, value)
      next.delete('cursor')
      return next
    })
    setCursorHistory([])
  }, [setSearchParams])

  const from = useMemo(() => {
    const days = Number.parseInt(range, 10)
    if (!Number.isFinite(days) || days <= 0) return undefined
    return new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString()
  }, [range])

  const load = useCallback(async () => {
    if (token.trim() === '') return
    const sequence = ++loadSequence.current
    setLoading(true)
    setError(undefined)
    try {
      const response = await fetchRelayAdminModelUsage(token, {
        cursor,
        from,
        limit: PAGE_SIZE,
        modelService,
        q: query,
        source,
        teamId,
        userId
      })
      if (sequence === loadSequence.current) setData(response)
    } catch (reason) {
      if (sequence === loadSequence.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [cursor, from, modelService, query, source, teamId, token, userId])

  useEffect(() => {
    void load()
  }, [load])

  const serviceEntries = useMemo(() => Object.entries(data.summary.byModelService), [data.summary.byModelService])
  const maxServiceTokens = Math.max(1, ...serviceEntries.map(([, aggregate]) => aggregate.totalTokens))
  const maxTrendTokens = Math.max(1, ...data.series.map(item => item.totalTokens))
  const teamRows = useMemo(() =>
    Object.entries(data.summary.byTeam).map(([id, aggregate]) => ({
      ...aggregate,
      id,
      label: teamLabel(id, data)
    })), [data])

  const columns: TableColumnsType<RelayAdminModelUsageEvent> = [
    {
      dataIndex: 'occurredAt',
      key: 'occurredAt',
      render: value => formatTimestamp(String(value)),
      title: '时间',
      width: 145
    },
    {
      dataIndex: 'teamId',
      key: 'teamId',
      render: value => (
        <Button type='link' onClick={() => updateFilter('teamId', String(value))}>
          {teamLabel(String(value), data)}
        </Button>
      ),
      title: '团队',
      width: 150
    },
    {
      dataIndex: 'userId',
      key: 'userId',
      render: value => (
        <Button type='link' onClick={() => updateFilter('userId', String(value))}>
          {userLabel(String(value), data)}
        </Button>
      ),
      title: '成员',
      width: 145
    },
    {
      key: 'service',
      render: (_, event) => (
        <div className='relay-team-usage__service'>
          <strong>{event.modelService}</strong>
          <span>{event.model}</span>
        </div>
      ),
      title: 'Model Service / 模型',
      width: 220
    },
    {
      key: 'runtime',
      render: (_, event) =>
        <Space size={4}>
          <Tag>{event.adapter ?? 'unknown'}</Tag>
          <Tag>{event.source}</Tag>
        </Space>,
      title: '运行时',
      width: 155
    },
    {
      key: 'tokens',
      render: (_, event) => (
        <span className='relay-team-usage__token-pair'>
          {formatTokens(event.inputTokens)} in / {formatTokens(event.outputTokens)} out
        </span>
      ),
      title: 'Token',
      width: 155
    },
    {
      dataIndex: 'durationMs',
      key: 'duration',
      render: value => formatDuration(value == null ? undefined : Number(value)),
      title: '耗时',
      width: 90
    },
    {
      dataIndex: 'success',
      key: 'success',
      render: value => (
        <StatusBadge tone={value === true ? 'success' : 'danger'}>{value ? '成功' : '失败'}</StatusBadge>
      ),
      title: '结果',
      width: 85
    }
  ]

  return (
    <section
      className={`relay-team-usage relay-platform-usage${embedded ? ' relay-platform-usage--embedded' : ''}`}
      aria-label='全平台 Model Service 用量'
    >
      {error == null ? null : <Alert message={error} showIcon type='error' />}
      <div className='relay-team-usage__toolbar'>
        <div className='relay-team-usage__toolbar-main'>
          <Input
            allowClear
            className='relay-team-usage__search'
            placeholder='搜索团队、成员、服务或模型'
            prefix={<AdminIcon name='search' />}
            value={query}
            onChange={event => updateFilter('q', event.target.value)}
          />
          <Select
            aria-label='统计时间范围'
            options={[
              { label: '最近 7 天', value: '7d' },
              { label: '最近 30 天', value: '30d' },
              { label: '最近 90 天', value: '90d' },
              { label: '全部留存数据', value: 'all' }
            ]}
            value={range}
            onChange={value => updateFilter('range', value)}
          />
          <Select
            allowClear
            aria-label='按团队筛选'
            options={data.teams.map(team => ({ label: team.name, value: team.id }))}
            placeholder='全部团队'
            value={teamId || undefined}
            onChange={value => updateFilter('teamId', value ?? '')}
          />
          <Select
            allowClear
            aria-label='按成员筛选'
            options={data.users.map(user => ({ label: user.name.trim() || user.email, value: user.id }))}
            placeholder='全部成员'
            value={userId || undefined}
            onChange={value => updateFilter('userId', value ?? '')}
          />
          <Select
            allowClear
            aria-label='按 Model Service 筛选'
            options={Object.keys(data.summary.byModelService).map(value => ({ label: value, value }))}
            placeholder='全部服务'
            value={modelService || undefined}
            onChange={value => updateFilter('modelService', value ?? '')}
          />
          <Select
            allowClear
            aria-label='按来源筛选'
            options={['oneworks', 'codex', 'other'].map(value => ({ label: value, value }))}
            placeholder='全部来源'
            value={source || undefined}
            onChange={value => updateFilter('source', value ?? '')}
          />
        </div>
        <div className='relay-team-usage__toolbar-actions'>
          <AdminActionButton
            aria-label='刷新平台用量'
            disabled={loading}
            iconName='refresh'
            title='刷新平台用量'
            onClick={() => void load()}
          />
          <AdminActionButton
            aria-label='导出当前平台用量事件'
            disabled={data.events.length === 0}
            iconName='sync'
            title='导出当前平台用量事件'
            onClick={() => downloadJson(data)}
          />
        </div>
      </div>

      <div className='relay-team-usage__summary'>
        <UsageMetric hint='完成的模型调用' label='请求量' value={fullNumber.format(data.summary.requests)} />
        <UsageMetric hint='输入 + 输出' label='总 Token' value={formatTokens(data.summary.totalTokens)} />
        <UsageMetric hint='有用量的组织' label='活跃团队' value={String(Object.keys(data.summary.byTeam).length)} />
        <UsageMetric hint='跨团队去重人数' label='活跃成员' value={String(data.summary.activeUsers)} />
        <UsageMetric
          hint={`${formatTokens(data.summary.cachedInputTokens)} cached`}
          label='缓存占比'
          value={formatPercent(data.summary.cacheRate)}
        />
        <UsageMetric hint='有耗时样本时计算' label='P95 耗时' value={formatDuration(data.summary.p95DurationMs)} />
      </div>

      <div className='relay-team-usage__analysis-grid'>
        <Card className='relay-team-usage__analysis-card' size='small'>
          <div className='relay-team-usage__card-title'>
            <strong>全平台 Token 趋势</strong>
            <span className='relay-team-usage__legend'>按自然日 · 输入与输出合计</span>
          </div>
          {data.series.length === 0
            ? <Alert message='当前筛选范围内暂无用量' type='info' />
            : (
              <div className='relay-team-usage__trend'>
                {data.series.map(item => (
                  <div
                    className='relay-team-usage__trend-item'
                    key={item.date}
                    title={`${item.date} · ${item.totalTokens}`}
                  >
                    <div className='relay-team-usage__trend-bar-wrap'>
                      <div
                        className='relay-team-usage__trend-bar'
                        style={{ height: `${Math.max(3, item.totalTokens / maxTrendTokens * 100)}%` }}
                      />
                    </div>
                    <span className='relay-team-usage__trend-label'>{item.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
        </Card>
        <Card className='relay-team-usage__analysis-card' size='small'>
          <div className='relay-team-usage__card-title'>
            <strong>Model Service 分布</strong>
            <span className='relay-team-usage__legend'>{serviceEntries.length} 个服务</span>
          </div>
          <div className='relay-team-usage__breakdown'>
            {serviceEntries.slice(0, 6).map(([service, aggregate]) => (
              <button
                className='relay-team-usage__breakdown-row'
                key={service}
                type='button'
                onClick={() => updateFilter('modelService', service)}
              >
                <span className='relay-team-usage__breakdown-label'>
                  <strong>{service}</strong>
                  <span>{formatTokens(aggregate.totalTokens)} · {aggregate.requests} 次</span>
                </span>
                <span className='relay-team-usage__breakdown-track'>
                  <span
                    className='relay-team-usage__breakdown-fill'
                    style={{ display: 'block', width: `${aggregate.totalTokens / maxServiceTokens * 100}%` }}
                  />
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card className='relay-team-usage__table-card' size='small' title='团队用量排行'>
        <Table
          columns={[
            {
              dataIndex: 'label',
              key: 'team',
              render: (value, row) => (
                <Button type='link' onClick={() => navigate(`/teams/${encodeURIComponent(row.id)}/usage`)}>
                  {String(value)}
                </Button>
              ),
              title: '团队'
            },
            { dataIndex: 'activeUsers', key: 'activeUsers', title: '活跃成员', width: 110 },
            { dataIndex: 'requests', key: 'requests', title: '请求', width: 100 },
            {
              dataIndex: 'totalTokens',
              key: 'totalTokens',
              render: value => formatTokens(Number(value)),
              title: '总 Token',
              width: 130
            },
            {
              dataIndex: 'cachedInputTokens',
              key: 'cachedInputTokens',
              render: value => formatTokens(Number(value)),
              title: '缓存 Token',
              width: 130
            },
            {
              dataIndex: 'outputTokens',
              key: 'outputTokens',
              render: value => formatTokens(Number(value)),
              title: '输出 Token',
              width: 130
            }
          ]}
          dataSource={teamRows}
          loading={loading}
          pagination={false}
          rowKey='id'
          size='small'
        />
      </Card>

      <Card className='relay-team-usage__table-card' size='small' title='跨团队用量事件明细'>
        <Table
          columns={columns}
          dataSource={data.events}
          loading={loading}
          pagination={false}
          rowKey='id'
          scroll={{ x: 'max-content' }}
          size='small'
        />
        <div className='relay-team-usage__footer'>
          <span className='relay-team-usage__retention'>
            保留 {data.retention.days} 天；仅保存身份、模型与计数，不保存提示词或响应内容。
          </span>
          <Space>
            <Button
              disabled={cursorHistory.length === 0}
              onClick={() => {
                const previous = cursorHistory.at(-1) ?? ''
                setCursorHistory(history => history.slice(0, -1))
                setSearchParams(current => {
                  const next = new URLSearchParams(current)
                  if (previous === '') next.delete('cursor')
                  else next.set('cursor', previous)
                  return next
                })
              }}
            >
              上一页
            </Button>
            <Button
              disabled={data.nextCursor == null}
              onClick={() => {
                setCursorHistory(history => [...history, cursor])
                setSearchParams(current => {
                  const next = new URLSearchParams(current)
                  next.set('cursor', data.nextCursor ?? '')
                  return next
                })
              }}
            >
              下一页
            </Button>
          </Space>
        </div>
      </Card>
    </section>
  )
}
