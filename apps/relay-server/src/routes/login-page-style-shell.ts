export const relayLoginShellStyle = `
:root {
  color-scheme: light;
  --relay-ink: #111714;
  --relay-muted: #64706a;
  --relay-panel: rgba(246, 248, 245, 0.88);
  --relay-panel-strong: rgba(255, 255, 253, 0.94);
  --primary-color: #e23f12;
  --primary-soft-bg: color-mix(in srgb, var(--primary-color) 12%, #ffffff);
  --primary-text-color: color-mix(in srgb, var(--primary-color) 82%, var(--relay-ink));
  --relay-accent: var(--primary-color);
  --relay-accent-soft: var(--primary-soft-bg);
  --relay-accent-strong: var(--primary-text-color);
  --relay-blue: #2b6fd3;
  --relay-warning: #cf222e;
  --relay-glass-blur: 22px;
}

* {
  box-sizing: border-box;
}

body {
  position: relative;
  margin: 0;
  min-height: 100vh;
  color: var(--relay-ink);
  overflow: auto;
  overflow-x: hidden;
  background: #080a09;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body::before,
body::after {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  content: "";
}

body::before {
  background:
    radial-gradient(circle at 18% 18%, rgba(216, 215, 202, 0.2), transparent 34%),
    radial-gradient(circle at 78% 14%, rgba(226, 63, 18, 0.14), transparent 30%),
    linear-gradient(128deg, rgba(255, 255, 255, 0.18), transparent 34%, rgba(226, 63, 18, 0.08) 62%, transparent 86%);
  mix-blend-mode: screen;
  opacity: 0.72;
}

body::after {
  background:
    radial-gradient(circle at 50% 44%, transparent 0 38%, rgba(3, 5, 5, 0.42) 78%, rgba(3, 5, 5, 0.74) 100%),
    linear-gradient(90deg, rgba(5, 9, 8, 0.2), transparent 30%, rgba(250, 248, 232, 0.1) 62%, rgba(6, 8, 8, 0.2));
  opacity: 0.86;
}

.relay-login__backdrop {
  position: fixed;
  inset: -120px;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 42%, rgba(216, 215, 202, 0.18), transparent 36%),
    linear-gradient(180deg, #050607 0%, #343a39 38%, #0d0f10 68%, #626b68 100%);
}

.relay-login__backdrop::after {
  position: absolute;
  inset: 0;
  content: "";
  background:
    radial-gradient(circle at 50% 50%, transparent 0 32%, rgba(3, 5, 5, 0.3) 64%, rgba(3, 5, 5, 0.72) 100%),
    linear-gradient(115deg, rgba(255, 255, 255, 0.14), transparent 24%, rgba(226, 63, 18, 0.07) 50%, transparent 74%);
}

.relay-login__backdrop-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.relay-login {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
}

.relay-login__layout {
  position: relative;
  width: min(424px, 100%);
  display: grid;
  overflow: hidden;
  isolation: isolate;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 8px;
  background: var(--relay-panel);
  box-shadow:
    0 24px 80px rgba(6, 12, 10, 0.32),
    0 1px 0 rgba(255, 255, 255, 0.64) inset;
  backdrop-filter: blur(var(--relay-glass-blur)) saturate(1.18);
  -webkit-backdrop-filter: blur(var(--relay-glass-blur)) saturate(1.18);
}

.relay-login__layout::before {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  content: "";
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.46), transparent 38%);
}

.relay-login__header,
.relay-login__section,
.relay-login__error {
  position: relative;
  z-index: 1;
}

.relay-login__header {
  display: grid;
  gap: 10px;
  padding: 24px 30px 20px;
}

.relay-login__eyebrow,
.relay-login__section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 780;
  letter-spacing: 0;
  line-height: 1;
  text-transform: uppercase;
}

.relay-login__eyebrow {
  color: var(--relay-accent-strong);
}

.relay-login__title {
  margin: 0;
  color: var(--relay-ink);
  font-size: 28px;
  font-weight: 780;
  line-height: 1.16;
}

.relay-login__subtitle {
  margin: 0;
  color: var(--relay-muted);
  font-size: 14px;
  line-height: 1.65;
}
`
