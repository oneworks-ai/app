export const themeAccent = (theme: string, mode: string) => {
  if (theme === 'industrial') {
    return mode === 'dark'
      ? {
        glow: 'rgba(255,96,24,0.32)',
        shadow: 'rgba(255,88,24,0.2)',
        stroke: 'rgba(255,178,80,0.28)'
      }
      : {
        glow: 'rgba(226,63,18,0.24)',
        shadow: 'rgba(128,42,8,0.16)',
        stroke: 'rgba(128,42,8,0.22)'
      }
  }

  if (theme === 'matrix') {
    return mode === 'dark'
      ? {
        glow: 'rgba(0,255,118,0.28)',
        shadow: 'rgba(0,255,118,0.22)',
        stroke: 'rgba(168,255,198,0.2)'
      }
      : {
        glow: 'rgba(0,180,84,0.22)',
        shadow: 'rgba(0,130,64,0.16)',
        stroke: 'rgba(0,116,58,0.18)'
      }
  }

  return mode === 'dark'
    ? {
      glow: 'rgba(245,246,232,0.18)',
      shadow: 'rgba(245,246,232,0.14)',
      stroke: 'rgba(237,241,224,0.16)'
    }
    : {
      glow: 'rgba(255,255,255,0.56)',
      shadow: 'rgba(31,34,33,0.16)',
      stroke: 'rgba(255,255,255,0.52)'
    }
}
