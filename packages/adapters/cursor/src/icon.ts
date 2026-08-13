const CURSOR_ICON_SVG = `
<svg height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg">
  <rect fill="#111111" height="22" rx="5" width="22" x="1" y="1"/>
  <path d="M7 6.5 18 12 7 17.5l2.1-4.1L13 12l-3.9-1.4L7 6.5Z" fill="#FFFFFF"/>
</svg>
`.trim()

export const adapterIcon = `data:image/svg+xml;utf8,${encodeURIComponent(CURSOR_ICON_SVG)}`
export const adapterDisplayName = 'Cursor'
