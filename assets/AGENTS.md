# Assets Agent Guide

`assets/` hosts standalone design asset projects that are useful to develop and preview independently from the main apps.

- `avatar/`: editor, public 3D runtime packages, framework adapters, and export surface for OneWorks Avatar.

Asset projects that also publish standalone sites should live in their own repository and be mounted here as submodules. Keep reusable runtime APIs in the owning repository's `packages/*`; asset repositories normally own preview/export UX and GitHub Pages deployment only, unless their public package ownership is explicitly approved and protected like `assets/avatar`.

`assets/avatar` and its public `packages/*` are intentional root workspace members because the main client consumes the same 3D runtime. Do not add other submodule asset sites to the root workspace without equivalent install, build, and clean-consumer coverage.
