import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ModelServiceConfig } from '@oneworks/types'

import { ModelServiceProviderPlanSummary } from '#~/components/config/ModelServiceProviderPlanSummary'
import type { TranslationFn } from '#~/components/config/configUtils'

const messages: Record<string, string> = {
  'config.modelServices.plan.duration.hours': '{{count}} 小时',
  'config.modelServices.plan.labels.liveQuota': '实时额度',
  'config.modelServices.plan.labels.periodQuota': '周期额度',
  'config.modelServices.plan.labels.window': '窗口',
  'config.modelServices.plan.liveQuota.failed': '查询失败',
  'config.modelServices.plan.liveQuota.loading': '查询中…',
  'config.modelServices.plan.quotaProgress.percentValue': '{{value}}%',
  'config.modelServices.plan.quotaProgress.resetAt': '{{time}} 重置',
  'config.modelServices.plan.quotaProgress.weekly': '1 周额度',
  'config.modelServices.plan.quotaProgress.window': '{{duration}}额度',
  'config.modelServices.plan.quotaUnit.request': '请求数',
  'config.modelServices.plan.quotaWindow.5h': '5 小时',
  'config.modelServices.results.amountUnknown': '未知',
  'config.modelServices.results.balance': '余额',
  'config.modelServices.results.quota': '额度',
  'config.modelServices.results.unlimitedQuota': '无限额度'
}

const t: TranslationFn = (key, options) => {
  const template = messages[key] ?? options?.defaultValue ?? key
  return template.replace(/\{\{([^}]+)\}\}/gu, (_, name: string) => String(options?.[name] ?? ''))
}

const kimiCodeService: ModelServiceConfig = {
  apiKey: 'secret',
  billing: {
    allowedUse: 'coding_tools_only',
    keyKind: 'coding_plan_key',
    kind: 'coding_plan',
    quotaUnit: 'percent',
    quotaWindows: ['5h', 'weekly']
  },
  codingPlan: { supported: true },
  provider: 'kimi-code'
}

const kimiApiService: ModelServiceConfig = {
  apiKey: 'secret',
  provider: 'moonshot-intl'
}

const micuService: ModelServiceConfig = {
  apiKey: 'secret',
  provider: 'micu'
}

describe('model service provider plan summary', () => {
  it('keeps the expected quota rows while loading', () => {
    const html = renderToStaticMarkup(
      <ModelServiceProviderPlanSummary
        t={t}
        service={kimiCodeService}
        canQueryBalance
      />
    )

    expect(html).toContain('1 周额度')
    expect(html).toContain('5 小时额度')
    expect(html).toContain('查询中…')
    expect(html.match(/config-view__model-service-quota-row/gu)).toHaveLength(2)
  })

  it('keeps the expected quota rows when querying fails', () => {
    const html = renderToStaticMarkup(
      <ModelServiceProviderPlanSummary
        t={t}
        service={kimiCodeService}
        accountError={t('config.modelServices.plan.liveQuota.failed')}
        canQueryBalance
      />
    )

    expect(html).toContain('1 周额度')
    expect(html).toContain('5 小时额度')
    expect(html).toContain('查询失败')
    expect(html.match(/config-view__model-service-quota-row/gu)).toHaveLength(2)
  })

  it('renders the period quota and each rolling window as separate progress rows', () => {
    const html = renderToStaticMarkup(
      <ModelServiceProviderPlanSummary
        t={t}
        service={kimiCodeService}
        accountStatus={{
          kind: 'quota',
          limit: 100,
          remaining: 99,
          resetTime: 'weekly-reset',
          unit: 'percent',
          windows: [
            {
              duration: 300,
              limit: 100,
              remaining: 98,
              resetTime: 'five-hour-reset',
              timeUnit: 'minute'
            }
          ]
        }}
      />
    )

    expect(html).toContain('1 周额度')
    expect(html).toContain('99%')
    expect(html).toContain('weekly-reset 重置')
    expect(html).toContain('5 小时额度')
    expect(html).toContain('98%')
    expect(html).toContain('five-hour-reset 重置')
    expect(html.match(/role="progressbar"/gu)).toHaveLength(2)
    expect(html).toContain('aria-valuenow="99"')
    expect(html).toContain('aria-valuenow="98"')
    expect(html).toContain('width:99%')
    expect(html).toContain('width:98%')
    expect(html.indexOf('5 小时额度')).toBeLessThan(html.indexOf('1 周额度'))
  })

  it('renders regular Kimi API balance in the same summary area', () => {
    const html = renderToStaticMarkup(
      <ModelServiceProviderPlanSummary
        t={t}
        service={kimiApiService}
        accountStatus={{
          available: 12.34,
          currency: 'USD',
          kind: 'balance'
        }}
        canQueryBalance
      />
    )

    expect(html).toContain('config-view__model-service-plan')
    expect(html).toContain('余额')
    expect(html).toContain('12.34 $')
    expect(html.match(/config-view__model-service-quota-row/gu)).toHaveLength(1)
    expect(html).not.toContain('config-view__model-service-quota-progress')
    expect(html).not.toContain('role="progressbar"')
  })

  it('labels regular Kimi API balance loading as balance', () => {
    const html = renderToStaticMarkup(
      <ModelServiceProviderPlanSummary
        t={t}
        service={kimiApiService}
        canQueryBalance
      />
    )

    expect(html).toContain('余额')
    expect(html).toContain('查询中…')
  })

  it('renders Micu unlimited token usage without a progress bar', () => {
    const html = renderToStaticMarkup(
      <ModelServiceProviderPlanSummary
        t={t}
        service={micuService}
        accountStatus={{
          kind: 'quota',
          unlimited: true
        }}
        canQueryBalance
      />
    )

    expect(html).toContain('额度')
    expect(html).toContain('无限额度')
    expect(html).not.toContain('config-view__model-service-quota-progress')
    expect(html).not.toContain('role="progressbar"')
  })
})
