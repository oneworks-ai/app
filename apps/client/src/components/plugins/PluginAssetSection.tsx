import { Alert, Skeleton, Tag } from 'antd'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import {
  PRIVATE_PLUGIN_PRESENTATION_VALUE,
  projectPluginPresentationValue,
  sanitizePluginPresentationData
} from '#~/plugins/plugin-presentation'
import type { PluginDetailAssetFile } from '@oneworks/types'

import { SafePluginMarkdownContent } from './SafePluginMarkdownContent'

interface PluginAssetSectionProps {
  emptyText: string
  error?: string
  group?: { files: PluginDetailAssetFile[] }
  icon?: string
  loading: boolean
  showHeading?: boolean
  title: string
}

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function PluginAssetSection({
  emptyText,
  error,
  group,
  icon,
  loading,
  showHeading = false,
  title
}: PluginAssetSectionProps) {
  const projectedFiles = sanitizePluginPresentationData(group?.files ?? [])
  const files = Array.isArray(projectedFiles)
    ? projectedFiles.map((file): PluginDetailAssetFile => (
      file != null && typeof file === 'object' && !Array.isArray(file)
        ? file as PluginDetailAssetFile
        : {
          content: PRIVATE_PLUGIN_PRESENTATION_VALUE,
          contentKind: 'text',
          path: PRIVATE_PLUGIN_PRESENTATION_VALUE,
          size: 0
        }
    ))
    : []

  return (
    <section className='plugin-detail-route__section plugin-detail-route__asset-section'>
      {showHeading && (
        <div className='plugin-detail-route__asset-group-header'>
          {icon != null && <MaterialSymbol name={icon} aria-hidden='true' />}
          <h2>{title}</h2>
        </div>
      )}
      {loading
        ? <Skeleton active paragraph={{ rows: 5 }} title={false} />
        : error != null
        ? <Alert type='warning' showIcon message={projectPluginPresentationValue(error)} />
        : files.length === 0
        ? <p className='plugin-detail-route__empty'>{emptyText}</p>
        : (
          <div className='plugin-detail-route__asset-list' aria-label={title}>
            {files.map((file, index) => (
              <article key={`${file.path}:${index}`} className='plugin-detail-route__asset-file'>
                <div className='plugin-detail-route__asset-file-header'>
                  <div className='plugin-detail-route__asset-file-title'>
                    <MaterialSymbol name={file.contentKind === 'markdown' ? 'article' : 'code_blocks'} />
                    <span>{projectPluginPresentationValue(file.path)}</span>
                  </div>
                  <div className='plugin-detail-route__asset-file-meta'>
                    <Tag>{file.contentKind}</Tag>
                    <Tag>{formatBytes(file.size)}</Tag>
                  </div>
                </div>
                {file.content == null
                  ? file.contentKind === 'binary'
                    ? null
                    : <p className='plugin-detail-route__asset-empty'>{emptyText}</p>
                  : file.contentKind === 'markdown'
                  ? (
                    <div className='plugin-detail-route__asset-markdown markdown-body'>
                      <SafePluginMarkdownContent content={file.content} />
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
