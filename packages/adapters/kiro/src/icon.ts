// Original One Works terminal-integration icon. It is not Kiro/AWS artwork and does not imply endorsement.
const KIRO_ICON_SVG = `
<svg aria-labelledby="oneworks-terminal-adapter-title" height="1em" role="img" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg">
  <title id="oneworks-terminal-adapter-title">Terminal adapter</title>
  <rect fill="#263238" height="18" rx="3" width="21" x="1.5" y="3"/>
  <path d="M1.5 6a3 3 0 0 1 3-3h15a3 3 0 0 1 3 3v2h-21V6Z" fill="#455A64"/>
  <circle cx="5" cy="5.5" fill="#B0BEC5" r="1"/>
  <path d="m6.5 11 3 2.25-3 2.25" fill="none" stroke="#6EE7D8" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>
  <path d="M12 16h5" fill="none" stroke="#F5F7F8" stroke-linecap="round" stroke-width="1.5"/>
</svg>
`.trim()

export const adapterIcon = `data:image/svg+xml;utf8,${encodeURIComponent(KIRO_ICON_SVG)}`
export const adapterDisplayName = 'Kiro'
