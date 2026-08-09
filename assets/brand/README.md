# One Works brand assets

This directory contains generated, upload-ready brand compositions. Runtime
icons continue to come from `@oneworks/icon` and the committed Linear desktop
assets; these images are distribution artifacts, not a second icon runtime.

- `distribution/github-social-preview-*.png`: upload in GitHub repository settings.
- `distribution/github-org-readme-*.png`: used by the organization profile README.
- `distribution/homepage-open-graph-*.png`: homepage Open Graph cards.
- `distribution/vscode-marketplace-*.png`: VS Code Marketplace listing headers.
- `distribution/chrome-web-store-*.png`: Chrome Web Store promotional source.
- `distribution/npm-readme-header-*.png`: npm/CLI README headers.

Run `node scripts/sync-brand-assets.cjs` after changing canonical Linear assets
to refresh consumer copies and checksums.
