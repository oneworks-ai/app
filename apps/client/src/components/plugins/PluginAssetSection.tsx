import { Alert, Skeleton, Tag } from 'antd'

import { MarkdownContent } from '#~/components/MarkdownContent'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type { PluginDetailAssetGroup } from '#~/plugins/api'

interface PluginAssetSectionProps {
  emptyText: string
  error?: string
  group?: PluginDetailAssetGroup
  loading: boolean
  title: string
}

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function PluginAssetSection({ emptyText, error, group, loading, title }: PluginAssetSectionProps) {
  const files = group?.files ?? []

  return (
    <section className='plugin-detail-route__section plugin-detail-route__asset-section'>
      {loading
        ? <Skeleton active paragraph={{ rows: 5 }} title={false} />
        : error != null
        ? <Alert type='warning' showIcon message={error} />
        : files.length === 0
        ? <p className='plugin-detail-route__empty'>{emptyText}</p>
        : (
          <div className='plugin-detail-route__asset-list' aria-label={title}>
            {files.map(file => (
              <article key={file.path} className='plugin-detail-route__asset-file'>
                <div className='plugin-detail-route__asset-file-header'>
                  <div className='plugin-detail-route__asset-file-title'>
                    <MaterialSymbol name={file.contentKind === 'markdown' ? 'article' : 'code_blocks'} />
                    <span>{file.path}</span>
                  </div>
                  <div className='plugin-detail-route__asset-file-meta'>
                    <Tag>{file.contentKind}</Tag>
                    <Tag>{formatBytes(file.size)}</Tag>
                  </div>
                </div>
                {file.content == null
                  ? <p className='plugin-detail-route__asset-empty'>{emptyText}</p>
                  : file.contentKind === 'markdown'
                  ? (
                    <div className='plugin-detail-route__asset-markdown markdown-body'>
                      <MarkdownContent content={file.content} openLinksInNewTab />
                    </div>
                  )
                  : <pre className='plugin-detail-route__asset-code'>{file.content}</pre>}
              </article>
            ))}
          </div>
        )}
    </section>
  )
}
