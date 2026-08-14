const buildClineIcon = (fill: string) => {
  const svg = `
<svg height="1em" viewBox="0 0 466.73 487.04" width="1em" xmlns="http://www.w3.org/2000/svg">
  <path fill="${fill}" d="M463.6 275.08l-29.26-58.75V182.5c0-56.08-45.01-101.5-100.53-101.5H283.8a56.19 56.19 0 0 0 5.61-24.61C289.41 25.22 264.33 0 233.34 0s-56.07 25.22-56.07 56.39c0 8.82 1.99 17.17 5.61 24.61h-50.01C77.36 81 32.35 126.42 32.35 182.5v33.83L2.48 274.92a20.69 20.69 0 0 0 0 18.81l29.87 57.93v33.83c0 56.08 45.01 101.5 100.52 101.5h200.95c55.51 0 100.53-45.42 100.53-101.5v-33.83l29.21-58.13a20.83 20.83 0 0 0 .04-18.45ZM202.75 322.96c0 25.48-20.54 46.14-45.88 46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48 20.54-46.14 45.88-46.14s45.88 20.66 45.88 46.14v82.02Zm147.83 0c0 25.48-20.54 46.14-45.88 46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48 20.54-46.14 45.88-46.14s45.88 20.66 45.88 46.14v82.02Z"/>
</svg>`.trim()
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// Official Cline mark distributed with Cline CLI 3.0.54.
export const adapterIcon = buildClineIcon('#24292f')
export const adapterIconDark = buildClineIcon('#ffffff')
export const adapterDisplayName = 'Cline'
