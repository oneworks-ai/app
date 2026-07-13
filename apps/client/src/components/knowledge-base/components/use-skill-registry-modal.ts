import { App, Form } from 'antd'
import type { FormInstance } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'

import type { ConfigResponse } from '@oneworks/types'

import { getApiErrorMessage, updateConfig } from '#~/api.js'
import { buildSkillRegistriesValue } from './skill-hub-utils'
import type { RegistryFormValues } from './skill-hub-utils'

export const resetSkillRegistryModal = (
  form: Pick<FormInstance<RegistryFormValues>, 'resetFields'>,
  setOpen: (open: boolean) => void,
  open: boolean
) => {
  form.resetFields()
  setOpen(open)
}

export function useSkillRegistryModal({
  configRes,
  existingRegistrySources = [],
  mutateConfig,
  mutateHub,
  setRegistry
}: {
  configRes?: ConfigResponse
  existingRegistrySources?: string[]
  mutateConfig: () => Promise<unknown>
  mutateHub?: () => Promise<unknown>
  setRegistry?: (value: string) => void
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [form] = Form.useForm<RegistryFormValues>()
  const close = React.useCallback(() => {
    resetSkillRegistryModal(form, setOpen, false)
  }, [form])
  const openModal = React.useCallback(() => {
    resetSkillRegistryModal(form, setOpen, true)
  }, [form])

  const save = async () => {
    const values = await form.validateFields()
    const source = values.source.trim()
    const configSource = values.configSource
    const sourceGeneral = configRes?.sources?.[configSource]?.general
    const configuredSources = (sourceGeneral?.skillRegistries ?? []).map(entry => entry.source)
    const legacySources = sourceGeneral?.skillsMeta?.sources ?? []
    if ([...existingRegistrySources, ...configuredSources, ...legacySources].some(entry => entry.trim() === source)) {
      void message.warning(t('knowledge.skills.registryExists'))
      return
    }

    setSaving(true)
    try {
      await updateConfig(
        configSource,
        'general',
        {
          skillRegistries: buildSkillRegistriesValue(sourceGeneral?.skillRegistries, values)
        }
      )
      setRegistry?.(`${configSource}:${source}`)
      close()
      await Promise.all([mutateConfig(), mutateHub?.()])
      void message.success(t('knowledge.skills.registrySaved'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('config.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return {
    close,
    form,
    open,
    openModal,
    save,
    saving
  }
}
