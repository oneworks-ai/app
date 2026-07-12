/* eslint-disable max-lines -- login page renderer keeps the local HTML shell and scripts together. */
import type { IncomingMessage } from 'node:http'

import { isRelayEmailProviderConfigured } from '../email/provider.js'
import { isRelayTurnstileRequired } from '../email/turnstile.js'
import type { RelayLoginMethod, RelayServerArgs } from '../types.js'
import { completePageScript } from './login-complete-page-scripts.js'
import { oneWorksIconLoaderScript } from './login-page-assets.js'
import { buildLoginClientConfig } from './login-page-client-config.js'
import type { RelayLoginClientAssets } from './login-page-client-config.js'
import { getRelayLoginMessages, resolveRelayLoginLocale } from './login-page-i18n.js'
import type { RelayLoginMessages } from './login-page-i18n.js'
import { safeJson } from './login-page-script-utils.js'
import { iconLoaderScript } from './login-page-scripts.js'
import { renderRelayLoginStyle } from './login-page-style.js'
import type { RelayLoginProvider } from './login-page-types.js'
import { isSupportedLoginRedirectUri } from './login-redirect.js'
import { publicRequestBaseUrl } from './request-origin.js'

export interface RelayLoginPageInput {
  args: RelayServerArgs
  assets?: RelayLoginClientAssets
  providers: RelayLoginProvider[]
  req: IncomingMessage
  url: URL
}

export const relayLoginBaseUrl = (req: IncomingMessage, args: RelayServerArgs) => (
  publicRequestBaseUrl(req, args.publicBaseUrl)
)

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

const readLoginParam = (url: URL, key: string) => {
  const value = url.searchParams.get(key)?.trim() ?? ''
  return value === '' ? undefined : value
}

const buildCompleteUrl = (input: RelayLoginPageInput, redirectUri: string) => {
  const completeUrl = new URL('/login/complete', relayLoginBaseUrl(input.req, input.args))
  completeUrl.searchParams.set('redirect_uri', redirectUri)
  for (const key of ['server_id', 'scope']) {
    const value = readLoginParam(input.url, key)
    if (value != null) completeUrl.searchParams.set(key, value)
  }
  return completeUrl.toString()
}

const buildProviderStartUrl = (input: RelayLoginPageInput, providerId: string, redirectUri: string) => {
  const startUrl = new URL(
    `/api/auth/oauth/${encodeURIComponent(providerId)}/start`,
    relayLoginBaseUrl(input.req, input.args)
  )
  startUrl.searchParams.set('redirect_uri', buildCompleteUrl(input, redirectUri))
  const inviteCode = readLoginParam(input.url, 'invite_code')
  if (inviteCode != null) startUrl.searchParams.set('invite_code', inviteCode)
  return startUrl.toString()
}

const requestedLoginMethod = (input: RelayLoginPageInput): RelayLoginMethod | undefined => {
  const method = readLoginParam(input.url, 'login_method')
  return method === 'password' || method === 'passkey' || method === 'verification_code'
    ? method
    : undefined
}

export const buildRelayLoginPageClientConfig = (
  input: RelayLoginPageInput,
  options: { nativeClient?: boolean } = {}
) => {
  const locale = resolveRelayLoginLocale(input.req, input.url)
  const t = getRelayLoginMessages(locale)
  const redirectUri = readLoginParam(input.url, 'redirect_uri') ?? ''
  if (!isSupportedLoginRedirectUri(redirectUri, input.args)) return undefined
  return buildLoginClientConfig({
    defaultLoginMethod: requestedLoginMethod(input) ?? input.args.defaultLoginMethod,
    emailCodeLoginEnabled: isRelayEmailProviderConfigured(input.args) && (
      options.nativeClient !== true || !isRelayTurnstileRequired(input.args.email!)
    ),
    passkey: input.args.passkey,
    providers: input.providers,
    redirectUri,
    startUrlForProvider: providerId => buildProviderStartUrl(input, providerId, redirectUri),
    t
  })
}

const renderHeader = (t: RelayLoginMessages, title: string, subtitle?: string) => `
  <div class="relay-login__header">
    <h1 class="relay-login__title">${escapeHtml(title)}</h1>
    ${subtitle == null ? '' : `<p class="relay-login__subtitle">${escapeHtml(subtitle)}</p>`}
  </div>
`

const renderLayout = (t: RelayLoginMessages, panelBody: string, options: { loginPage?: boolean } = {}) => `
  <main class="relay-login"${options.loginPage === true ? ' data-login-page' : ''}>
    <section class="relay-login__layout" aria-label="${escapeHtml(t.brandName)}">
      ${panelBody}
    </section>
  </main>
`

const renderBackdrop = () =>
  '<div class="relay-login__backdrop" data-relay-login-background-loader="true" aria-hidden="true"></div>'

const defaultLoginAssets: Required<RelayLoginClientAssets> = {
  faviconDarkHref: '/admin/assets/favicon-dark.svg',
  faviconLightHref: '/admin/assets/favicon-light.svg',
  scriptSrc: '/admin/assets/login.js',
  styleHref: '/admin/assets/admin.css'
}

const resolveLoginAssets = (assets: RelayLoginClientAssets = {}): Required<RelayLoginClientAssets> => ({
  ...defaultLoginAssets,
  ...assets
})

const renderFaviconLinks = (assets: Pick<Required<RelayLoginClientAssets>, 'faviconDarkHref' | 'faviconLightHref'>) => `
    <link rel="icon" type="image/svg+xml" href="${escapeHtml(assets.faviconDarkHref)}">
    <link rel="icon" type="image/svg+xml" href="${
  escapeHtml(assets.faviconLightHref)
}" media="(prefers-color-scheme: light)">
    <link rel="icon" type="image/svg+xml" href="${
  escapeHtml(assets.faviconDarkHref)
}" media="(prefers-color-scheme: dark)">`

const shell = (t: RelayLoginMessages, body: string, script: string, assets?: RelayLoginClientAssets) => {
  const resolvedAssets = resolveLoginAssets(assets)

  return `<!doctype html>
<html lang="${escapeHtml(t.htmlLang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
${renderFaviconLinks(resolvedAssets)}
    <title>${escapeHtml(t.documentTitle)}</title>
    <style>${renderRelayLoginStyle()}</style>
  </head>
  <body>${renderBackdrop()}${body}${renderScriptTags(oneWorksIconLoaderScript, iconLoaderScript(), script)}</body>
</html>`
}

const loginShell = (t: RelayLoginMessages, config: unknown, assets: RelayLoginClientAssets = {}) => {
  const resolvedAssets = resolveLoginAssets(assets)
  return `<!doctype html>
<html lang="${escapeHtml(t.htmlLang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
${renderFaviconLinks(resolvedAssets)}
    <title>${escapeHtml(t.documentTitle)}</title>
    ${resolvedAssets.styleHref == null ? '' : `<link rel="stylesheet" href="${escapeHtml(resolvedAssets.styleHref)}">`}
    <style>${renderRelayLoginStyle()}</style>
  </head>
  <body>
    ${renderBackdrop()}
    <div id="relay-login-root"></div>
    <script type="application/json" id="relay-login-config">${safeJson(config)}</script>
    ${renderScriptTags(oneWorksIconLoaderScript, iconLoaderScript())}
    <script type="module" src="${escapeHtml(resolvedAssets.scriptSrc)}"></script>
  </body>
</html>`
}

const renderScriptTags = (...scripts: string[]) =>
  scripts
    .map(script => script.trim())
    .filter(Boolean)
    .map(script => `<script>${script}</script>`)
    .join('')

export const renderRelayLoginPage = (input: RelayLoginPageInput) => {
  const locale = resolveRelayLoginLocale(input.req, input.url)
  const t = getRelayLoginMessages(locale)
  const config = buildRelayLoginPageClientConfig(input)
  if (config == null) {
    return shell(
      t,
      renderLayout(
        t,
        `
        ${renderHeader(t, t.invalidTitle)}
        <p class="relay-login__error">${escapeHtml(t.invalidRedirect)}</p>
        `
      ),
      '',
      input.assets
    )
  }
  return loginShell(t, config, input.assets)
}

export const renderRelayLoginCompletePage = (input: RelayLoginPageInput) => {
  const locale = resolveRelayLoginLocale(input.req, input.url)
  const t = getRelayLoginMessages(locale)
  const redirectUri = readLoginParam(input.url, 'redirect_uri') ?? ''
  if (!isSupportedLoginRedirectUri(redirectUri, input.args)) {
    return renderRelayLoginPage(input)
  }
  return shell(
    t,
    renderLayout(
      t,
      `
        <div class="relay-login__header">
          <h1 class="relay-login__title" data-complete-title>${escapeHtml(t.finishingTitle)}</h1>
          <p class="relay-login__subtitle" data-complete-status>${escapeHtml(t.finishingSubtitle)}</p>
        </div>
      `
    ),
    completePageScript(redirectUri, {
      inviteRequired: t.inviteRequired,
      loginFailedTitle: t.loginFailedTitle,
      tokenMissing: t.tokenMissing
    }),
    input.assets
  )
}
