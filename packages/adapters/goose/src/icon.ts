const GOOSE_ICON_SVG = `
<svg height="1em" viewBox="0 0 48 48" width="1em" xmlns="http://www.w3.org/2000/svg">
  <rect fill="#FFFFFF" height="46" rx="11" stroke="#101010" stroke-width="2" width="46" x="1" y="1"/>
  <path d="M37.8 9.2c-3.9.3-7.2 3.5-7.6 7.4-.2 2.3.5 4.3 1.8 5.9-4.5-2.2-10.1-5.6-14.1-10.8-.5-.7-1.6-.6-2 .2-2.1 4.3-2.8 8.4-2.1 12.3-1.8-.5-3.5-1.3-5-2.4-.7-.5-1.6.1-1.4.9 1.2 5.2 5 9.4 10 11.2l-4.2 5.2h7l3.3-3.8c3.1.1 6.3-.5 9.4-2l4.3 5.8H44l-5.8-8.8c-1.9-2.9-2-6.8-.1-9.7 1.2-1.8 2.9-3.2 4.9-3.9l-2.1-2 2.5-2.4c-1.6-2.2-3.4-3.3-5.6-3.1Z" fill="#101010"/>
  <circle cx="36.4" cy="13.7" fill="#FFFFFF" r="1.2"/>
</svg>
`.trim()

export const adapterIcon = `data:image/svg+xml;utf8,${encodeURIComponent(GOOSE_ICON_SVG)}`
export const adapterDisplayName = 'Goose'
