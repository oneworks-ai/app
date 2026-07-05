import { Alert, Descriptions, Empty, Spin } from 'antd'
import type { DescriptionsProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AdminActionButton } from '../../shared/ui/AdminActionButton'
import { useTeamDetailTabActions } from './TeamDetailTabActions'
import type { RelayAdminTeam, RelayAdminTeamDocumentSnapshot } from './teamTypes'
import { fetchRelayAdminTeamDocuments } from './teamsApi'

export interface TeamDocumentsProps {
  disabled: boolean
  team?: RelayAdminTeam
  token: string
}

const formatTimestamp = (value: string | null | undefined) => {
  if (value == null || value === '') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const formatByteSize = (value: number | null | undefined) => {
  const size = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  if (size < 1024) return `${size} B`
  const kib = size / 1024
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KB`
  const mib = kib / 1024
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`
}

const documentItems = (snapshot: RelayAdminTeamDocumentSnapshot): DescriptionsProps['items'] => [
  {
    children: `${snapshot.documentCount} 个 / ${formatByteSize(snapshot.totalSizeBytes)}`,
    key: 'summary',
    label: '同步文档'
  },
  {
    children: `AGENTS ${snapshot.countsByKind.agents}`,
    key: 'counts',
    label: '文档类型'
  },
  {
    children: formatTimestamp(snapshot.updatedAt),
    key: 'updatedAt',
    label: '更新时间'
  },
  {
    children: snapshot.updatedByUserId ?? '-',
    key: 'updatedByUserId',
    label: '更新账号'
  },
  {
    children: snapshot.hash,
    key: 'hash',
    label: '快照 Hash'
  },
  {
    children: snapshot.teamId,
    key: 'teamId',
    label: '团队 ID'
  }
]

export const TeamDocuments = ({ disabled, team, token }: TeamDocumentsProps) => {
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<RelayAdminTeamDocumentSnapshot | null>(null)
  const refreshDocuments = useCallback(() => setRevision(value => value + 1), [])
  const actions = useMemo(
    () => (
      <AdminActionButton
        aria-label='刷新团队同步文档'
        disabled={disabled || loading}
        iconName='refresh'
        size='small'
        title='刷新'
        tooltip='刷新团队同步文档'
        type='text'
        onClick={refreshDocuments}
      />
    ),
    [disabled, loading, refreshDocuments]
  )

  useTeamDetailTabActions('documents', actions)

  useEffect(() => {
    let active = true
    if (team == null || token.trim() === '') {
      setSnapshot(null)
      setError(undefined)
      return
    }
    setLoading(true)
    setError(undefined)
    void fetchRelayAdminTeamDocuments(token, team.id)
      .then(body => {
        if (!active) return
        setSnapshot(body.teamDocumentSnapshot)
      })
      .catch(reason => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setSnapshot(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [revision, team, token])

  if (team == null) {
    return <Empty className='relay-team-panel__empty' description='团队不存在' />
  }

  return (
    <section className='relay-team-panel__documents'>
      {error == null ? null : <Alert showIcon message='团队同步文档加载失败' description={error} type='error' />}
      {loading ? <Spin size='small' /> : null}
      {snapshot == null && !loading
        ? <Empty className='relay-team-panel__empty' description='暂无团队同步文档' />
        : null}
      {snapshot == null
        ? null
        : (
          <Descriptions
            bordered
            className='relay-team-panel__descriptions'
            column={{ lg: 2, md: 1, sm: 1, xl: 2, xs: 1, xxl: 2 }}
            items={documentItems(snapshot)}
            size='small'
          />
        )}
    </section>
  )
}
