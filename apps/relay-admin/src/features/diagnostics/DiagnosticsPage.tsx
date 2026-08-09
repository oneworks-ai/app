/* eslint-disable max-lines -- diagnostic summary, replayable filters, and cursor timeline form one analysis surface. */
import './DiagnosticsPage.css'

import { Alert, Button, Card, Checkbox, Input, Popover, Space, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Key } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminColumnFilter } from '../../shared/ui/AdminColumnFilter'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { StatusBadgeTone } from '../../shared/ui/StatusBadge'
import type { RelayAdminDiagnosticEvent, RelayAdminDiagnosticsResponse } from './diagnosticsApi'
import { fetchRelayAdminDiagnostics } from './diagnosticsApi'
import {
  diagnosticOutcomeTone,
  diagnosticUserLabel,
  formatDiagnosticDuration,
  formatDiagnosticTimestamp
} from './diagnosticsModel'

const PAGE_SIZE = 50

export interface DiagnosticsPageProps {
  embedded?: boolean
  token: string
  userId?: string
}

const emptyResponse: RelayAdminDiagnosticsResponse = {
  events: [],
  retention: { days: 30, maxEvents: 10_000 },
  series: [],
  summary: {
    affectedUsers: 0,
    byFailure: {},
    byFingerprint: {},
    byOutcome: {},
    byPlatform: {},
    bySource: {},
    byVersion: {},
    errorEvents: 0,
    startup: { attempts: 0 },
    total: 0
  },
  users: []
}

const toIso = (value: string | null) => {
  if (value == null || value === '') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const successRate = (value: number | undefined) => value == null ? '-' : `${(value * 100).toFixed(1)}%`

const TimeRangeColumnFilter = ({
  from,
  to,
  onFromChange,
  onToChange
}: {
  from: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  to: string
}) => {
  const [open, setOpen] = useState(false)
  return (
    <span className='relay-admin-column-filter'>
      <span className='relay-admin-column-filter__label'>发生时间</span>
      <Popover
        content={
          <div className='relay-diagnostics__time-filter'>
            <label>
              开始<Input
                aria-label='开始时间'
                type='datetime-local'
                value={from}
                onChange={event => onFromChange(event.target.value)}
              />
            </label>
            <label>
              结束<Input
                aria-label='结束时间'
                type='datetime-local'
                value={to}
                onChange={event => onToChange(event.target.value)}
              />
            </label>
          </div>
        }
        open={open}
        placement='bottomLeft'
        trigger='click'
        onOpenChange={setOpen}
      >
        <AdminActionButton
          aria-label='按发生时间过滤诊断'
          className={`relay-admin-column-filter__trigger${from !== '' || to !== '' || open ? ' is-active' : ''}`}
          iconName='filter_list'
          title='按发生时间过滤诊断'
          type='text'
        />
      </Popover>
    </span>
  )
}

const RuntimeColumnFilter = ({
  platform,
  serviceVersion,
  onPlatformChange,
  onServiceVersionChange
}: {
  onPlatformChange: (value: string) => void
  onServiceVersionChange: (value: string) => void
  platform: string
  serviceVersion: string
}) => {
  const [open, setOpen] = useState(false)
  return (
    <span className='relay-admin-column-filter'>
      <span className='relay-admin-column-filter__label'>版本 / 平台</span>
      <Popover
        content={
          <div className='relay-diagnostics__time-filter'>
            <label>
              版本<Input
                aria-label='按版本过滤诊断'
                placeholder='例如 1.2.3'
                value={serviceVersion}
                onChange={event => onServiceVersionChange(event.target.value)}
              />
            </label>
            <label>
              平台<Input
                aria-label='按平台过滤诊断'
                placeholder='例如 darwin'
                value={platform}
                onChange={event => onPlatformChange(event.target.value)}
              />
            </label>
          </div>
        }
        open={open}
        placement='bottomLeft'
        trigger='click'
        onOpenChange={setOpen}
      >
        <AdminActionButton
          aria-label='按版本或平台过滤诊断'
          className={`relay-admin-column-filter__trigger${
            platform !== '' || serviceVersion !== '' || open ? ' is-active' : ''
          }`}
          iconName='filter_list'
          title='按版本或平台过滤诊断'
          type='text'
        />
      </Popover>
    </span>
  )
}

export const DiagnosticsPage = ({ embedded = false, token, userId }: DiagnosticsPageProps) => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState(emptyResponse)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const loadSequence = useRef(0)
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
  const [visibleColumnKeys, setVisibleColumnKeys] = useState([
    'occurredAt',
    'userId',
    'source',
    'runtime',
    'event',
    'outcome',
    'durationMs',
    'errorCode',
    'errorFingerprint'
  ])
  const query = searchParams.get('q') ?? ''
  const source = searchParams.get('source') ?? ''
  const outcome = searchParams.get('outcome') ?? ''
  const category = searchParams.get('category') ?? ''
  const platform = searchParams.get('platform') ?? ''
  const serviceVersion = searchParams.get('serviceVersion') ?? ''
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
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

  const load = useCallback(async () => {
    if (token.trim() === '') return
    const sequence = ++loadSequence.current
    setLoading(true)
    setError(undefined)
    try {
      const response = await fetchRelayAdminDiagnostics(token, {
        category,
        cursor,
        from: toIso(from),
        limit: PAGE_SIZE,
        outcome,
        platform,
        q: query,
        serviceVersion,
        source,
        to: toIso(to),
        userId
      })
      if (sequence === loadSequence.current) setData(response)
    } catch (reason) {
      if (sequence === loadSequence.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [category, cursor, from, outcome, platform, query, serviceVersion, source, to, token, userId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setSelectedRowKeys([])
  }, [data.events])

  const columns = useMemo<TableColumnsType<RelayAdminDiagnosticEvent>>(() => [
    {
      dataIndex: 'occurredAt',
      key: 'occurredAt',
      render: value => formatDiagnosticTimestamp(String(value)),
      title: (
        <TimeRangeColumnFilter
          from={from}
          to={to}
          onFromChange={value => updateFilter('from', value)}
          onToChange={value => updateFilter('to', value)}
        />
      ),
      width: 170
    },
    ...(userId == null
      ? [{
        dataIndex: 'userId',
        key: 'userId',
        render: (_value: unknown, event: RelayAdminDiagnosticEvent) => (
          <Button
            type='link'
            onClick={() => navigate(`/users/${encodeURIComponent(event.userId)}/diagnostics`)}
          >
            {diagnosticUserLabel(event, data.users)}
          </Button>
        ),
        title: '用户',
        width: 150
      }]
      : []),
    {
      key: 'source',
      render: (_value, event) => (
        <div className='relay-diagnostics__source'>
          <strong>{event.source}</strong>
          <span>{event.serviceName}{event.surface == null ? '' : ` · ${event.surface}`}</span>
        </div>
      ),
      title: (
        <AdminColumnFilter<string>
          allValue=''
          ariaLabel='按诊断来源过滤'
          label='来源'
          options={[
            { label: '全部来源', value: '' },
            ...['oneworks', 'codex', 'other'].map(value => ({ label: value, value }))
          ]}
          value={source}
          onChange={value => updateFilter('source', value)}
        />
      ),
      width: 160
    },
    {
      key: 'runtime',
      render: (_value, event) => (
        <div className='relay-diagnostics__source'>
          <strong>{event.serviceVersion ?? '-'}</strong>
          <span>
            {[event.platform, event.architecture, event.releaseChannel, event.environment].filter(Boolean).join(
              ' · '
            ) || '-'}
          </span>
        </div>
      ),
      title: (
        <RuntimeColumnFilter
          platform={platform}
          serviceVersion={serviceVersion}
          onPlatformChange={value => updateFilter('platform', value)}
          onServiceVersionChange={value => updateFilter('serviceVersion', value)}
        />
      ),
      width: 170
    },
    {
      key: 'event',
      render: (_value, event) => (
        <div className='relay-diagnostics__event'>
          <strong>{event.operationName ?? event.eventName}</strong>
          <span>{event.category}{event.stage == null ? '' : ` · ${event.stage}`}</span>
        </div>
      ),
      title: (
        <AdminColumnFilter<string>
          allValue=''
          ariaLabel='按诊断类别过滤'
          label='事件 / 阶段'
          options={[
            { label: '全部类别', value: '' },
            ...['startup', 'error', 'command', 'agent', 'network', 'tool', 'auth', 'other'].map(value => ({
              label: value,
              value
            }))
          ]}
          value={category}
          onChange={value => updateFilter('category', value)}
        />
      ),
      width: 240
    },
    {
      key: 'outcome',
      render: (_value, event) => (
        <StatusBadge tone={diagnosticOutcomeTone(event) as StatusBadgeTone}>
          {event.outcome ?? event.severity.toLowerCase()}
        </StatusBadge>
      ),
      title: (
        <AdminColumnFilter<string>
          allValue=''
          ariaLabel='按诊断结果过滤'
          label='结果'
          options={[
            { label: '全部结果', value: '' },
            ...['success', 'degraded', 'error', 'timeout', 'cancelled', 'abandoned'].map(value => ({
              label: value,
              value
            }))
          ]}
          value={outcome}
          onChange={value => updateFilter('outcome', value)}
        />
      ),
      width: 100
    },
    {
      dataIndex: 'durationMs',
      key: 'durationMs',
      render: value => formatDiagnosticDuration(typeof value === 'number' ? value : undefined),
      title: '耗时',
      width: 100
    },
    {
      dataIndex: 'errorCode',
      key: 'errorCode',
      render: value => value == null ? '-' : <span className='relay-diagnostics__failure'>{String(value)}</span>,
      title: '失败码',
      width: 190
    },
    {
      dataIndex: 'errorFingerprint',
      key: 'errorFingerprint',
      render: value => value == null ? '-' : <Tag>{String(value)}</Tag>,
      title: '异常指纹',
      width: 190
    },
    {
      dataIndex: 'deviceId',
      key: 'deviceId',
      render: value => value == null ? '-' : <Tag>{String(value)}</Tag>,
      title: '设备关联',
      width: 150
    }
  ], [category, data.users, from, navigate, outcome, platform, serviceVersion, source, to, updateFilter, userId])

  const displayedColumns = columns.filter(column => {
    const key = String(column.key ?? '')
    return key === 'occurredAt' || key === 'event' || visibleColumnKeys.includes(key)
  })

  const columnOptions = [
    { label: '发生时间', value: 'occurredAt', disabled: true },
    ...(userId == null ? [{ label: '用户', value: 'userId' }] : []),
    { label: '来源', value: 'source' },
    { label: '版本 / 平台', value: 'runtime' },
    { label: '事件 / 阶段', value: 'event', disabled: true },
    { label: '结果', value: 'outcome' },
    { label: '耗时', value: 'durationMs' },
    { label: '失败码', value: 'errorCode' },
    { label: '异常指纹', value: 'errorFingerprint' },
    { label: '设备关联', value: 'deviceId' }
  ]

  const exportSelected = () => {
    const selected = data.events.filter(event => selectedRowKeys.includes(event.id))
    const objectUrl = URL.createObjectURL(
      new Blob([`${JSON.stringify(selected, null, 2)}\n`], {
        type: 'application/json'
      })
    )
    const anchor = document.createElement('a')
    anchor.download = `oneworks-diagnostics-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`
    anchor.href = objectUrl
    anchor.click()
    URL.revokeObjectURL(objectUrl)
  }

  const topFailures = Object.entries(data.summary.byFailure)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([code, count]) => `${code} (${count})`)
    .join('、') || '暂无失败'
  const topFingerprints = Object.entries(data.summary.byFingerprint)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([fingerprint, count]) => `${fingerprint} (${count})`)
    .join('、') || topFailures
  const versions = Object.entries(data.summary.byVersion).sort((left, right) => right[1] - left[1])
  const platforms = Object.entries(data.summary.byPlatform).sort((left, right) => right[1] - left[1])
  const runtimeCoverage = [versions[0]?.[0], platforms[0]?.[0]].filter(Boolean).join(' · ') || '暂无运行维度'

  const changeCursor = (nextCursor: string) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current)
      if (nextCursor === '') next.delete('cursor')
      else next.set('cursor', nextCursor)
      return next
    })
  }

  return (
    <section className={`relay-diagnostics${embedded ? ' relay-diagnostics--embedded' : ''}`}>
      {error == null ? null : <Alert message={error} showIcon type='error' />}
      <div className='relay-diagnostics__summary'>
        {[
          ['诊断事件', String(data.summary.total), `影响 ${data.summary.affectedUsers} 位用户`],
          ['异常事件', String(data.summary.errorEvents), topFingerprints],
          ['覆盖版本', String(versions.length), runtimeCoverage],
          ['启动成功率', successRate(data.summary.startup.successRate), `${data.summary.startup.attempts} 次启动`],
          ['启动 P50', formatDiagnosticDuration(data.summary.startup.p50DurationMs), '典型用户等待'],
          ['启动 P95', formatDiagnosticDuration(data.summary.startup.p95DurationMs), '长尾用户等待']
        ].map(([label, value, hint]) => (
          <Card className='relay-diagnostics__metric' key={label} size='small'>
            <span className='relay-diagnostics__metric-label'>{label}</span>
            <strong className='relay-diagnostics__metric-value'>{value}</strong>
            <span className='relay-diagnostics__metric-hint' title={hint}>{hint}</span>
          </Card>
        ))}
      </div>

      <div className='relay-diagnostics__toolbar'>
        <Input
          allowClear
          placeholder='搜索事件、阶段、失败码、异常指纹、服务'
          prefix={<AdminIcon name='search' />}
          value={query}
          onChange={event => updateFilter('q', event.target.value)}
        />
        <Space>
          <Button icon={<AdminIcon name='refresh' />} loading={loading} onClick={() => void load()}>刷新</Button>
          <Popover
            content={
              <Checkbox.Group
                options={columnOptions}
                value={visibleColumnKeys}
                onChange={keys => setVisibleColumnKeys(['occurredAt', 'event', ...keys.map(String)])}
              />
            }
            placement='bottomRight'
            trigger='click'
          >
            <AdminActionButton
              aria-label='配置诊断展示列'
              iconName='view_week'
              title='配置诊断展示列'
              type='text'
            />
          </Popover>
        </Space>
      </div>

      {selectedRowKeys.length === 0 ? null : (
        <div className='relay-diagnostics__batch'>
          <span>已选 {selectedRowKeys.length}</span>
          <Button onClick={exportSelected}>导出所选安全事实</Button>
        </div>
      )}

      <Card className='relay-diagnostics__table-card' size='small'>
        <Table
          columns={displayedColumns}
          dataSource={data.events}
          loading={loading}
          locale={{ emptyText: '当前筛选条件下没有诊断事件' }}
          pagination={false}
          rowKey='id'
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          scroll={{ x: 'max-content' }}
          size='middle'
        />
        <div className='relay-diagnostics__footer'>
          <span className='relay-diagnostics__retention'>
            保留 {data.retention.days} 天，最多 {data.retention.maxEvents.toLocaleString()}{' '}
            条；不包含提示词、凭据和原始日志
          </span>
          <Space>
            <Button
              disabled={cursor === ''}
              onClick={() => {
                const previous = [...cursorHistory]
                const previousCursor = previous.pop() ?? ''
                setCursorHistory(previous)
                changeCursor(previousCursor)
              }}
            >
              上一页
            </Button>
            <Button
              disabled={data.nextCursor == null}
              onClick={() => {
                setCursorHistory(current => [...current, cursor])
                changeCursor(data.nextCursor ?? '')
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
