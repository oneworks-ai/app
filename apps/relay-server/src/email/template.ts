import type { RelayEmailProviderInput, RelayLocale } from '../types.js'
import { relayEmailContent, relayEmailFooterLinks } from './template-content.js'
import type { RelayEmailTemplateContent } from './template-content.js'

export interface RelayEmailPayload {
  html: string
  subject: string
  text: string
}

export interface RelayEmailTemplateOptions {
  logoUrl?: string
}

const minutesUntil = (expiresAt: string) => {
  const remainingMs = Date.parse(expiresAt) - Date.now()
  return Math.max(1, Math.ceil(remainingMs / 60_000))
}

const formatMinutes = (minutes: number, locale: RelayLocale) => {
  if (locale === 'zh-CN') return `${minutes} 分钟`
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const resolveLocale = (locale: RelayLocale | undefined): RelayLocale => locale ?? 'en'

const formatCodeForHtml = (code: string) => escapeHtml(code.trim().split('').join(' '))

const renderBrandHeader = (logoUrl: string | undefined, content: RelayEmailTemplateContent) => {
  const safeBrandName = escapeHtml(content.brandName)
  const safeLogoUrl = logoUrl == null || logoUrl.trim() === '' ? undefined : escapeHtml(logoUrl.trim())
  if (safeLogoUrl == null) {
    return `<div style="font-size:13px;line-height:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4f46e5;">${safeBrandName}</div>`
  }
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td width="36" style="width:36px;padding:0 12px 0 0;">
                      <img src="${safeLogoUrl}" width="36" height="36" alt="${safeBrandName}" style="display:block;width:36px;height:36px;border:0;border-radius:9px;">
                    </td>
                    <td style="padding:0;">
                      <div style="font-size:13px;line-height:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4f46e5;">${safeBrandName}</div>
                    </td>
                  </tr>
                </table>`
}

const renderFooterLink = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}" style="color:#4f46e5;text-decoration:none;">${escapeHtml(label)}</a>`

const renderFooter = (content: RelayEmailTemplateContent) => `
                <div style="padding-top:18px;border-top:1px solid #edf2f7;font-size:13px;line-height:20px;color:#64748b;">
                  <p style="margin:0 0 10px;">${escapeHtml(content.ignoreNotice)}</p>
                  <p style="margin:0 0 10px;">${escapeHtml(content.footerDescription)}</p>
                  <p style="margin:0;">
                    <span style="font-weight:600;color:#475569;">${escapeHtml(content.footerLinksLabel)}:</span>
                    ${renderFooterLink(relayEmailFooterLinks.website, content.websiteLabel)}
                    <span style="color:#94a3b8;"> &middot; </span>
                    ${renderFooterLink(relayEmailFooterLinks.docs, content.docsLabel)}
                    <span style="color:#94a3b8;"> &middot; </span>
                    ${renderFooterLink(relayEmailFooterLinks.support, content.supportLabel)}
                  </p>
                </div>`

export const buildRelayEmailPayload = (
  input: RelayEmailProviderInput,
  options: RelayEmailTemplateOptions = {}
): RelayEmailPayload => {
  const locale = resolveLocale(input.locale)
  const content = relayEmailContent[locale]
  const minutes = minutesUntil(input.expiresAt)
  const expiresText = content.expiresIn(formatMinutes(minutes, locale))
  const purpose = content.purposes[input.purpose]
  const brandHeader = renderBrandHeader(options.logoUrl, content)
  const htmlCode = formatCodeForHtml(input.code)
  const headline = escapeHtml(purpose.headline)
  const intro = escapeHtml(purpose.intro)
  const preheader = escapeHtml(purpose.preheader)
  const safeExpiresText = escapeHtml(expiresText)

  return {
    html: `<!doctype html>
<html lang="${escapeHtml(content.htmlLang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(purpose.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f7fb;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:560px;background:#ffffff;border:1px solid #dfe7f2;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 20px;border-bottom:1px solid #edf2f7;">
                ${brandHeader}
                <h1 style="margin:14px 0 0;font-size:24px;line-height:32px;font-weight:700;color:#111827;">${headline}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px;">
                <p style="margin:0;font-size:15px;line-height:24px;color:#334155;">${intro}</p>
                <div style="margin:24px 0 20px;padding:18px 20px;background:#f8fafc;border:1px solid #dbe5f0;border-radius:12px;text-align:center;">
                  <div style="font-size:12px;line-height:16px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b;">${
      escapeHtml(content.codeLabel)
    }</div>
                  <div style="margin-top:10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:32px;line-height:40px;font-weight:700;letter-spacing:.22em;color:#111827;">${htmlCode}</div>
                </div>
                <p style="margin:0;font-size:14px;line-height:22px;color:#475569;">${safeExpiresText}</p>
                <p style="margin:14px 0 0;font-size:14px;line-height:22px;color:#475569;">${
      escapeHtml(content.securityNotice)
    }</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 30px;">
                ${renderFooter(content)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    subject: purpose.subject,
    text: [
      content.brandName,
      '',
      purpose.headline,
      '',
      purpose.intro,
      '',
      `${content.codeLabel}: ${input.code}`,
      '',
      expiresText,
      content.securityNotice,
      content.ignoreNotice,
      '',
      content.sentBy,
      `${content.websiteLabel}: ${relayEmailFooterLinks.website}`,
      `${content.docsLabel}: ${relayEmailFooterLinks.docs}`,
      `${content.supportLabel}: support@oneworks.cloud`
    ].join('\n')
  }
}
