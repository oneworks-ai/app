import type { SvgSection } from './svg-types.js'
import { formatNumber, tileRect } from './svg-utils.js'

export const createMetalBackground = (
  id: string,
  offset: number,
  size: number,
  radius: number,
  mode: string
): SvgSection => {
  const x = (value: number) => formatNumber(offset + size * value)
  const stroke = mode === 'dark' ? 'rgba(237,241,224,0.15)' : 'rgba(255,255,255,0.58)'

  return {
    body: [
      `<rect ${tileRect(offset, size, radius)} fill="url(#${id}-metal-base)"/>`,
      `<g clip-path="url(#${id}-clip)">`,
      `  <path d="M${x(-0.08)} ${x(0.36)} C${x(0.2)} ${x(0.06)} ${x(0.38)} ${x(0.1)} ${x(0.62)} ${x(-0.06)} L${
        x(1.1)
      } ${x(0.1)} C${x(0.82)} ${x(0.35)} ${x(0.76)} ${x(0.62)} ${x(1.07)} ${x(0.83)} L${x(0.18)} ${x(1.08)} C${
        x(0.26)
      } ${x(0.82)} ${x(0.1)} ${x(0.66)} ${x(-0.08)} ${
        x(0.36)
      }Z" fill="url(#${id}-metal-sheen)" opacity="0.94" filter="url(#${id}-metal-soften)"/>`,
      `  <ellipse cx="${x(0.61)}" cy="${x(0.76)}" rx="${formatNumber(size * 0.28)}" ry="${
        formatNumber(size * 0.13)
      }" fill="url(#${id}-metal-dark)" transform="rotate(-7 ${x(0.61)} ${x(0.76)})"/>`,
      `  <path d="M${x(-0.04)} ${x(0.7)} C${x(0.2)} ${x(0.54)} ${x(0.38)} ${x(0.62)} ${x(0.52)} ${x(0.42)} C${
        x(0.72)
      } ${x(0.13)} ${x(0.84)} ${x(0.2)} ${x(1.06)} ${x(0.08)}" fill="none" stroke="#050607" stroke-width="${
        formatNumber(size * 0.038)
      }" stroke-linecap="round" opacity="0.72" filter="url(#${id}-metal-soften)"/>`,
      `  <path d="M${x(0.02)} ${x(0.92)} C${x(0.22)} ${x(0.76)} ${x(0.42)} ${x(0.9)} ${x(0.63)} ${x(0.78)} C${x(0.8)} ${
        x(0.68)
      } ${x(0.91)} ${x(0.78)} ${x(1.03)} ${x(0.62)}" fill="none" stroke="#f7f8ef" stroke-width="${
        formatNumber(size * 0.065)
      }" stroke-linecap="round" opacity="0.86" filter="url(#${id}-metal-soften)"/>`,
      `  <path d="M${x(0.08)} ${x(0.89)} C${x(0.28)} ${x(0.72)} ${x(0.46)} ${x(0.91)} ${x(0.64)} ${x(0.79)} C${
        x(0.79)
      } ${x(0.68)} ${x(0.91)} ${x(0.77)} ${x(1)} ${x(0.64)}" fill="none" stroke="#b9bd50" stroke-width="${
        formatNumber(size * 0.008)
      }" stroke-linecap="round" opacity="0.46"/>`,
      '</g>',
      `<rect ${
        tileRect(offset + 0.75, size - 1.5, Math.max(0, radius - 0.75))
      } fill="none" stroke="${stroke}" stroke-width="${formatNumber(Math.max(0.6, size / 512))}"/>`
    ],
    defs: [
      `<linearGradient id="${id}-metal-base" x1="0%" y1="0%" x2="100%" y2="100%">`,
      '  <stop offset="0%" stop-color="#111514"/>',
      '  <stop offset="18%" stop-color="#f5f6ee"/>',
      '  <stop offset="36%" stop-color="#050607"/>',
      '  <stop offset="62%" stop-color="#f9f9f3"/>',
      '  <stop offset="82%" stop-color="#646b68"/>',
      '  <stop offset="100%" stop-color="#ecede6"/>',
      '</linearGradient>',
      `<linearGradient id="${id}-metal-sheen" x1="0%" y1="0%" x2="100%" y2="0%">`,
      '  <stop offset="0%" stop-color="#050607" stop-opacity="0.9"/>',
      '  <stop offset="38%" stop-color="#f8f9f2" stop-opacity="0.98"/>',
      '  <stop offset="58%" stop-color="#c5c8d8" stop-opacity="0.92"/>',
      '  <stop offset="74%" stop-color="#090a0b" stop-opacity="0.95"/>',
      '  <stop offset="100%" stop-color="#f6f7ef" stop-opacity="0.96"/>',
      '</linearGradient>',
      `<radialGradient id="${id}-metal-dark" cx="58%" cy="76%" r="44%">`,
      '  <stop offset="0%" stop-color="#050506" stop-opacity="0.92"/>',
      '  <stop offset="52%" stop-color="#141518" stop-opacity="0.58"/>',
      '  <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>',
      '</radialGradient>',
      `<filter id="${id}-metal-soften" x="-10%" y="-10%" width="120%" height="120%">`,
      `  <feGaussianBlur stdDeviation="${formatNumber(size * 0.01)}"/>`,
      '</filter>'
    ]
  }
}
