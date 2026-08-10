const buildPiIcon = (fill: string) => {
  const svg = `
<svg height="1em" style="flex:none;line-height:1" viewBox="0 0 800 800" width="1em" xmlns="http://www.w3.org/2000/svg">
  <path fill="${fill}" fill-rule="evenodd" d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"/>
  <path fill="${fill}" d="M517.36 400H634.72V634.72H517.36Z"/>
</svg>`
    .trim()
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// Official Pi mark from https://pi.dev/logo-auto.svg, split by theme for data-URI consumers.
export const adapterIcon = buildPiIcon('#000000')
export const adapterIconDark = buildPiIcon('#ffffff')
export const adapterDisplayName = 'Pi'
