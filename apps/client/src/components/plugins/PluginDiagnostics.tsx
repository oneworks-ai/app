import { Tag, Tooltip } from 'antd'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

export interface PluginDetailDiagnostic {
  level: 'error' | 'warning' | 'info'
  message: string
}

interface PluginDiagnosticsProps {
  diagnostics: PluginDetailDiagnostic[]
  emptyText: string
  title: string
}

export function PluginDiagnostics({ diagnostics, emptyText, title }: PluginDiagnosticsProps) {
  return (
    <section className='plugin-detail-route__diagnostics'>
      <div className='plugin-detail-route__title-row'>
        <div className='plugin-detail-route__title-main'>
          <MaterialSymbol name='info' aria-hidden='true' />
          <h2>{title}</h2>
        </div>
        {diagnostics.length > 0 && (
          <Tooltip title={`${title}: ${diagnostics.length}`}>
            <span className='plugin-detail-route__diagnostic-count' aria-label={`${title}: ${diagnostics.length}`}>
              <MaterialSymbol name='bug_report' aria-hidden='true' />
              <span>{diagnostics.length}</span>
            </span>
          </Tooltip>
        )}
      </div>
      {diagnostics.length === 0
        ? (
          <Tooltip title={emptyText}>
            <p className='plugin-detail-route__diagnostics-empty' aria-label={emptyText}>
              <MaterialSymbol name='check' aria-hidden='true' />
              <span>{emptyText}</span>
            </p>
          </Tooltip>
        )
        : diagnostics.map((diagnostic, index) => (
          <div key={`${diagnostic.message}:${index}`} className='plugin-detail-route__diagnostic'>
            <Tag
              color={diagnostic.level === 'error'
                ? 'error'
                : diagnostic.level === 'warning'
                ? 'warning'
                : undefined}
            >
              {diagnostic.level}
            </Tag>
            <span>{diagnostic.message}</span>
          </div>
        ))}
    </section>
  )
}
