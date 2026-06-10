import { App, Form } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'

import type { ConfigResponse } from '@oneworks/types'

import { getApiErrorMessage, updateConfig } from '#~/api.js'
import { buildSkillsMetaValue } from './skill-hub-utils'
import type { RegistryFormValues } from './skill-hub-utils'

export function useSkillRegistryModal({
  configRes,
  mutateConfig,
  mutateHub,
  setRegistry
}: {
  configRes?: ConfigResponse
  mutateConfig: () => Promise<unknown>
  mutateHub: () => Promise<unknown>
  setRegistry: (value: string) => void
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [form] = Form.useForm<RegistryFormValues>()

  const save = async () => {
    const values = await form.validateFields()
    const source = values.source.trim()
    const configSource = values.configSource
    const sourceGeneral = configRes?.sources?.[configSource]?.general
    const existingSources = Array.isArray(sourceGeneral?.skillsMeta?.sources)
      ? sourceGeneral.skillsMeta.sources
      : []
    if (existingSources.some(entry => typeof entry === 'string' && entry === source)) {
      void message.warning(t('knowledge.skills.registryExists'))
      return
    }

    setSaving(true)
    try {
      await updateConfig(
        configSource,
        'general',
        {
          skillsMeta: buildSkillsMetaValue(sourceGeneral?.skillsMeta, values)
        }
      )
      setRegistry(`${configSource}:${source}`)
      setOpen(false)
      form.resetFields()
      await Promise.all([mutateConfig(), mutateHub()])
      void message.success(t('knowledge.skills.registrySaved'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('config.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return {
    form,
    open,
    save,
    saving,
    setOpen
  }
}
