/* @jsxRuntime classic */
/* @jsx h */
/* eslint-disable max-lines -- the plugin view keeps its two tab panels on one host-rendered settings contract. */

import {
  applicationBundleIdPattern,
  normalizeApplicationPermissionMode,
  normalizeApplicationRulesForView
} from './application-permissions'

const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value)

export function CuaDriverView({ ctx, react, view }) {
  const h = react.createElement
  const { useEffect, useMemo, useState } = react
  const { Button, Icon, Input, NativeTabs, Select, SettingsRow, SettingsSection } = view.ui
  const t = useMemo(
    () => (en, chinese) => view.i18n?.resolveText?.({ en, 'zh-Hans': chinese }, en) ?? en,
    [view.i18n, view.host?.language]
  )
  const options = isObject(view.options?.value) ? view.options.value : ctx.options ?? {}
  const rules = normalizeApplicationRulesForView(options.applicationPermissions)
  const defaultMode = normalizeApplicationPermissionMode(options.defaultApplicationPermission)
  const cursorStrategy = options.cursorColorStrategy === 'fixed' ? 'fixed' : 'automatic'
  const savedCursorColor = typeof options.defaultCursorColor === 'string'
    ? options.defaultCursorColor
    : '#E3E7ED'
  const [bundleId, setBundleId] = useState('')
  const [newMode, setNewMode] = useState('always_ask')
  const [cursorColor, setCursorColor] = useState(savedCursorColor)
  const [busy, setBusy] = useState('')
  const [failure, setFailure] = useState('')
  const [activeTab, setActiveTab] = useState('application-access')

  useEffect(() => setCursorColor(savedCursorColor), [savedCursorColor])

  const tabs = useMemo(() => [
    { key: 'application-access', icon: 'policy', label: t('Application access', '应用权限') },
    { key: 'agent-pointer', icon: 'palette', label: t('Agent pointer', 'Agent 光标') }
  ], [t])
  const permissionOptions = [
    { label: t('No confirmation', '无需询问'), value: 'always_allow' },
    { label: t('Ask every time', '每次询问'), value: 'always_ask' },
    { label: t('Deny access', '拒绝访问'), value: 'deny' }
  ]
  const cursorStrategyOptions = [
    { label: t('Automatic per session', '按会话自动分配'), value: 'automatic' },
    { label: t('Fixed default color', '使用固定默认色'), value: 'fixed' }
  ]
  const save = async (key, patch) => {
    if (busy !== '') return false
    setBusy(key)
    setFailure('')
    try {
      await view.options.update({ ...options, ...patch }, 'workspace')
      return true
    } catch (error) {
      setFailure(error?.message ?? String(error))
      return false
    } finally {
      setBusy('')
    }
  }
  const addRule = () => {
    const normalized = bundleId.trim()
    if (!applicationBundleIdPattern.test(normalized)) {
      setFailure(t(
        'Enter a valid macOS bundle ID, such as com.apple.TextEdit.',
        '请输入有效的 macOS Bundle ID，例如 com.apple.TextEdit。'
      ))
      return
    }
    const key = normalized.toLocaleLowerCase('en-US')
    const nextRules = [
      { bundleId: normalized, mode: newMode },
      ...rules.filter(rule => rule.bundleId.toLocaleLowerCase('en-US') !== key)
    ]
    void save('rule:add', { applicationPermissions: nextRules }).then(saved => {
      if (saved) setBundleId('')
    })
  }
  const updateRule = (targetBundleId, mode) =>
    void save(`rule:${targetBundleId}`, {
      applicationPermissions: rules.map(rule => rule.bundleId === targetBundleId ? { ...rule, mode } : rule)
    })
  const removeRule = targetBundleId =>
    void save(`rule:${targetBundleId}`, {
      applicationPermissions: rules.filter(rule => rule.bundleId !== targetBundleId)
    })
  const commitCursorColor = value => {
    const normalized = value.trim()
    if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(normalized)) {
      setFailure(t('Enter a CSS hex color such as #625BF6.', '请输入 #625BF6 这样的十六进制颜色。'))
      setCursorColor(savedCursorColor)
      return
    }
    void save('cursor:color', { defaultCursorColor: normalized })
  }

  return <div className='cua-driver'>
    {failure !== '' && <div className='cua-driver__error' role='alert'>
      <Icon name='error_outline' />
      <span>{failure}</span>
    </div>}

    <NativeTabs
      activeKey={activeTab}
      ariaLabel={t('Computer Use settings', '电脑操作设置')}
      items={tabs}
      onChange={setActiveTab}
    />

    <div className='native-tabs-panel cua-driver__tab-panel' role='tabpanel'>
      {activeTab === 'application-access' && <SettingsSection>
        <SettingsRow
          icon='shield'
          title={t('Default behavior', '默认策略')}
          description={t(
            'Used for applications without a rule and operations whose target cannot be identified.',
            '用于未配置规则的应用，以及无法识别目标应用的操作。'
          )}
        >
          <div className='cua-driver__inline-control'>
            <Select
              ariaLabel={t('Default application permission', '默认应用权限')}
              disabled={busy !== ''}
              onChange={mode => void save('default', { defaultApplicationPermission: mode })}
              options={permissionOptions}
              value={defaultMode}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          icon='add_moderator'
          layout='stacked'
          title={t('Add application rule', '添加应用规则')}
          description={t(
            'Use the application bundle ID. Adding an existing bundle ID replaces its rule.',
            '请输入应用的 Bundle ID；重复添加会替换已有规则。'
          )}
        >
          <div className='cua-driver__rule-form'>
            <Input
              allowClear
              ariaLabel={t('Application bundle ID', '应用 Bundle ID')}
              disabled={busy !== ''}
              onChange={setBundleId}
              placeholder='com.apple.TextEdit'
              value={bundleId}
            />
            <Select
              ariaLabel={t('Application permission', '应用权限')}
              disabled={busy !== ''}
              onChange={setNewMode}
              options={permissionOptions}
              value={newMode}
            />
            <Button
              label={busy === 'rule:add' ? t('Adding…', '添加中…') : t('Add rule', '添加规则')}
              icon='add'
              type='primary'
              disabled={bundleId.trim() === '' || busy !== ''}
              onClick={addRule}
            />
          </div>
          <small className='cua-driver__example'>
            {t(
              'Examples: com.apple.TextEdit · com.apple.Safari · com.microsoft.VSCode',
              '示例：com.apple.TextEdit · com.apple.Safari · com.microsoft.VSCode'
            )}
          </small>
        </SettingsRow>
        <SettingsRow
          icon='rule'
          layout='stacked'
          title={t('Saved application rules', '已保存的应用规则')}
          description={t(
            'An explicit denial wins before any app activation or input action.',
            '显式拒绝会在应用激活或输入动作发生之前生效。'
          )}
        >
          {rules.length === 0
            ? <p className='cua-driver__empty'>{t('No application rules yet.', '尚未添加应用规则。')}</p>
            : <ol className='cua-driver__rules'>
              {rules.map((rule, index) =>
                <li key={rule.bundleId} aria-busy={busy === `rule:${rule.bundleId}`}>
                  <span className='cua-driver__rule-index' aria-hidden='true'>{index + 1}</span>
                  <code title={rule.bundleId}>{rule.bundleId}</code>
                  <Select
                    ariaLabel={t(`Permission for ${rule.bundleId}`, `${rule.bundleId} 的权限`)}
                    disabled={busy !== ''}
                    onChange={mode => updateRule(rule.bundleId, mode)}
                    options={permissionOptions}
                    value={rule.mode}
                  />
                  <Button
                    ariaLabel={t(`Remove ${rule.bundleId}`, `删除 ${rule.bundleId}`)}
                    title={t('Remove rule', '删除规则')}
                    icon='delete'
                    danger
                    disabled={busy !== ''}
                    onClick={() => removeRule(rule.bundleId)}
                  />
                </li>
              )}
            </ol>}
        </SettingsRow>
      </SettingsSection>}

      {activeTab === 'agent-pointer' && <SettingsSection>
        <SettingsRow
          icon='palette'
          title={t('Default pointer assignment', '默认光标分配方式')}
          description={t(
            'Give each session a distinct color or use one fixed default.',
            '为每个会话分配不同颜色，或统一使用固定默认色。'
          )}
        >
          <div className='cua-driver__inline-control'>
            <Select
              ariaLabel={t('Pointer color strategy', '光标颜色策略')}
              disabled={busy !== ''}
              onChange={strategy => void save('cursor:strategy', { cursorColorStrategy: strategy })}
              options={cursorStrategyOptions}
              value={cursorStrategy}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          icon='format_color_fill'
          title={t('Fixed default color', '固定默认色')}
          description={t('Used when fixed assignment is selected.', '选择固定分配时使用。')}
        >
          <div className='cua-driver__inline-control'>
            <Input
              ariaLabel={t('Fixed pointer color', '固定光标颜色')}
              disabled={busy !== '' || cursorStrategy !== 'fixed'}
              onChange={setCursorColor}
              onCommit={commitCursorColor}
              placeholder='#625BF6'
              value={cursorColor}
            />
          </div>
        </SettingsRow>
      </SettingsSection>}
    </div>
  </div>
}
