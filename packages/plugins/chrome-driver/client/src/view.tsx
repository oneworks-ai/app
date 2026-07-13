/* eslint-disable max-lines -- The plugin-owned settings subpage keeps recovery and audit sections in one render contract. */
/* @jsx h */
const normalizeFailure = error => ({
  code: error?.details?.code ?? error?.code ?? 'CHROME_DRIVER_FAILED',
  message: error?.details?.message ?? error?.message ?? String(error),
  missingPermissions: error?.details?.missing_permissions ?? error?.missing_permissions ?? []
})

export function ChromeDriverView({ ctx, react, view }) {
  const h = react.createElement
  const { useCallback, useEffect, useMemo, useState } = react
  const { Button, Icon, SettingsRow, SettingsSection, Switch } = view.ui
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

  useEffect(() => view.i18n?.subscribe?.(() => setLanguageVersion(value => value + 1))?.dispose, [view.i18n])

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await ctx.commands.execute('status', {})
      setStatus(nextStatus)
      if (nextStatus?.connection?.capabilities?.advanced_access != null) {
        setAdvancedAccess(nextStatus.connection.capabilities.advanced_access)
      }
      setFailure(current => current?.source === 'status' ? null : current)
    } catch (error) {
      setStatus(null)
      setFailure({ ...normalizeFailure(error), source: 'status', retry: refresh })
    }
  }, [ctx.commands])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 2500)
    const pairingResult = event => {
      if (
        event.source !== window || event.origin !== location.origin ||
        event.data?.type !== 'ONEWORKS_CHROME_PAIRING_RESULT'
      ) return
      if (event.data.ok === true) setFailure(null)
      else if (event.data.error != null) setFailure(normalizeFailure(event.data.error))
      void refresh()
    }
    window.addEventListener('message', pairingResult)
    return () => {
      clearInterval(timer)
      window.removeEventListener('message', pairingResult)
    }
  }, [refresh])

  const refreshAdvancedAccess = useCallback(async () => {
    const result = await ctx.commands.execute('get-advanced-access', {})
    setAdvancedAccess(result?.result ?? result)
  }, [ctx.commands])

  useEffect(() => {
    if (status?.connected !== true) {
      setAdvancedAccess(null)
      return
    }
    void refreshAdvancedAccess().catch(error => {
      setFailure({ ...normalizeFailure(error), source: 'advanced-access', retry: refreshAdvancedAccess })
    })
  }, [refreshAdvancedAccess, status?.connected, status?.connection?.connection_id])

  const run = async (name, task) => {
    setBusy(name)
    setFailure(null)
    try {
      await task()
      await refresh()
    } catch (error) {
      setFailure({ ...normalizeFailure(error), source: 'operation', retry: () => run(name, task) })
    } finally {
      setBusy('')
    }
  }
  const connect = () =>
    run('connect', async () => {
      window.postMessage({ type: 'ONEWORKS_CHROME_PAIRING_REQUEST' }, location.origin)
      await new Promise(resolve => setTimeout(resolve, 300))
    })
  const inspectFrames = () =>
    run('frames', async () => {
      const tabId = status?.connection?.oneworks_tab_id
      if (!Number.isInteger(tabId)) {
        throw new TypeError(t('Reconnect from the OneWorks Web tab first.', '请先从 OneWorks Web 标签页重新连接。'))
      }
      const result = await ctx.commands.execute('list-web-frames', { tab_id: tabId })
      setFrames(result?.result ?? result ?? [])
    })
  const updateAdvancedAccess = (key, enabled) =>
    run(`advanced:${key}`, async () => {
      const result = await ctx.commands.execute('set-advanced-access', { enabled, key })
      setAdvancedAccess(result?.result ?? result)
    })
  const decide = (id, approved) =>
    run(
      id,
      () => ctx.commands.execute(approved ? 'approve-confirmation' : 'deny-confirmation', { confirmation_id: id })
    )
  const connectionState = status?.connected ? 'connected' : status?.connection ? 'interrupted' : 'disconnected'
  const rawDebuggerAvailable = status?.connection?.capabilities?.modules?.raw === true
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

    <SettingsSection
      icon='link'
      title={t('Connection', '连接')}
      description={t(
        'Pair a trusted browser and grant capabilities only when needed.',
        '配对受信浏览器，并仅在需要时授予能力。'
      )}
    >
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
            label={busy === 'connect' ? t('Connecting…', '连接中…') : t('Connect browser', '连接浏览器')}
            icon='link'
            type='primary'
            disabled={busy !== ''}
            onClick={connect}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        icon='info'
        layout='stacked'
        title={t('Connection details', '连接详情')}
        description={t(
          'Versions and activity reported by the paired Chrome extension.',
          '由已配对 Chrome 扩展报告的版本与活动信息。'
        )}
      >
        <div className='chrome-driver__facts-wrap'>
          <dl className='chrome-driver__facts'>
            <div>
              <dt>{t('Browser', '浏览器')}</dt>
              <dd>{status?.connection?.chrome_version ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('Extension', '扩展')}</dt>
              <dd>{status?.connection?.extension_version ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('Protocol', '协议')}</dt>
              <dd>{status?.protocol_version ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('Last seen', '最后活动')}</dt>
              <dd>
                {status?.connection?.last_seen_at ? new Date(status.connection.last_seen_at).toLocaleTimeString() : '—'}
              </dd>
            </div>
          </dl>
        </div>
        <div className='chrome-driver__hint'>
          <Icon name='extension' />
          <span>
            {t(
              'In Chrome, open the extension on this OneWorks tab, choose “Connect this OneWorks tab”, then return here and connect the browser.',
              '在 Chrome 的当前 OneWorks 标签页打开扩展，选择“连接此 OneWorks 标签页”，然后回到这里连接浏览器。'
            )}
          </span>
        </div>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection
      icon='security'
      title={t('Advanced session access', '高级会话访问')}
      description={t(
        'Explicit opt-in for raw browser data and protocol operations.',
        '显式开启原始浏览器数据与协议操作。'
      )}
    >
      <div className='chrome-driver__advanced-warning'>
        <Icon name='warning' />
        <span>
          {t(
            'Disabled by default and cleared when this browser session ends. Every use still requires an exact R4 confirmation.',
            '默认关闭，并在当前浏览器会话结束时清除；每次使用仍需精确的 R4 确认。'
          )}
        </span>
      </div>
      <SettingsRow
        icon='terminal'
        title={t('Raw CDP and JavaScript', '原始 CDP 与 JavaScript')}
        description={rawDebuggerAvailable
          ? t(
            'Browser-session-wide access. The tab and origin guard catches accidental navigation but is not a security boundary; this also includes cookie values and sensitive page fields.',
            '浏览器会话级访问；tab 与来源检查用于发现误导航，并非安全边界；同时包含完整 Cookie 值与页面敏感字段。'
          )
          : t(
            'Install the privileged extension flavor to enable Chrome debugger access.',
            '请安装 privileged 扩展版本以启用 Chrome debugger。'
          )}
      >
        <Switch
          checked={advancedAccess?.raw_debugger === true}
          disabled={!status?.connected || !rawDebuggerAvailable || advancedAccess == null || busy !== ''}
          onChange={enabled => void updateAdvancedAccess('raw_debugger', enabled)}
        />
      </SettingsRow>
      <SettingsRow
        icon='cookie'
        title={t('Complete cookie values', '完整 Cookie 值')}
        description={advancedAccess?.raw_debugger === true
          ? t('Included while Raw CDP and JavaScript is enabled.', '开启原始 CDP 与 JavaScript 时已包含。')
          : t(
            'Allow value reads only for an explicitly supplied HTTP(S) origin.',
            '仅允许读取显式指定 HTTP(S) 来源的 Cookie 值。'
          )}
      >
        <Switch
          checked={advancedAccess?.cookie_values === true}
          disabled={!status?.connected || advancedAccess == null || advancedAccess?.raw_debugger === true ||
            busy !== ''}
          onChange={enabled => void updateAdvancedAccess('cookie_values', enabled)}
        />
      </SettingsRow>
      <SettingsRow
        icon='password'
        title={t('Sensitive page fields', '页面敏感字段')}
        description={advancedAccess?.raw_debugger === true
          ? t('Included while Raw CDP and JavaScript is enabled.', '开启原始 CDP 与 JavaScript 时已包含。')
          : t(
            'Allow reading and typing password, token, OTP, and similar fields in the current page.',
            '允许读取和输入当前页面中的密码、token、OTP 等敏感字段。'
          )}
      >
        <Switch
          checked={advancedAccess?.sensitive_fields === true}
          disabled={!status?.connected || advancedAccess == null || advancedAccess?.raw_debugger === true ||
            busy !== ''}
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
    </SettingsSection>

    <SettingsSection
      icon='account_tree'
      title={t('Web frame isolation', 'Web Frame 隔离')}
      description={t(
        'Discover only frames in the paired OneWorks tab. Cross-origin access still follows Chrome host permissions.',
        '仅发现已配对 OneWorks 标签页中的 frame；跨域访问仍遵循 Chrome host 权限。'
      )}
    >
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
    </SettingsSection>

    <SettingsSection
      icon='shield'
      title={t('Pending confirmations', '待确认操作')}
      description={t(
        'Approval is exact-operation scoped and expires after five minutes.',
        '批准仅适用于完全匹配的操作，并在五分钟后失效。'
      )}
    >
      <SettingsRow
        icon='approval'
        layout='stacked'
        title={t('Sensitive actions', '敏感操作')}
        description={t(
          `${status?.pending_confirmations?.length ?? 0} waiting for review`,
          `${status?.pending_confirmations?.length ?? 0} 个等待确认`
        )}
      >
        {(status?.pending_confirmations?.length ?? 0) === 0
          ? <p className='chrome-driver__empty'>{t('No sensitive actions are waiting.', '没有等待确认的敏感操作。')}</p>
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
    </SettingsSection>

    <SettingsSection
      icon='history'
      title={t('Recent audit', '最近审计')}
      description={t(
        'Arguments are summarized and URLs omit credentials, query strings, and fragments.',
        '参数仅保留摘要，URL 会移除凭据、查询参数与片段。'
      )}
    >
      <SettingsRow icon='receipt_long' layout='stacked' title={t('Audited operations', '已审计操作')}>
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
    </SettingsSection>
  </div>
}
