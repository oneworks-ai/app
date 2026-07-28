/* eslint-disable max-lines -- The plugin-owned settings subpage keeps recovery and audit sections in one render contract. */
/* @jsxRuntime classic */
/* @jsx h */
const normalizeFailure = error => ({
  code: error?.details?.code ?? error?.code ?? 'CHROME_DRIVER_FAILED',
  message: error?.details?.message ?? error?.message ?? String(error),
  missingPermissions: error?.details?.missing_permissions ?? error?.missing_permissions ?? []
})
const frameTargetIdentity = (connectionId, tabId) =>
  typeof connectionId === 'string' && Number.isInteger(tabId) ? JSON.stringify([connectionId, tabId]) : null
const browserStatusViewSnapshot = status => {
  if (status?.connection == null) return JSON.stringify(status)
  const { last_seen_at: _lastSeenAt, ...stableConnection } = status.connection
  return JSON.stringify({ ...status, connection: stableConnection })
}
const chromeWebStoreUrl =
  'https://chromewebstore.google.com/detail/oneworks-external-browser/eiikbhfmjohfcldcmgjikafpmpbfipbi'
const statusPollIntervalMs = 2500

export function ChromeDriverView({ ctx, react, view }) {
  const h = react.createElement
  const { useCallback, useEffect, useMemo, useRef, useState } = react
  const { Button, Icon, Input, NativeTabs, Select, SettingsRow, SettingsSection, Switch } = view.ui
  const [languageVersion, setLanguageVersion] = useState(0)
  const t = useMemo(() => (en, chinese) => view.i18n?.resolveText?.({ en, 'zh-Hans': chinese }, en) ?? en, [
    view.i18n,
    languageVersion
  ])
  const [status, setStatus] = useState(null)
  const [advancedAccess, setAdvancedAccess] = useState(null)
  const [frames, setFrames] = useState([])
  const [busy, setBusy] = useState('')
  const [failure, setFailure] = useState(null)
  const [activeTab, setActiveTab] = useState('connection')
  const [sitePermissions, setSitePermissions] = useState(null)
  const [sitePattern, setSitePattern] = useState('')
  const [siteMode, setSiteMode] = useState('always_ask')
  const activeFrameTarget = status?.connected === true
    ? frameTargetIdentity(status?.connection?.connection_id, status?.connection?.oneworks_tab_id)
    : null
  const activeFrameTargetRef = useRef(activeFrameTarget)
  activeFrameTargetRef.current = activeFrameTarget
  const requestStateRef = useRef({ disposed: false, epoch: 0, tail: Promise.resolve() })

  const tabs = useMemo(() => [
    { key: 'connection', icon: 'link', label: t('Connection', '连接') },
    { key: 'advanced-access', icon: 'security', label: t('Advanced access', '高级访问') },
    { key: 'site-permissions', icon: 'policy', label: t('Website permissions', '网站权限') },
    { key: 'web-frames', icon: 'account_tree', label: t('Web Frames', 'Web Frame') },
    { key: 'review-audit', icon: 'shield', label: t('Review & audit', '确认与审计') }
  ], [t])

  useEffect(() => view.i18n?.subscribe?.(() => setLanguageVersion(value => value + 1))?.dispose, [view.i18n])

  const applyStatus = useCallback(nextStatus => {
    setStatus(current =>
      browserStatusViewSnapshot(current) === browserStatusViewSnapshot(nextStatus) ? current : nextStatus
    )
  }, [])
  const applyAdvancedAccess = useCallback(nextAdvancedAccess => {
    setAdvancedAccess(current =>
      JSON.stringify(current) === JSON.stringify(nextAdvancedAccess)
        ? current
        : nextAdvancedAccess
    )
  }, [])
  const applySitePermissions = useCallback(nextSitePermissions => {
    setSitePermissions(current =>
      JSON.stringify(current) === JSON.stringify(nextSitePermissions)
        ? current
        : nextSitePermissions
    )
  }, [])
  const loadStatus = useCallback(() => ctx.commands.execute('status', {}), [ctx.commands])
  const loadAdvancedAccess = useCallback(
    () => ctx.commands.execute('get-advanced-access', {}),
    [ctx.commands]
  )
  const loadSitePermissions = useCallback(
    () => ctx.commands.execute('get-site-permissions', {}),
    [ctx.commands]
  )
  const enqueueRequest = useCallback(task => {
    const epoch = requestStateRef.current.epoch
    const isCurrent = () => !requestStateRef.current.disposed && requestStateRef.current.epoch === epoch
    const scheduled = requestStateRef.current.tail.then(async () => {
      if (!isCurrent()) return
      await task(isCurrent)
    })
    requestStateRef.current.tail = scheduled.catch(() => undefined)
    return scheduled
  }, [])
  const refreshNow = useCallback(async (isCurrent, retry) => {
    const [statusResult, advancedAccessResult, sitePermissionsResult] = await Promise.allSettled([
      loadStatus(),
      loadAdvancedAccess(),
      loadSitePermissions()
    ])
    if (!isCurrent()) return

    const failures = []
    if (statusResult.status === 'fulfilled') applyStatus(statusResult.value)
    else {
      setStatus(null)
      failures.push({ ...normalizeFailure(statusResult.reason), source: 'status', retry })
    }
    if (advancedAccessResult.status === 'fulfilled') {
      applyAdvancedAccess(advancedAccessResult.value?.result ?? advancedAccessResult.value)
    } else {
      failures.push({ ...normalizeFailure(advancedAccessResult.reason), source: 'advanced-access', retry })
    }
    if (sitePermissionsResult.status === 'fulfilled') {
      applySitePermissions(sitePermissionsResult.value?.result ?? sitePermissionsResult.value)
    } else {
      failures.push({ ...normalizeFailure(sitePermissionsResult.reason), source: 'configuration', retry })
    }
    const nextFailure = failures.find(failure => failure.source === 'configuration') ?? failures[0] ?? null
    setFailure(current => current?.source === 'operation' || current?.source === 'pairing' ? current : nextFailure)
  }, [applyAdvancedAccess, applySitePermissions, applyStatus, loadAdvancedAccess, loadSitePermissions, loadStatus])
  const refresh = useCallback(
    () => enqueueRequest(isCurrent => refreshNow(isCurrent, refresh)),
    [enqueueRequest, refreshNow]
  )
  const pollLiveStateNow = useCallback(async (isCurrent, retry) => {
    const [statusResult, advancedAccessResult] = await Promise.allSettled([loadStatus(), loadAdvancedAccess()])
    if (!isCurrent()) return

    const failures = []
    if (statusResult.status === 'fulfilled') applyStatus(statusResult.value)
    else failures.push({ ...normalizeFailure(statusResult.reason), source: 'status', retry })
    if (advancedAccessResult.status === 'fulfilled') {
      applyAdvancedAccess(advancedAccessResult.value?.result ?? advancedAccessResult.value)
    } else {
      failures.push({ ...normalizeFailure(advancedAccessResult.reason), source: 'advanced-access', retry })
    }
    const nextFailure = failures[0] ?? null
    setFailure(current => {
      if (current?.source === 'operation' || current?.source === 'pairing' || current?.source === 'configuration') {
        return current
      }
      return nextFailure
    })
  }, [applyAdvancedAccess, applyStatus, loadAdvancedAccess, loadStatus])
  const pollLiveState = useCallback(
    () => enqueueRequest(isCurrent => pollLiveStateNow(isCurrent, pollLiveState)),
    [enqueueRequest, pollLiveStateNow]
  )

  useEffect(() => {
    requestStateRef.current.disposed = false
    requestStateRef.current.epoch += 1
    let timer
    const scheduleStatusPoll = () => {
      if (requestStateRef.current.disposed || document.visibilityState !== 'visible' || timer != null) return
      timer = window.setTimeout(async () => {
        timer = undefined
        await pollLiveState()
        scheduleStatusPoll()
      }, statusPollIntervalMs)
    }
    void refresh()
    scheduleStatusPoll()
    const pairingResult = event => {
      if (
        event.source !== window || event.origin !== location.origin ||
        event.data?.type !== 'ONEWORKS_CHROME_PAIRING_RESULT'
      ) return
      if (event.data.ok === true) setFailure(null)
      else if (event.data.error != null) setFailure({ ...normalizeFailure(event.data.error), source: 'pairing' })
      void refresh()
    }
    const refreshVisiblePage = () => {
      if (document.visibilityState !== 'visible') {
        window.clearTimeout(timer)
        timer = undefined
        return
      }
      void refresh().finally(scheduleStatusPoll)
    }
    window.addEventListener('message', pairingResult)
    document.addEventListener('visibilitychange', refreshVisiblePage)
    return () => {
      requestStateRef.current.disposed = true
      requestStateRef.current.epoch += 1
      window.clearTimeout(timer)
      window.removeEventListener('message', pairingResult)
      document.removeEventListener('visibilitychange', refreshVisiblePage)
    }
  }, [pollLiveState, refresh])

  useEffect(() => setFrames([]), [activeFrameTarget])

  const run = async (name, task) => {
    setBusy(name)
    setFailure(null)
    try {
      await enqueueRequest(async isCurrent => {
        await task(isCurrent)
        if (isCurrent()) await refreshNow(isCurrent, refresh)
      })
    } catch (error) {
      if (!requestStateRef.current.disposed) {
        setFailure({ ...normalizeFailure(error), source: 'operation', retry: () => run(name, task) })
      }
    } finally {
      if (!requestStateRef.current.disposed) setBusy('')
    }
  }
  const connect = () =>
    run('connect', async () => {
      window.postMessage({ type: 'ONEWORKS_CHROME_PAIRING_REQUEST' }, location.origin)
      await new Promise(resolve => setTimeout(resolve, 300))
    })
  const openExtensionStore = () => window.open(chromeWebStoreUrl, '_blank', 'noopener,noreferrer')
  const inspectFrames = () =>
    run('frames', async isCurrent => {
      const tabId = status?.connection?.oneworks_tab_id
      const connectionId = status?.connection?.connection_id
      const requestedFrameTarget = frameTargetIdentity(connectionId, tabId)
      if (requestedFrameTarget == null) {
        throw new TypeError(t('Reconnect from the OneWorks Web tab first.', '请先从 OneWorks Web 标签页重新连接。'))
      }
      const result = await ctx.commands.execute('list-web-frames', { tab_id: tabId })
      if (!isCurrent() || activeFrameTargetRef.current !== requestedFrameTarget) return
      setFrames(result?.result ?? result ?? [])
    })
  const updateAdvancedAccess = (key, enabled) =>
    run(`advanced:${key}`, async isCurrent => {
      const result = await ctx.commands.execute('set-advanced-access', { enabled, key })
      if (isCurrent()) applyAdvancedAccess(result?.result ?? result)
    })
  const addSitePermission = () => {
    const pattern = sitePattern.trim()
    if (pattern === '') return
    return run('site:add', async isCurrent => {
      const result = await ctx.commands.execute('add-site-permission', { mode: siteMode, pattern })
      if (isCurrent()) {
        applySitePermissions(result?.result ?? result)
        setSitePattern('')
      }
    })
  }
  const updateSitePermission = (ruleId, mode) =>
    run(`site:${ruleId}`, async isCurrent => {
      const result = await ctx.commands.execute('set-site-permission', { mode, rule_id: ruleId })
      if (isCurrent()) applySitePermissions(result?.result ?? result)
    })
  const removeSitePermission = ruleId =>
    run(`site:${ruleId}`, async isCurrent => {
      const result = await ctx.commands.execute('remove-site-permission', { rule_id: ruleId })
      if (isCurrent()) applySitePermissions(result?.result ?? result)
    })
  const decide = (id, approved) =>
    run(
      id,
      () => ctx.commands.execute(approved ? 'approve-confirmation' : 'deny-confirmation', { confirmation_id: id })
    )
  const connectionState = status?.connected ? 'connected' : status?.connection ? 'interrupted' : 'disconnected'
  const rawDebuggerAvailable = status?.connection?.capabilities?.modules?.raw === true
  const rawDebuggerEffective = rawDebuggerAvailable &&
    status?.connection?.capabilities?.advanced_access?.raw_debugger === true
  const advancedAccessSyncFailed = advancedAccess?.sync_state === 'sync_failed'
  const connectionLabel = connectionState === 'connected'
    ? t('Connected', '已连接')
    : connectionState === 'interrupted'
    ? t('Connection interrupted', '连接中断')
    : t('Not connected', '未连接')
  const recover = () => failure?.code === 'VERSION_MISMATCH' ? connect() : failure?.retry?.() ?? refresh()
  const failureGuidance = failure?.code === 'VERSION_MISMATCH'
    ? t(
      'Update the OneWorks browser extension, then reconnect this tab.',
      '请更新 OneWorks 浏览器扩展，然后重新连接当前标签页。'
    )
    : failure?.code === 'MISSING_PERMISSION'
    ? t(
      'Open the extension popup, grant only the listed permissions, then retry.',
      '请打开扩展弹窗，仅授予下列权限，然后重试。'
    )
    : failure?.message
  const siteModeOptions = [
    { label: t('Always ask', '始终询问'), value: 'always_ask' },
    { label: t('Always allow', '始终允许'), value: 'always_allow' }
  ]

  return <div className='chrome-driver'>
    {failure && <div className='chrome-driver__alert' role='alert'>
      <Icon name='error_outline' />
      <span>
        <strong>
          {failure.code === 'VERSION_MISMATCH'
            ? t('Extension update required', '需要更新扩展')
            : failure.code === 'MISSING_PERMISSION'
            ? t('Permission required', '需要权限')
            : t('Browser control needs attention', '浏览器控制需要处理')}
        </strong>
        <small>{failureGuidance}</small>
        {failure.code === 'MISSING_PERMISSION' && failure.missingPermissions.length > 0 &&
          <code>{failure.missingPermissions.join(', ')}</code>}
        {failure.message !== failureGuidance && <details>
          <summary>{t('Technical detail', '技术详情')}</summary>
          <code>{failure.message}</code>
        </details>}
      </span>
      <Button
        label={failure.code === 'MISSING_PERMISSION'
          ? t('I granted it — retry', '已授权，重试')
          : failure.code === 'VERSION_MISMATCH'
          ? t('Reconnect after update', '更新后重新连接')
          : t('Retry', '重试')}
        disabled={busy !== ''}
        onClick={() => void recover()}
      />
    </div>}

    <NativeTabs
      activeKey={activeTab}
      ariaLabel={t('External browser settings', '外部浏览器设置')}
      items={tabs}
      onChange={setActiveTab}
    />

    <div className='native-tabs-panel'>
      {activeTab === 'connection' && <SettingsSection>
        <SettingsRow
          icon='language'
          title={t('Browser connection', '浏览器连接')}
          description={status?.connection?.trusted_origin ?? t('No trusted origin paired', '尚未配对受信来源')}
        >
          <div className='chrome-driver__connection-actions'>
            <span
              role='status'
              aria-live='polite'
              className={`chrome-driver__status chrome-driver__status--${connectionState}`}
            >
              <span aria-hidden='true' />
              {connectionLabel}
            </span>
            <Button
              label={t('Install extension', '安装扩展')}
              icon='extension'
              disabled={busy !== ''}
              onClick={openExtensionStore}
            />
            <Button
              label={busy === 'connect' ? t('Connecting…', '连接中…') : t('Connect browser', '连接浏览器')}
              icon='link'
              type='primary'
              disabled={busy !== ''}
              onClick={connect}
            />
          </div>
        </SettingsRow>
        {status?.connected !== true &&
          <div className='chrome-driver__hint chrome-driver__hint--connection'>
            <Icon name='extension' />
            <span>
              {t(
                'In Chrome, open the extension on this OneWorks tab, choose “Connect this OneWorks tab”, then return here and connect the browser.',
                '在 Chrome 的当前 OneWorks 标签页打开扩展，选择“连接此 OneWorks 标签页”，然后回到这里连接浏览器。'
              )}
            </span>
          </div>}
      </SettingsSection>}

      {activeTab === 'advanced-access' && <SettingsSection>
        <div className='chrome-driver__advanced-warning'>
          <Icon name={advancedAccessSyncFailed ? 'error_outline' : 'warning'} />
          <span className='chrome-driver__advanced-warning-copy'>
            {advancedAccessSyncFailed
              ? t(
                'The preferences are saved, but synchronization with the connected browser failed. Reconnect to retry; do not treat the new values as active until synchronization succeeds.',
                '配置已保存，但未能同步到当前浏览器。请重新连接后重试；同步成功前不要将新值视为已生效。'
              )
              : t(
                'These settings are saved in OneWorks independently of the connection and synchronized when a browser connects. Every use of advanced access still requires an exact confirmation.',
                '这些设置与浏览器连接无关，会保存在 OneWorks 中，并在浏览器连接后自动同步。每次使用高级访问仍需针对准确操作进行确认。'
              )}
          </span>
        </div>
        <SettingsRow
          icon='terminal'
          title={t('Raw CDP and JavaScript', '原始 CDP 与 JavaScript')}
          description={status?.connected !== true
            ? t(
              'This preference is saved now. Raw access requires the privileged extension and is applied after a compatible browser connects.',
              '设置会立即保存；原始访问需要 privileged 扩展，并在兼容的浏览器连接后生效。'
            )
            : rawDebuggerAvailable
            ? t(
              'Browser-session-wide access. The tab and origin guard catches accidental navigation but is not a security boundary; this also includes cookie values and sensitive page fields.',
              '浏览器会话级访问；tab 与来源检查用于发现误导航，并非安全边界；同时包含完整 Cookie 值与页面敏感字段。'
            )
            : t(
              'The preference is saved, but the connected extension does not support Chrome debugger. Install the privileged extension to apply it.',
              '设置已保存，但当前连接的扩展不支持 Chrome debugger；安装 privileged 扩展后即可生效。'
            )}
        >
          <Switch
            checked={advancedAccess?.raw_debugger === true}
            disabled={advancedAccess == null || busy !== ''}
            onChange={enabled => void updateAdvancedAccess('raw_debugger', enabled)}
          />
        </SettingsRow>
        <SettingsRow
          icon='cookie'
          title={t('Complete cookie values', '完整 Cookie 值')}
          description={rawDebuggerEffective
            ? t('Included while Raw CDP and JavaScript is enabled.', '开启原始 CDP 与 JavaScript 时已包含。')
            : t(
              'Allow value reads only for an explicitly supplied HTTP(S) origin.',
              '仅允许读取显式指定 HTTP(S) 来源的 Cookie 值。'
            )}
        >
          <Switch
            checked={advancedAccess?.cookie_values === true}
            disabled={advancedAccess == null || busy !== ''}
            onChange={enabled => void updateAdvancedAccess('cookie_values', enabled)}
          />
        </SettingsRow>
        <SettingsRow
          icon='password'
          title={t('Sensitive page fields', '页面敏感字段')}
          description={rawDebuggerEffective
            ? t('Included while Raw CDP and JavaScript is enabled.', '开启原始 CDP 与 JavaScript 时已包含。')
            : t(
              'Allow reading and typing password, token, OTP, and similar fields in the current page.',
              '允许读取和输入当前页面中的密码、token、OTP 等敏感字段。'
            )}
        >
          <Switch
            checked={advancedAccess?.sensitive_fields === true}
            disabled={advancedAccess == null || busy !== ''}
            onChange={enabled => void updateAdvancedAccess('sensitive_fields', enabled)}
          />
        </SettingsRow>
        <div className='chrome-driver__hint'>
          <Icon name='info' />
          <span>
            {t(
              'Chrome does not expose saved passwords from its password manager. This switch applies to page DOM and storage only.',
              'Chrome 不提供密码管理器已保存密码的读取 API；此开关仅作用于页面 DOM 与存储。'
            )}
          </span>
        </div>
      </SettingsSection>}

      {activeTab === 'site-permissions' && <SettingsSection>
        <div className='chrome-driver__hint chrome-driver__hint--standalone'>
          <Icon name='info' />
          <span>
            {t(
              'Rules are saved in OneWorks and work without a browser connection. New rules are added first, and the first match wins. “Always allow” can skip confirmation for ordinary site-scoped operations; advanced access still asks every time, and Chrome permissions still apply.',
              '规则保存在 OneWorks 中，与浏览器是否连接无关。新规则添加到最前，首条匹配规则生效；“始终允许”可跳过普通网站操作的确认，但高级访问仍会逐次询问，Chrome 权限也始终有效。'
            )}
          </span>
        </div>
        <SettingsRow
          icon='add_link'
          layout='stacked'
          title={t('Add URL rule', '添加 URL 规则')}
          description={t(
            'Use a safe wildcard pattern. Query strings and fragments are not allowed.',
            '使用受限通配规则；不允许包含查询参数或片段。'
          )}
        >
          <div className='chrome-driver__site-rule-form'>
            <Input
              allowClear
              ariaLabel={t('URL match pattern', 'URL 匹配规则')}
              disabled={busy !== ''}
              onChange={setSitePattern}
              placeholder='https://*.example.com/*'
              value={sitePattern}
            />
            <Select
              ariaLabel={t('Permission behavior', '权限行为')}
              disabled={busy !== ''}
              onChange={setSiteMode}
              options={siteModeOptions}
              value={siteMode}
            />
            <Button
              label={busy === 'site:add' ? t('Adding…', '添加中…') : t('Add rule', '添加规则')}
              icon='add'
              type='primary'
              disabled={sitePermissions == null || sitePattern.trim() === '' || busy !== ''}
              onClick={() => void addSitePermission()}
            />
          </div>
          <small className='chrome-driver__site-rule-example'>
            {t(
              'Examples: https://example.com/* · https://*.example.com/* · http://localhost:3000/*',
              '示例：https://example.com/* · https://*.example.com/* · http://localhost:3000/*'
            )}
          </small>
        </SettingsRow>
        <SettingsRow
          icon='rule'
          layout='stacked'
          title={t('Saved rules', '已保存规则')}
          description={t(
            'Operations that match no rule keep the standard risk-based confirmation behavior.',
            '未匹配任何规则的操作继续使用默认的风险确认行为。'
          )}
        >
          {(sitePermissions?.rules?.length ?? 0) === 0
            ? <p className='chrome-driver__empty'>{t('No website rules yet.', '尚未添加网站规则。')}</p>
            : <ol className='chrome-driver__site-rules'>
              {sitePermissions.rules.map((rule, index) =>
                <li key={rule.id} aria-busy={busy === `site:${rule.id}`}>
                  <span className='chrome-driver__site-rule-index' aria-hidden='true'>{index + 1}</span>
                  <code title={rule.pattern}>{rule.pattern}</code>
                  <Select
                    ariaLabel={t(`Permission for ${rule.pattern}`, `${rule.pattern} 的权限`)}
                    disabled={busy !== ''}
                    onChange={mode => void updateSitePermission(rule.id, mode)}
                    options={siteModeOptions}
                    value={rule.mode}
                  />
                  <Button
                    ariaLabel={t(`Remove ${rule.pattern}`, `删除 ${rule.pattern}`)}
                    title={t('Remove rule', '删除规则')}
                    icon='delete'
                    danger
                    disabled={busy !== ''}
                    onClick={() => void removeSitePermission(rule.id)}
                  />
                </li>
              )}
            </ol>}
        </SettingsRow>
      </SettingsSection>}

      {activeTab === 'web-frames' && <SettingsSection>
        <SettingsRow
          icon='iframe'
          layout='stacked'
          title={t('Paired page frames', '已配对页面 Frame')}
          description={t(
            'Stable frame and document identities prevent operations from crossing tabs.',
            '稳定的 frame 与 document 标识可避免操作跨标签页串台。'
          )}
        >
          <div className='chrome-driver__row-action'>
            <Button
              label={busy === 'frames' ? t('Discovering…', '发现中…') : t('Discover frames', '发现 Frame')}
              icon='account_tree'
              disabled={!status?.connected || busy !== ''}
              onClick={inspectFrames}
            />
          </div>
          {frames.length === 0
            ? <p className='chrome-driver__empty'>{t('No frame inventory loaded.', '尚未加载 Frame 清单。')}</p>
            : <ul className='chrome-driver__list'>
              {frames.map(frame =>
                <li key={`${frame.frame_id}:${frame.document_id}`}>
                  <Icon name={frame.frame_id === 0 ? 'web_asset' : 'iframe'} />
                  <span>
                    <strong>{frame.frame_id === 0 ? t('Top document', '顶层文档') : `Frame ${frame.frame_id}`}</strong>
                    <small>{frame.url}</small>
                    <details>
                      <summary>{t('Frame identity', 'Frame 标识')}</summary>
                      <code>{frame.frame_id} · {frame.document_id}</code>
                    </details>
                  </span>
                </li>
              )}
            </ul>}
        </SettingsRow>
      </SettingsSection>}

      {activeTab === 'review-audit' && <SettingsSection>
        <SettingsRow
          icon='approval'
          layout='stacked'
          title={t('Sensitive actions', '敏感操作')}
          description={t(
            `${
              status?.pending_confirmations?.length ?? 0
            } waiting for review · exact-operation approvals expire after five minutes`,
            `${status?.pending_confirmations?.length ?? 0} 个等待确认 · 精确操作批准将在五分钟后失效`
          )}
        >
          {(status?.pending_confirmations?.length ?? 0) === 0
            ? <p className='chrome-driver__empty'>
              {t('No sensitive actions are waiting.', '没有等待确认的敏感操作。')}
            </p>
            : <ul className='chrome-driver__list'>
              {status.pending_confirmations.map(item =>
                <li key={item.confirmation_id} aria-busy={busy === item.confirmation_id}>
                  <Icon name='shield' />
                  <span>
                    <strong>{item.op} · R{item.risk_tier}</strong>
                    <details>
                      <summary>{t('Review exact scope', '查看精确范围')}</summary>
                      <small>{item.summary}</small>
                    </details>
                  </span>
                  <div className='chrome-driver__actions'>
                    <Button
                      label={busy === item.confirmation_id ? t('Working…', '处理中…') : t('Deny', '拒绝')}
                      danger
                      disabled={busy !== ''}
                      onClick={() => void decide(item.confirmation_id, false)}
                    />
                    <Button
                      label={busy === item.confirmation_id ? t('Working…', '处理中…') : t('Approve', '批准')}
                      type='primary'
                      disabled={busy !== ''}
                      onClick={() => void decide(item.confirmation_id, true)}
                    />
                  </div>
                </li>
              )}
            </ul>}
        </SettingsRow>
        <SettingsRow
          icon='receipt_long'
          layout='stacked'
          title={t('Audited operations', '已审计操作')}
          description={t(
            'Arguments are summarized and URLs omit credentials, query strings, and fragments.',
            '参数仅保留摘要，URL 会移除凭据、查询参数与片段。'
          )}
        >
          {(status?.recent_audit?.length ?? 0) === 0
            ? <p className='chrome-driver__empty'>{t('No audited actions yet.', '尚无审计操作。')}</p>
            : <ul className='chrome-driver__audit'>
              {status.recent_audit.slice(0, 5).map(item =>
                <li key={item.audit_id}>
                  <time>{new Date(item.at).toLocaleTimeString()}</time>
                  <span className={`is-${item.outcome}`}>{item.outcome}</span>
                  <details>
                    <summary>{item.op}</summary>
                    <code>{item.summary}</code>
                  </details>
                </li>
              )}
            </ul>}
          {(status?.recent_audit?.length ?? 0) > 5 && <details className='chrome-driver__more'>
            <summary>
              {t(
                `Show ${Math.min(status.recent_audit.length - 5, 7)} more`,
                `再显示 ${Math.min(status.recent_audit.length - 5, 7)} 条`
              )}
            </summary>
            <ul className='chrome-driver__audit'>
              {status.recent_audit.slice(5, 12).map(item =>
                <li key={item.audit_id}>
                  <time>{new Date(item.at).toLocaleTimeString()}</time>
                  <span className={`is-${item.outcome}`}>{item.outcome}</span>
                  <details>
                    <summary>{item.op}</summary>
                    <code>{item.summary}</code>
                  </details>
                </li>
              )}
            </ul>
          </details>}
        </SettingsRow>
      </SettingsSection>}
    </div>
  </div>
}
