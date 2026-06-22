# Client 0.1.0-alpha.0

- Add sender speech-to-text input with configurable services, web Browser Speech support, recording waveform UI, and transcript insertion into the composer.
- Add theme-aware adapter display icons and switch the Codex adapter to the official Blossom mark, using a light icon in dark mode and a dark icon in light mode.
- Add official model service provider management, provider icons, portal actions, model refresh helpers, and model selector entries for official and relay API platforms.
- Show Coding Plan and Token Plan guidance in model service details, including key kind, quota semantics, dedicated OpenAI/Anthropic base URLs, default models, restrictions, and provider plan links.
- Display Kimi Code usage-plan results as request quota instead of pay-as-you-go balance.
- Add tabbed model service detail pages, reusable config record list controls, bottom-panel provider portals, and New API collection management for local profiles and remote API keys.
- Add desktop browser history and download management pages with project/session filters, search, and shared select styling.
- Add external session import management for Codex and Claude Code, including candidate search, filters, per-adapter import controls, and path/size tooltips.
- Add context capture annotations for interaction panel pages, including element comments, pending sender references, selection chips, and annotation hover previews.
- Add workspace file and Markdown comment references, including Monaco line comments, sender attachment previews, tab navigation to referenced lines, and IME-safe comment shortcuts.
- Fix Electron webview element comments so the localized context-menu action resolves the target from the renderer's webview viewport point instead of misusing main-process context-menu coordinates.
- Polish the mobile workspace tab switcher, webview tab chrome, compact sender spacing, and development shell simulation controls.
