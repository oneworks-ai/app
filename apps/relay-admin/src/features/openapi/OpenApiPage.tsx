/* eslint-disable max-lines -- OpenAPI page keeps document fetching, table model, and JSON actions together. */
import './OpenApiPage.css'

import { Alert, Button, Empty, Segmented, Space, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { canManageRelayAdmin } from '../../shared/model/adminPermissions'
import type { RelayAdminCurrentUser } from '../../shared/model/adminTypes'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { DataPanel } from '../../shared/ui/DataPanel'

type OpenApiDocumentKey = 'admin' | 'profile'

interface OpenApiDocument {
  components?: {
    schemas?: Record<string, unknown>
  }
  info?: {
    description?: string
    title?: string
    version?: string
  }
  openapi?: string
  paths?: Record<string, Record<string, OpenApiOperation>>
  servers?: Array<{ url?: string }>
}

interface OpenApiOperation {
  operationId?: string
  responses?: Record<string, unknown>
  security?: unknown
  summary?: string
  tags?: string[]
}

interface OpenApiSpecDefinition {
  description: string
  key: OpenApiDocumentKey
  label: string
  path: string
}

interface OpenApiOperationRow {
  auth: boolean
  key: string
  method: string
  operationId: string
  path: string
  summary: string
  tag: string
}

export interface OpenApiPageProps {
  currentUser?: RelayAdminCurrentUser
}

const httpMethods = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'] as const

const specDefinitions = [
  {
    description: '当前账号、系统访问令牌、用户团队与托管配置 API。',
    key: 'profile',
    label: '个人用户 API',
    path: '/api/profile/openapi.json'
  },
  {
    description: '平台用户、邀请、SSO、团队、消息、配置与观测 API。',
    key: 'admin',
    label: '平台管理员 API',
    path: '/api/admin/openapi.json'
  }
] satisfies OpenApiSpecDefinition[]

const methodTone = (method: string) => {
  if (method === 'get') return 'blue'
  if (method === 'post') return 'green'
  if (method === 'patch' || method === 'put') return 'orange'
  if (method === 'delete') return 'red'
  return 'default'
}

const parseJson = async (response: Response) => {
  const body = await response.json().catch(() => ({})) as unknown
  return body != null && typeof body === 'object' ? body as Record<string, unknown> : {}
}

const fetchOpenApiDocument = async (path: string) => {
  const response = await fetch(path)
  const body = await parseJson(response)
  if (!response.ok) {
    const error = typeof body.error === 'string' && body.error.trim() !== ''
      ? body.error.trim()
      : `OpenAPI request failed with ${response.status}.`
    throw new Error(error)
  }
  return body as OpenApiDocument
}

const buildOperationRows = (document: OpenApiDocument | undefined) => {
  const paths = document?.paths ?? {}
  return Object.entries(paths)
    .flatMap(([path, pathItem]) =>
      httpMethods.flatMap(method => {
        const operation = pathItem[method]
        if (operation == null) return []
        const tag = operation.tags?.[0] ?? 'API'
        return [
          {
            auth: operation.security != null,
            key: `${method}:${path}`,
            method,
            operationId: operation.operationId ?? '-',
            path,
            summary: operation.summary ?? '',
            tag
          } satisfies OpenApiOperationRow
        ]
      })
    )
    .sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))
}

const documentStats = (document: OpenApiDocument | undefined, rows: OpenApiOperationRow[]) => ({
  operations: rows.length,
  paths: Object.keys(document?.paths ?? {}).length,
  schemas: Object.keys(document?.components?.schemas ?? {}).length,
  version: document?.info?.version ?? '-'
})

const segmentLabel = (iconName: 'admin_panel_settings' | 'person', label: string) => (
  <span className='relay-openapi-page__segment-label'>
    <AdminIcon name={iconName} />
    <span>{label}</span>
  </span>
)

const openSpec = (path: string) => {
  window.open(path, '_blank', 'noopener,noreferrer')
}

const downloadSpec = (definition: OpenApiSpecDefinition, document: OpenApiDocument | undefined) => {
  if (document == null) return
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
  const url = window.URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = `${definition.key}-openapi.json`
  anchor.click()
  window.URL.revokeObjectURL(url)
}

export const OpenApiPage = ({ currentUser }: OpenApiPageProps) => {
  const [activeSpecKey, setActiveSpecKey] = useState<OpenApiDocumentKey>('profile')
  const [documents, setDocuments] = useState<Partial<Record<OpenApiDocumentKey, OpenApiDocument>>>({})
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const canReadAdminApi = canManageRelayAdmin(currentUser?.role)
  const activeSpec = specDefinitions.find(item => item.key === activeSpecKey) ?? specDefinitions[0]
  const activeDocument = documents[activeSpec.key]
  const rows = useMemo(() => buildOperationRows(activeDocument), [activeDocument])
  const stats = documentStats(activeDocument, rows)

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const entries = await Promise.all(
        specDefinitions.map(async definition => [definition.key, await fetchOpenApiDocument(definition.path)] as const)
      )
      setDocuments(Object.fromEntries(entries))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'OpenAPI 文档加载失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

  const columns = useMemo<TableColumnsType<OpenApiOperationRow>>(() => [
    {
      dataIndex: 'method',
      key: 'method',
      render: value => <Tag color={methodTone(String(value))}>{String(value).toUpperCase()}</Tag>,
      title: '方法',
      width: 96
    },
    {
      dataIndex: 'path',
      key: 'path',
      render: value => <code className='relay-openapi-page__path'>{String(value)}</code>,
      title: 'Endpoint',
      width: 320
    },
    {
      dataIndex: 'tag',
      key: 'tag',
      render: value => <Tag>{String(value)}</Tag>,
      title: '分类',
      width: 170
    },
    {
      dataIndex: 'summary',
      key: 'summary',
      title: '说明'
    },
    {
      dataIndex: 'auth',
      key: 'auth',
      render: value => value === true ? <Tag color='gold'>Bearer</Tag> : <Tag>Public</Tag>,
      title: '鉴权',
      width: 104
    },
    {
      dataIndex: 'operationId',
      key: 'operationId',
      render: value => <code className='relay-openapi-page__operation-id'>{String(value)}</code>,
      title: 'operationId',
      width: 260
    }
  ], [])

  const actions: ReactNode = (
    <Space size={8} wrap>
      <Button
        disabled={activeDocument == null}
        icon={<AdminIcon name='link' />}
        size='small'
        onClick={() => openSpec(activeSpec.path)}
      >
        打开 JSON
      </Button>
      <Button
        disabled={activeDocument == null}
        icon={<AdminIcon name='archive' />}
        size='small'
        onClick={() => downloadSpec(activeSpec, activeDocument)}
      >
        下载
      </Button>
      <Button
        icon={<AdminIcon name='refresh' />}
        loading={loading}
        size='small'
        onClick={() => void loadDocuments()}
      >
        刷新
      </Button>
    </Space>
  )

  return (
    <DataPanel actions={actions} id='openapi' title='API 文档' count={rows.length}>
      <div className='relay-openapi-page'>
        <div className='relay-openapi-page__toolbar'>
          <Segmented
            className='relay-openapi-page__segments'
            options={[
              {
                label: segmentLabel('person', '个人用户 API'),
                value: 'profile'
              },
              {
                label: segmentLabel('admin_panel_settings', '平台管理员 API'),
                value: 'admin'
              }
            ]}
            value={activeSpecKey}
            onChange={value => setActiveSpecKey(value as OpenApiDocumentKey)}
          />
          <div className='relay-openapi-page__scope'>
            {activeSpec.key === 'admin' && !canReadAdminApi
              ? <Tag color='gold'>需要管理员权限</Tag>
              : <Tag color='green'>当前账号可读</Tag>}
          </div>
        </div>

        {error == null ? null : <Alert message={error} type='error' showIcon />}

        <div className='relay-openapi-page__summary'>
          <div className='relay-openapi-page__stat'>
            <span>版本</span>
            <strong>{stats.version}</strong>
          </div>
          <div className='relay-openapi-page__stat'>
            <span>Paths</span>
            <strong>{stats.paths}</strong>
          </div>
          <div className='relay-openapi-page__stat'>
            <span>Operations</span>
            <strong>{stats.operations}</strong>
          </div>
          <div className='relay-openapi-page__stat'>
            <span>Schemas</span>
            <strong>{stats.schemas}</strong>
          </div>
        </div>

        <div className='relay-openapi-page__intro'>
          <strong>{activeDocument?.info?.title ?? activeSpec.label}</strong>
          <span>{activeDocument?.info?.description ?? activeSpec.description}</span>
        </div>

        {activeDocument == null && !loading
          ? <Empty className='relay-openapi-page__empty' description='暂无 OpenAPI 文档' />
          : (
            <Table
              className='relay-admin-table relay-openapi-page__table'
              columns={columns}
              dataSource={rows}
              loading={loading}
              pagination={false}
              scroll={{ x: 1040 }}
              size='small'
            />
          )}
      </div>
    </DataPanel>
  )
}
