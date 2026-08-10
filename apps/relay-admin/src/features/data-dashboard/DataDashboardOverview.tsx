import { Alert, Button, Card, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { DailyActivityHeatmap } from './@components/DailyActivityHeatmap'
import { createDailyActivityHeatmapDays } from './@core/daily-activity-heatmap'
import type { DailyActivityDateRange } from './@core/daily-activity-heatmap'
import type { RelayDataDashboardOverview } from './dataDashboardApi'
import { fetchRelayDataDashboardOverview } from './dataDashboardApi'

const compactNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1, notation: 'compact' })

const formatPercent = (value: number | undefined) => (
  value == null ? '-' : `${(value * 100).toFixed(1)}%`
)

const DataMetric = ({ hint, label, value }: { hint: string; label: string; value: string }) => (
  <Card className='relay-data-dashboard__metric' size='small'>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{hint}</small>
  </Card>
)

export interface DataDashboardOverviewProps {
  onOpenDimension: (dimension: 'model-service' | 'stability') => void
  token: string
}

export const DataDashboardOverview = ({ onOpenDimension, token }: DataDashboardOverviewProps) => {
  const [data, setData] = useState<RelayDataDashboardOverview>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState<DailyActivityDateRange>()
  const loadSequence = useRef(0)
  const load = useCallback(async () => {
    if (token.trim() === '') return
    const sequence = ++loadSequence.current
    setLoading(true)
    setError(undefined)
    try {
      const response = await fetchRelayDataDashboardOverview(token)
      if (sequence === loadSequence.current) setData(response)
    } catch (reason) {
      if (sequence === loadSequence.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const diagnosticSummary = data?.monthly.summary
  const usageSummary = data?.modelUsage.summary
  const activeTeams = Object.keys(usageSummary?.byTeam ?? {}).length
  const availableActivityDays = Math.min(30, data?.monthly.retention.days ?? 30)
  const activityDays = useMemo(() =>
    data == null
      ? []
      : createDailyActivityHeatmapDays(
        data.monthly.series,
        new Date(data.observedAt),
        availableActivityDays
      ), [data])
  const latestDate = activityDays.at(-1)?.date

  return (
    <Spin spinning={loading && data == null} wrapperClassName='relay-data-dashboard__overview-spinner'>
      <section className='relay-data-dashboard__overview' aria-label='运营概览'>
        {error == null ? null : <Alert message={error} showIcon type='error' />}
        <div className='relay-data-dashboard__overview-actions'>
          <span>统计窗口按 UTC 自然日计算</span>
          <AdminActionButton
            aria-label='刷新数据看板'
            disabled={loading}
            iconName='refresh'
            title='刷新数据看板'
            onClick={() => void load()}
          />
        </div>

        <div className='relay-data-dashboard__metrics'>
          <DataMetric
            hint='今日已授权并上报'
            label='观测 DAU'
            value={String(data?.daily.summary.affectedUsers ?? 0)}
          />
          <DataMetric
            hint='近 7 日去重用户'
            label='观测 WAU'
            value={String(data?.weekly.summary.affectedUsers ?? 0)}
          />
          <DataMetric
            hint='近 30 日去重用户'
            label='观测 MAU'
            value={String(diagnosticSummary?.affectedUsers ?? 0)}
          />
          <DataMetric hint='近 30 日有团队用量' label='活跃团队' value={String(activeTeams)} />
          <DataMetric
            hint={`${diagnosticSummary?.startup.attempts ?? 0} 次观测启动`}
            label='启动成功率'
            value={formatPercent(diagnosticSummary?.startup.successRate)}
          />
          <DataMetric
            hint='近 30 日团队 Model Service'
            label='模型请求'
            value={compactNumber.format(usageSummary?.requests ?? 0)}
          />
        </div>

        <Card className='relay-data-dashboard__trend-card' size='small'>
          <div className='relay-data-dashboard__card-title'>
            <span>
              <AdminIcon name='group' />
              <strong>每日观测活跃用户</strong>
            </span>
            <small>
              最近一年 · 可观测 {availableActivityDays} 日
              {latestDate == null ? null : ` · 更新至 ${latestDate}`}
            </small>
          </div>
          <DailyActivityHeatmap
            days={activityDays}
            locale='zh-CN'
            selection={selection}
            onSelectionChange={setSelection}
          />
        </Card>

        <div className='relay-data-dashboard__dimensions'>
          <Card className='relay-data-dashboard__dimension-card' size='small'>
            <div className='relay-data-dashboard__card-title'>
              <span>
                <AdminIcon name='monitor_heart' />
                <strong>稳定性</strong>
              </span>
              <Button type='link' onClick={() => onOpenDimension('stability')}>查看维度</Button>
            </div>
            <div className='relay-data-dashboard__dimension-values'>
              <span>
                <strong>{compactNumber.format(diagnosticSummary?.total ?? 0)}</strong>
                <small>诊断事件</small>
              </span>
              <span>
                <strong>{compactNumber.format(diagnosticSummary?.errorEvents ?? 0)}</strong>
                <small>异常事件</small>
              </span>
              <span>
                <strong>
                  {diagnosticSummary?.byVersion == null
                    ? 0
                    : Object.keys(diagnosticSummary.byVersion).length}
                </strong>
                <small>覆盖版本</small>
              </span>
            </div>
          </Card>
          <Card className='relay-data-dashboard__dimension-card' size='small'>
            <div className='relay-data-dashboard__card-title'>
              <span>
                <AdminIcon name='hub' />
                <strong>Model Service</strong>
              </span>
              <Button type='link' onClick={() => onOpenDimension('model-service')}>查看维度</Button>
            </div>
            <div className='relay-data-dashboard__dimension-values'>
              <span>
                <strong>{compactNumber.format(usageSummary?.activeUsers ?? 0)}</strong>
                <small>活跃成员</small>
              </span>
              <span>
                <strong>{compactNumber.format(usageSummary?.totalTokens ?? 0)}</strong>
                <small>总 Token</small>
              </span>
              <span>
                <strong>
                  {usageSummary?.byModelService == null
                    ? 0
                    : Object.keys(usageSummary.byModelService).length}
                </strong>
                <small>服务数量</small>
              </span>
            </div>
          </Card>
        </div>

        <p className='relay-data-dashboard__coverage-note'>
          观测活跃指标仅包含已授权并成功上报的数据，用于趋势判断，不代表关闭上报后的完整平台活跃人数。
        </p>
      </section>
    </Spin>
  )
}
