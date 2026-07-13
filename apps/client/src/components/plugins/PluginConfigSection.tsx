/* eslint-disable max-lines -- plugin config editor coordinates schema rendering, autosave, and raw fallback. */
import { App, Empty } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SchemaObjectEditor } from '#~/components/config/record-editors/SchemaObjectEditor'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { setPluginOptions } from '#~/plugins/api'
import { usePluginContext } from '#~/plugins/plugin-context'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

import { buildPluginConfigUiSchema } from './plugin-config-json-schema'

interface PluginConfigSectionProps {
  labels: {
    instance: string
    manifest: string
    noSchema: string
    options: string
    saved: string
    saveFailed: string
    saving: string
  }
  onOptionsChange?: () => void | Promise<void>
  plugin: PluginRuntimeInstance
}

type SaveStatus = 'error' | 'idle' | 'pending' | 'saved' | 'saving'

const toJson = (value: unknown) => JSON.stringify(value, null, 2)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeOptions = (value: unknown): Record<string, unknown> => (
  isRecord(value) ? value : {}
)

const cleanOptionValue = (value: unknown): unknown => {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value.map(cleanOptionValue).filter(item => item !== undefined)
  if (!isRecord(value)) return value

  const entries = Object.entries(value)
    .map(([key, item]) => [key, cleanOptionValue(item)] as const)
    .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined)
  return Object.fromEntries(entries)
}

const cleanOptions = (value: Record<string, unknown>): Record<string, unknown> => {
  const cleaned = cleanOptionValue(value)
  return isRecord(cleaned) ? cleaned : {}
}

const serializeOptions = (value: Record<string, unknown>) => JSON.stringify(cleanOptions(value))

const buildInstanceConfig = (plugin: PluginRuntimeInstance) => ({
  enabled: plugin.enabled !== false,
  id: plugin.requestId,
  options: plugin.options ?? {},
  packageId: plugin.packageId,
  pluginRoot: plugin.pluginRoot ?? plugin.rootDir,
  scope: plugin.scope,
  sourceGroup: plugin.sourceGroup,
  watch: plugin.watch?.enabled === true
})

const buildManifestConfig = (plugin: PluginRuntimeInstance) => (
  plugin.manifest ?? {
    displayName: plugin.displayName,
    name: plugin.name,
    plugin: {
      client: plugin.client,
      contributions: plugin.plugin?.contributions ?? plugin.contributions
    }
  }
)

export function PluginConfigSection({ labels, onOptionsChange, plugin }: PluginConfigSectionProps) {
  const { message } = App.useApp()
  const { i18n, t } = useTranslation()
  const { pluginServerBaseUrl } = usePluginContext()
  const preferredLanguage = i18n.resolvedLanguage ?? i18n.language
  const optionsSchema = useMemo(
    () => buildPluginConfigUiSchema(plugin.manifest?.config, preferredLanguage),
    [plugin.manifest?.config, preferredLanguage]
  )
  const initialOptions = useMemo(() => normalizeOptions(plugin.options), [plugin.options])
  const [draftOptions, setDraftOptions] = useState<Record<string, unknown>>(initialOptions)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const saveVersionRef = useRef(0)
  const lastSavedRef = useRef(serializeOptions(initialOptions))

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current == null) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = undefined
  }, [])

  useEffect(() => {
    clearSaveTimer()
    setDraftOptions(initialOptions)
    lastSavedRef.current = serializeOptions(initialOptions)
    saveVersionRef.current += 1
    setSaveStatus('idle')
  }, [clearSaveTimer, initialOptions, plugin.scope])

  useEffect(() => () => clearSaveTimer(), [clearSaveTimer])

  const persistOptions = useCallback(async (nextOptions: Record<string, unknown>, version: number) => {
    const cleaned = cleanOptions(nextOptions)
    const serialized = serializeOptions(cleaned)
    if (lastSavedRef.current === serialized) {
      if (saveVersionRef.current === version) {
        setSaveStatus('idle')
      }
      return
    }

    if (saveVersionRef.current === version) {
      setSaveStatus('saving')
    }

    try {
      const savedOptions = await setPluginOptions(
        plugin.scope,
        cleaned,
        'workspace',
        { serverBaseUrl: pluginServerBaseUrl }
      )
      lastSavedRef.current = serializeOptions(savedOptions)
      if (saveVersionRef.current === version) {
        setDraftOptions(savedOptions)
        setSaveStatus('saved')
        await onOptionsChange?.()
      }
    } catch (error) {
      console.error('[plugin] failed to update plugin options', error)
      if (saveVersionRef.current === version) {
        setSaveStatus('error')
        void message.error(labels.saveFailed)
      }
    }
  }, [labels.saveFailed, message, onOptionsChange, plugin.scope, pluginServerBaseUrl])

  const scheduleOptionsSave = useCallback((nextOptions: Record<string, unknown>) => {
    setDraftOptions(nextOptions)
    clearSaveTimer()
    const version = saveVersionRef.current + 1
    saveVersionRef.current = version
    setSaveStatus('pending')
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = undefined
      void persistOptions(nextOptions, version)
    }, 700)
  }, [clearSaveTimer, persistOptions])

  const blocks = [
    {
      icon: 'settings',
      key: 'instance',
      title: labels.instance,
      value: buildInstanceConfig(plugin)
    },
    {
      icon: 'data_object',
      key: 'manifest',
      title: labels.manifest,
      value: buildManifestConfig(plugin)
    }
  ]
  const statusLabel = saveStatus === 'saving' || saveStatus === 'pending'
    ? labels.saving
    : saveStatus === 'saved'
    ? labels.saved
    : saveStatus === 'error'
    ? labels.saveFailed
    : undefined

  return (
    <section className='plugin-detail-route__section plugin-detail-route__config-section'>
      <article className='plugin-detail-route__config-form'>
        {statusLabel != null && (
          <span className={`plugin-detail-route__config-save-state is-${saveStatus}`}>
            {statusLabel}
          </span>
        )}
        {optionsSchema == null
          ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={labels.noSchema}
            />
          )
          : (
            <SchemaObjectEditor
              value={draftOptions}
              schema={optionsSchema}
              onChange={scheduleOptionsSave}
              t={t}
            />
          )}
      </article>
      {optionsSchema == null && (
        <div className='plugin-detail-route__config-list'>
          {blocks.map(block => (
            <article key={block.key} className='plugin-detail-route__config-block'>
              <div className='plugin-detail-route__config-block-header'>
                <MaterialSymbol name={block.icon} aria-hidden='true' />
                <h2>{block.title}</h2>
              </div>
              <pre className='plugin-detail-route__config-code'>{toJson(block.value)}</pre>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
