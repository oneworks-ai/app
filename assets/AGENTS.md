# Assets Agent Guide

`assets/` hosts standalone design asset projects that are useful to develop and preview independently from the main apps.

- `avatar/`: preview/export page for the shared pixel-rect SVG avatar system in `packages/avatar`.

Asset projects that also publish standalone sites should live in their own repository and be mounted here as submodules. Keep reusable runtime APIs in `packages/*`; asset repositories should own preview/export UX and GitHub Pages deployment only.
