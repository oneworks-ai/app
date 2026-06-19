import { describe, expect, it } from 'vitest'

import {
  buildModelServiceConfigSessionInitialContent,
  buildModelServiceConfigSessionPrompt,
  buildModelServiceConfigSessionTitle
} from '#~/components/config/modelServiceConfigSession'

describe('model service config session prompt', () => {
  it('builds a localized zh update prompt with built-in skill guidance and redacted secrets', () => {
    const prompt = buildModelServiceConfigSessionPrompt({
      mode: 'update',
      serviceKey: 'deepseek',
      source: 'global',
      service: {
        title: 'DeepSeek',
        apiKey: 'sk-live-secret',
        provider: 'deepseek'
      }
    }, {
      globalConfigPath: '/Users/test/.oneworks/.oo.config.json'
    })

    expect(buildModelServiceConfigSessionTitle({
      mode: 'update',
      serviceKey: 'deepseek',
      source: 'global',
      service: { title: 'DeepSeek' }
    })).toBe('修改模型服务：DeepSeek')
    expect(prompt).toContain('/Users/test/.oneworks/.oo.config.json')
    expect(prompt).toContain('oneworks-model-services')
    expect(prompt).toContain('文档/skill')
    expect(prompt).not.toContain('内置平台目录')
    expect(prompt).not.toContain('packages/')
    expect(prompt).not.toContain('.oo/rfcs')
    expect(prompt).toContain('browser:control-in-app-browser')
    expect(prompt).toContain('<redacted>')
    expect(prompt).not.toContain('sk-live-secret')
  })

  it('builds a localized en update prompt', () => {
    const prompt = buildModelServiceConfigSessionPrompt({
      mode: 'update',
      serviceKey: 'deepseek',
      source: 'global',
      service: {
        title: 'DeepSeek',
        apiKey: 'sk-live-secret',
        provider: 'deepseek'
      }
    }, {
      language: 'en',
      globalConfigPath: '/Users/test/.oneworks/.oo.config.json'
    })

    expect(buildModelServiceConfigSessionTitle({
      mode: 'update',
      serviceKey: 'deepseek',
      source: 'global',
      service: { title: 'DeepSeek' }
    }, { language: 'en' })).toBe('Update model service: DeepSeek')
    expect(prompt).toContain('Please help me update model service `deepseek`.')
    expect(prompt).toContain('Requirements:')
    expect(prompt).toContain('oneworks-model-services')
    expect(prompt).toContain('skill/documentation')
    expect(prompt).not.toContain('Built-in provider catalog:')
    expect(prompt).not.toContain('packages/')
    expect(prompt).not.toContain('.oo/rfcs')
    expect(prompt).toContain('browser:control-in-app-browser')
    expect(prompt).toContain('<redacted>')
    expect(prompt).not.toContain('请帮我')
    expect(prompt).not.toContain('sk-live-secret')
  })

  it('builds initial content that references the bundled model service skill', () => {
    const content = buildModelServiceConfigSessionInitialContent({
      mode: 'create',
      source: 'global'
    }, { language: 'en' })
    const textItem = content.find(item => item.type === 'text')
    const fileItems = content.filter(item => item.type === 'file')

    expect(textItem?.text).toContain('oneworks-model-services')
    expect(textItem?.text).toContain('skill/documentation')
    expect(textItem?.text).not.toContain('Built-in provider catalog:')
    expect(textItem?.text).not.toContain('apiBaseUrl=https://api.deepseek.com')
    expect(textItem?.text).not.toContain('apiKeys=https://platform.deepseek.com/api_keys')
    expect(fileItems).toHaveLength(0)
  })

  it('falls back to english for non-zh locales', () => {
    expect(buildModelServiceConfigSessionTitle({
      mode: 'create',
      source: 'global'
    }, { language: 'fr-FR' })).toBe('Add model service config')
  })
})
