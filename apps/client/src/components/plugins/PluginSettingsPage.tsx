import { App } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PluginViewHost } from '#~/plugins/PluginHost'
import { setPluginOptions } from '#~/plugins/api'
import { usePluginContext } from '#~/plugins/plugin-context'
import type { PluginContributionSettingsPage, PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

import { ConfigSectionFrame } from '../config/ConfigSectionFrame'
import { SchemaObjectEditor } from '../config/record-editors/SchemaObjectEditor'
import { buildPluginConfigUiSchema } from './plugin-config-json-schema'
import { createPluginSettingsOptionsSaveController } from './plugin-settings-options-save'

type SettingsPageContribution = PluginContributionSettingsPage & { pluginScope: string }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeOptions = (value: unknown) => isRecord(value) ? value : {}

function PluginSettingsSchemaPage({
  page,
  plugin
}: {
  page: Extract<SettingsPageContribution, { schema: Record<string, unknown> }>
  plugin: PluginRuntimeInstance
}) {
  const { message } = App.useApp()
  const { i18n, t } = useTranslation()
  const { pluginServerBaseUrl, refreshPlugins } = usePluginContext()
  const initialOptions = useMemo(() => normalizeOptions(plugin.options), [plugin.options])
  const [draftOptions, setDraftOptions] = useState(initialOptions)
  const schema = useMemo(() =>
    buildPluginConfigUiSchema({
      schema: page.schema,
      uiSchema: page.uiSchema
    }, i18n.resolvedLanguage ?? i18n.language), [i18n.language, i18n.resolvedLanguage, page.schema, page.uiSchema])

  const saveControllerRef = useRef<ReturnType<typeof createPluginSettingsOptionsSaveController>>()
  if (saveControllerRef.current == null) {
    saveControllerRef.current = createPluginSettingsOptionsSaveController({
      initialOptions,
      onError: (error) => {
        console.error('[plugin] failed to save settings page options', error)
        void message.error(t('config.pluginPages.saveFailed'))
      },
      onSaved: setDraftOptions,
      persist: async (nextOptions) => {
        const savedOptions = await setPluginOptions(
          plugin.scope,
          nextOptions,
          'workspace',
          { serverBaseUrl: pluginServerBaseUrl }
        )
        await refreshPlugins()
        return savedOptions
      }
    })
  }

  useEffect(() => {
    if (saveControllerRef.current?.syncRemote(initialOptions) === true) setDraftOptions(initialOptions)
  }, [initialOptions])

  useEffect(() => () => {
    if (saveControllerRef.current != null) void saveControllerRef.current.dispose()
  }, [])

  const handleChange = (nextOptions: Record<string, unknown>) => {
    setDraftOptions(nextOptions)
    saveControllerRef.current?.schedule(nextOptions)
  }

  if (schema == null) return null

  return (
    <ConfigSectionFrame>
      <SchemaObjectEditor
        value={draftOptions}
        schema={schema}
        onChange={handleChange}
        t={t}
      />
    </ConfigSectionFrame>
  )
}

export function PluginSettingsPage({ page }: { page: SettingsPageContribution }) {
  const { snapshot } = usePluginContext()
  const plugin = snapshot.instances.find(item => item.scope === page.pluginScope)

  if (plugin == null) return null
  if ('clientView' in page && typeof page.clientView === 'string') {
    return (
      <PluginViewHost
        routeId={`settings:${page.id}`}
        scope={page.pluginScope}
        surface='settings'
        viewId={page.clientView}
      />
    )
  }
  if ('schema' in page && isRecord(page.schema)) {
    return <PluginSettingsSchemaPage page={page} plugin={plugin} />
  }
  return null
}
