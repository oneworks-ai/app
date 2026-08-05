import { Tag, Tooltip } from 'antd'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { projectPluginPresentationValue } from '#~/plugins/plugin-presentation'

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
        : diagnostics.map((diagnostic, index) => {
          const level = diagnostic.level === 'error' || diagnostic.level === 'warning'
            ? diagnostic.level
            : 'info'
          return (
            <div key={`${diagnostic.message}:${index}`} className='plugin-detail-route__diagnostic'>
              <Tag
                color={level === 'error'
                  ? 'error'
                  : level === 'warning'
                  ? 'warning'
                  : undefined}
              >
                {level}
              </Tag>
              <span>{projectPluginPresentationValue(diagnostic.message)}</span>
            </div>
          )
        })}
    </section>
  )
}
